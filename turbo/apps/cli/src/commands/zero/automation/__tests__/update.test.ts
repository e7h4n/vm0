/**
 * Tests for `zero automation update` (unified automations).
 *
 * Tests command-level behavior via parseAsync() following CLI testing principles:
 * - Entry point: command.parseAsync()
 * - Mock (external): Web API via MSW
 * - Real (internal): All CLI code, formatters, validators
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../../mocks/server";
import { updateCommand } from "../update";
import chalk from "chalk";

const TRIGGER_ID = "22222222-2222-4222-8222-222222222222";
const AUTOMATION_ID = "11111111-1111-4111-8111-111111111111";

const cronTrigger = {
  id: TRIGGER_ID,
  automationId: AUTOMATION_ID,
  enabled: true,
  kind: "cron",
  cronExpression: "0 9 * * *",
  timezone: "UTC",
  nextRunAt: "2026-06-12T09:00:00Z",
  lastRunAt: null,
  consecutiveFailures: 0,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

const mockAutomation = {
  id: AUTOMATION_ID,
  agentId: "550e8400-e29b-41d4-a716-446655440000",
  displayName: "my-agent",
  userId: "user-001",
  name: "alerts-v2",
  description: "Daily alert digest",
  instruction: "Summarize alerts and post to Slack",
  appendSystemPrompt: null,
  enabled: true,
  chatThreadId: "550e8400-e29b-41d4-a716-446655440099",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
  triggers: [],
};

const mockAutomationWithCronTrigger = {
  ...mockAutomation,
  triggers: [cronTrigger],
};

describe("zero automation update command", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit called");
  }) as never);
  const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  const mockConsoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  beforeEach(() => {
    chalk.level = 0;
    vi.stubEnv("VM0_API_URL", "http://localhost:3000");
    vi.stubEnv("VM0_TOKEN", "test-token");
  });

  afterEach(() => {
    mockExit.mockClear();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
  });

  it("should update name, instruction, and description", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let capturedRef: string | undefined;

    server.use(
      http.patch(
        "http://localhost:3000/api/automations/:ref",
        async ({ request, params }) => {
          capturedRef = params.ref as string;
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(mockAutomation);
        },
      ),
    );

    await updateCommand.parseAsync([
      "node",
      "cli",
      "alerts",
      "-n",
      "alerts-v2",
      "-p",
      "Summarize alerts and post to Slack",
      "--description",
      "Daily alert digest",
    ]);

    expect(capturedRef).toBe("alerts");
    expect(capturedBody).toEqual({
      name: "alerts-v2",
      instruction: "Summarize alerts and post to Slack",
      description: "Daily alert digest",
    });

    const logCalls = mockConsoleLog.mock.calls.flat().join("\n");
    expect(logCalls).toContain('Automation "alerts-v2" updated');
  });

  it("should reject when no update flags are given", async () => {
    await expect(async () => {
      await updateCommand.parseAsync(["node", "cli", "alerts"]);
    }).rejects.toThrow("process.exit called");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to update"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("updates the automation's single time trigger in place via --expr", async () => {
    const updatedTrigger = { ...cronTrigger, cronExpression: "0 10 * * *" };
    let patchTriggerBody: Record<string, unknown> | undefined;
    let patchTriggerId: string | undefined;

    server.use(
      // show automation (GET :ref) returns the automation with one cron trigger
      http.get("http://localhost:3000/api/automations/:ref", () => {
        return HttpResponse.json(mockAutomationWithCronTrigger);
      }),
      // updateAutomationTrigger (PATCH /api/automation-triggers/:id)
      http.patch(
        "http://localhost:3000/api/automation-triggers/:id",
        async ({ request, params }) => {
          patchTriggerId = params.id as string;
          patchTriggerBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ trigger: updatedTrigger });
        },
      ),
    );

    await updateCommand.parseAsync([
      "node",
      "cli",
      "alerts",
      "--expr",
      "0 10 * * *",
    ]);

    expect(patchTriggerId).toBe(TRIGGER_ID);
    expect(patchTriggerBody).toEqual({
      kind: "cron",
      cronExpression: "0 10 * * *",
    });

    const logCalls = mockConsoleLog.mock.calls.flat().join("\n");
    expect(logCalls).toContain(`Trigger ${TRIGGER_ID} schedule updated`);
    expect(logCalls).toContain("0 10 * * *");
  });

  it("rejects --expr when automation has no time trigger", async () => {
    server.use(
      http.get("http://localhost:3000/api/automations/:ref", () => {
        return HttpResponse.json(mockAutomation); // triggers: []
      }),
    );

    await expect(async () => {
      await updateCommand.parseAsync(["node", "cli", "alerts", "--expr", "0 9 * * *"]);
    }).rejects.toThrow("process.exit called");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("no time trigger"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects --expr when automation has multiple time triggers", async () => {
    const secondTrigger = { ...cronTrigger, id: "33333333-3333-4333-8333-333333333333" };
    server.use(
      http.get("http://localhost:3000/api/automations/:ref", () => {
        return HttpResponse.json({
          ...mockAutomationWithCronTrigger,
          triggers: [cronTrigger, secondTrigger],
        });
      }),
    );

    await expect(async () => {
      await updateCommand.parseAsync(["node", "cli", "alerts", "--expr", "0 9 * * *"]);
    }).rejects.toThrow("process.exit called");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("2 time triggers"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects conflicting schedule flags", async () => {
    await expect(async () => {
      await updateCommand.parseAsync([
        "node",
        "cli",
        "alerts",
        "--expr",
        "0 9 * * *",
        "--every",
        "15m",
      ]);
    }).rejects.toThrow("process.exit called");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("Only one schedule flag"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("can combine identity and schedule update in one call", async () => {
    const updatedTrigger = { ...cronTrigger, cronExpression: "0 10 * * *" };
    let patchAutomationBody: Record<string, unknown> | undefined;
    let patchTriggerBody: Record<string, unknown> | undefined;

    server.use(
      http.patch(
        "http://localhost:3000/api/automations/:ref",
        async ({ request }) => {
          patchAutomationBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ ...mockAutomation, name: "alerts-v2" });
        },
      ),
      http.get("http://localhost:3000/api/automations/:ref", () => {
        return HttpResponse.json(mockAutomationWithCronTrigger);
      }),
      http.patch(
        "http://localhost:3000/api/automation-triggers/:id",
        async ({ request }) => {
          patchTriggerBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ trigger: updatedTrigger });
        },
      ),
    );

    await updateCommand.parseAsync([
      "node",
      "cli",
      "alerts",
      "-n",
      "alerts-v2",
      "--expr",
      "0 10 * * *",
    ]);

    expect(patchAutomationBody).toMatchObject({ name: "alerts-v2" });
    expect(patchTriggerBody).toEqual({ kind: "cron", cronExpression: "0 10 * * *" });

    const logCalls = mockConsoleLog.mock.calls.flat().join("\n");
    expect(logCalls).toContain('Automation "alerts-v2" updated');
    expect(logCalls).toContain(`Trigger ${TRIGGER_ID} schedule updated`);
  });

  it("should surface API errors", async () => {
    server.use(
      http.patch("http://localhost:3000/api/automations/:ref", () => {
        return HttpResponse.json(
          {
            error: {
              message: "Ambiguous name, use the id",
              code: "BAD_REQUEST",
            },
          },
          { status: 400 },
        );
      }),
    );

    await expect(async () => {
      await updateCommand.parseAsync(["node", "cli", "alerts", "-n", "x"]);
    }).rejects.toThrow("process.exit called");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("Ambiguous name, use the id"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
