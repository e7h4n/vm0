/**
 * Integration tests for fast-brain/request-slow-brain event rendering.
 *
 * Drives events through the real polling path (`createVoiceChatPanelSignals`
 * → `VoiceChatPanelContent` → `VoiceChatEventItem`) seeded via MSW on
 * `zeroVoiceChatContextContract.getEvents`, per docs/testing.md § Platform UI
 * ("Don't render components directly").
 *
 * See: turbo/apps/platform/src/views/voice-chat/voice-chat-bubbles.tsx
 */

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StoreProvider } from "ccstate-react";
import { zeroVoiceChatContextContract, type ContextEvent } from "@vm0/core";
import { server } from "../../../mocks/server.ts";
import { mockApi } from "../../../mocks/msw-contract.ts";
import { testContext } from "../../../signals/__tests__/test-helpers.ts";
import { detachedSetupPage } from "../../../__tests__/page-helper.ts";
import { createVoiceChatPanelSignals } from "../../../signals/mission-control-page/create-voice-chat-panel-signals.ts";
import { detach, Reason } from "../../../signals/utils.ts";
import { VoiceChatPanelContent } from "../../mission-control-page/voice-chat-panel-content.tsx";

const context = testContext();

function seedEvents(events: ContextEvent[]) {
  server.use(
    mockApi(zeroVoiceChatContextContract.getEvents, ({ query, respond }) => {
      const after = query.after ?? 0;
      if (after === 0) {
        return respond(200, { events });
      }
      return respond(200, { events: [] });
    }),
  );
}

async function renderPanelWithEvents(
  sessionId: string,
  events: ContextEvent[],
) {
  detachedSetupPage({ context, path: "/", withoutRender: true });
  seedEvents(events);
  const signals = createVoiceChatPanelSignals(sessionId);
  detach(
    context.store.set(signals.startPolling$, context.signal),
    Reason.Daemon,
  );
  const result = render(
    <StoreProvider value={context.store}>
      <VoiceChatPanelContent signals={signals} />
    </StoreProvider>,
  );
  await waitFor(() => {
    expect(context.store.get(signals.events$)).toHaveLength(events.length);
  });
  return result;
}

describe("voice-chat event item - fast-brain request-slow-brain", () => {
  it("renders a request-slow-brain indicator row with task content", async () => {
    const { container } = await renderPanelWithEvents("sess-fb-1", [
      {
        id: "evt-fb-1",
        seq: 1,
        source: "fast-brain",
        type: "request-slow-brain",
        content: "check PR #123",
        createdAt: "2026-04-22T10:00:00Z",
      },
    ]);

    // The indicator row is the only non-placeholder row in the panel.
    const indicator = container.querySelector("details");
    expect(indicator).not.toBeNull();
    expect(screen.getByText("check PR #123")).toBeInTheDocument();
  });

  it("renders the indicator without <details> when content is null", async () => {
    const { container } = await renderPanelWithEvents("sess-fb-2", [
      {
        id: "evt-fb-2",
        seq: 1,
        source: "fast-brain",
        type: "request-slow-brain",
        content: null,
        createdAt: "2026-04-22T10:00:00Z",
      },
    ]);

    expect(container.querySelector("details")).toBeNull();
  });

  it("renders the indicator without <details> when content is whitespace only", async () => {
    const { container } = await renderPanelWithEvents("sess-fb-3", [
      {
        id: "evt-fb-3",
        seq: 1,
        source: "fast-brain",
        type: "request-slow-brain",
        content: "   ",
        createdAt: "2026-04-22T10:00:00Z",
      },
    ]);

    expect(container.querySelector("details")).toBeNull();
  });
});

describe("voice-chat event item - system events stay hidden", () => {
  it("renders no event rows for session-start / task-dispatched / task-completed", async () => {
    const { container } = await renderPanelWithEvents("sess-sys-1", [
      {
        id: "evt-sys-1",
        seq: 1,
        source: "system",
        type: "session-start",
        content: null,
        createdAt: "2026-04-22T10:00:00Z",
      },
      {
        id: "evt-sys-2",
        seq: 2,
        source: "system",
        type: "task-dispatched",
        content: "irrelevant",
        createdAt: "2026-04-22T10:00:01Z",
      },
      {
        id: "evt-sys-3",
        seq: 3,
        source: "system",
        type: "task-completed",
        content: "irrelevant",
        createdAt: "2026-04-22T10:00:02Z",
      },
    ]);

    // Three system events were accumulated in signals.events$, but none of
    // them should produce a rendered row — no <details>, no indicator icon.
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});
