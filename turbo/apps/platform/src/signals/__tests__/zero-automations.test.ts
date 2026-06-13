import { describe, expect, it } from "vitest";

import {
  automationsByRefContract,
  automationTriggersContract,
  type UpdateTriggerRequest,
} from "@vm0/api-contracts/contracts/automations";
import {
  allOrgAutomationEntries$,
  fetchAllOrgAutomations$,
} from "../zero-page/zero-automations.ts";
import { createMockAutomationView } from "../../mocks/handlers/automations-store.ts";
import { testContext } from "./test-helpers.ts";
import { deployAutomation } from "../zero-page/automations-api.ts";
import { zeroClient$ } from "../api-client.ts";

describe("allOrgAutomationEntries$", () => {
  const ctx = testContext();

  it("displays automation times in the user's preferred timezone", async () => {
    ctx.mocks.data.automations([
      createMockAutomationView({
        cronExpression: "0 9 * * *",
        timezone: "UTC",
      }),
    ]);
    ctx.mocks.data.userPreferences({ timezone: "Asia/Shanghai" });

    await ctx.store.set(fetchAllOrgAutomations$, ctx.signal);
    const entries = await ctx.store.get(allOrgAutomationEntries$);

    expect(entries[0].time).toBe("Every day at 5:00 PM");
    expect(entries[0].timezone).toBe("Asia/Shanghai");
  });

  it("displays one-time automation times in the user's preferred timezone", async () => {
    ctx.mocks.data.automations([
      createMockAutomationView({
        triggerType: "once",
        cronExpression: null,
        atTime: "2026-06-11T10:00:00.000Z",
        timezone: "UTC",
      }),
    ]);
    ctx.mocks.data.userPreferences({ timezone: "Asia/Shanghai" });

    await ctx.store.set(fetchAllOrgAutomations$, ctx.signal);
    const entries = await ctx.store.get(allOrgAutomationEntries$);

    expect(entries[0].time).toBe("Once on 2026-06-11 at 6:00 PM");
    expect(entries[0].timezone).toBe("Asia/Shanghai");
  });

  it("all entries use the same timezone regardless of stored timezone", async () => {
    ctx.mocks.data.automations([
      createMockAutomationView({
        id: "f0000001-0000-4000-a000-000000000001",
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        createdAt: "2026-06-01T00:00:00Z",
      }),
      createMockAutomationView({
        id: "f0000002-0000-4000-a000-000000000002",
        cronExpression: "0 18 * * *",
        timezone: "Asia/Shanghai",
        createdAt: "2026-06-02T00:00:00Z",
      }),
    ]);
    ctx.mocks.data.userPreferences({ timezone: "Asia/Shanghai" });

    await ctx.store.set(fetchAllOrgAutomations$, ctx.signal);
    const entries = await ctx.store.get(allOrgAutomationEntries$);

    const timezones = entries.map((e) => {
      return e.timezone;
    });
    expect(new Set(timezones).size).toBe(1);
    expect(timezones[0]).toBe("Asia/Shanghai");
  });

  it("edits an existing schedule with an in-place trigger update", async () => {
    const existing = createMockAutomationView({
      id: "f0000003-0000-4000-a000-000000000003",
      agentId: "c0000003-0000-4000-a000-000000000003",
      name: "schedule-edit",
      triggerType: "cron",
      cronExpression: "0 9 * * *",
      intervalSeconds: null,
    });
    ctx.mocks.data.automations([existing]);

    let triggerUpdateBody: UpdateTriggerRequest | null = null;
    let addCalled = false;
    let removeCalled = false;
    ctx.mocks.api(
      automationTriggersContract.update,
      ({ params, body, respond }) => {
        triggerUpdateBody = body;
        return respond(200, {
          id: params.id,
          automationId: existing.id,
          enabled: true,
          createdAt: existing.createdAt,
          updatedAt: "2026-06-02T00:00:00Z",
          kind: "loop",
          intervalSeconds: 600,
          timezone: "UTC",
          nextRunAt: "2026-06-02T00:00:00Z",
          lastRunAt: null,
          consecutiveFailures: 0,
        });
      },
    );
    ctx.mocks.api(automationsByRefContract.addTrigger, ({ respond }) => {
      addCalled = true;
      return respond(201, {
        trigger: {
          id: "22222222-2222-4222-8222-222222222222",
          automationId: existing.id,
          enabled: true,
          createdAt: existing.createdAt,
          updatedAt: "2026-06-02T00:00:00Z",
          kind: "loop",
          intervalSeconds: 600,
          timezone: "UTC",
          nextRunAt: "2026-06-02T00:00:00Z",
          lastRunAt: null,
          consecutiveFailures: 0,
        },
      });
    });
    ctx.mocks.api(automationTriggersContract.remove, ({ respond }) => {
      removeCalled = true;
      return respond(204);
    });

    const result = await deployAutomation(
      ctx.store.get(zeroClient$),
      {
        name: existing.name,
        agentId: existing.agentId,
        prompt: "Summarize yesterday's threads.",
        description: "Updated description",
        timezone: "UTC",
        intervalSeconds: 600,
      },
      true,
    );

    expect(result).toStrictEqual({ id: existing.id, created: false });
    expect(triggerUpdateBody).toStrictEqual({
      kind: "loop",
      intervalSeconds: 600,
    });
    expect(addCalled).toBeFalsy();
    expect(removeCalled).toBeFalsy();
  });
});
