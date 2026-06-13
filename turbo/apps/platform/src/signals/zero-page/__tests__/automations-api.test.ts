/**
 * Tests for the platform's automations-api.ts helpers.
 *
 * These tests verify that deployAutomation uses the in-place trigger update
 * endpoint (PATCH /api/automation-triggers/:id) when updating an automation
 * with exactly one time trigger, rather than the previous add-then-remove flow.
 */

import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../mocks/server.ts";
import { deployAutomation } from "../automations-api.ts";
import type { ZeroClientFactory } from "../../api-client.ts";
import {
  automationsMainContract,
  automationsByRefContract,
  automationTriggersContract,
} from "@vm0/api-contracts/contracts/automations";
import { initClient } from "@ts-rest/core";

const BASE_URL = "http://localhost";
const AUTOMATION_ID = "a1111111-1111-4111-8111-111111111111";
const AGENT_ID = "b2222222-2222-4222-8222-222222222222";
const TRIGGER_ID = "c3333333-3333-4333-8333-333333333333";

/** Create a simple ts-rest client factory backed by the MSW server. */
function createTestClientFactory(): ZeroClientFactory {
  return <T>(contract: T) => {
    return initClient(contract as Parameters<typeof initClient>[0], {
      baseUrl: BASE_URL,
      validateResponse: false,
    }) as ReturnType<ZeroClientFactory>;
  };
}

const baseAutomationResponse = {
  id: AUTOMATION_ID,
  agentId: AGENT_ID,
  displayName: "Test Agent",
  userId: "user-1",
  name: "daily-brief",
  description: "Daily brief",
  instruction: "Send daily brief",
  appendSystemPrompt: null,
  enabled: true,
  chatThreadId: "d4444444-4444-4444-8444-444444444444",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const cronTriggerResponse = {
  id: TRIGGER_ID,
  automationId: AUTOMATION_ID,
  enabled: true,
  kind: "cron" as const,
  cronExpression: "0 9 * * *",
  timezone: "UTC",
  nextRunAt: "2026-06-12T09:00:00.000Z",
  lastRunAt: null,
  consecutiveFailures: 0,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const automationWithCronTrigger = {
  ...baseAutomationResponse,
  triggers: [cronTriggerResponse],
};

describe("deployAutomation — platform edit flow", () => {
  it("uses PATCH /api/automation-triggers/:id for single trigger in-place update", async () => {
    let patchTriggerId: string | undefined;
    let patchTriggerBody: Record<string, unknown> | undefined;
    let addTriggerCalled = false;

    const updatedTrigger = {
      ...cronTriggerResponse,
      cronExpression: "0 10 * * *",
      id: TRIGGER_ID,
    };

    server.use(
      // list to find by name+agent
      http.get(`${BASE_URL}/api/automations`, () => {
        return HttpResponse.json({
          automations: [automationWithCronTrigger],
        });
      }),
      // patch automation identity
      http.patch(`${BASE_URL}/api/automations/${AUTOMATION_ID}`, async () => {
        return HttpResponse.json(automationWithCronTrigger);
      }),
      // PATCH trigger in place
      http.patch(
        `${BASE_URL}/api/automation-triggers/${TRIGGER_ID}`,
        async ({ params, request }) => {
          patchTriggerId = params.id as string;
          patchTriggerBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ trigger: updatedTrigger });
        },
      ),
      // ensure add-trigger is NOT called
      http.post(`${BASE_URL}/api/automations/${AUTOMATION_ID}/triggers`, () => {
        addTriggerCalled = true;
        return HttpResponse.json({ trigger: cronTriggerResponse }, { status: 201 });
      }),
    );

    const client = createTestClientFactory();

    const result = await deployAutomation(
      client,
      {
        name: "daily-brief",
        agentId: AGENT_ID,
        prompt: "Send daily brief",
        description: "Daily brief",
        timezone: "UTC",
        cronExpression: "0 10 * * *",
      },
      true,
    );

    expect(result.id).toBe(AUTOMATION_ID);
    expect(result.created).toBe(false);
    // In-place PATCH used, not add-then-remove.
    expect(patchTriggerId).toBe(TRIGGER_ID);
    expect(patchTriggerBody).toEqual({
      kind: "cron",
      cronExpression: "0 10 * * *",
      timezone: "UTC",
    });
    expect(addTriggerCalled).toBe(false);
  });

  it("skips trigger call when config already matches", async () => {
    let patchTriggerCalled = false;
    let addTriggerCalled = false;
    let removeTriggerCalled = false;

    server.use(
      http.get(`${BASE_URL}/api/automations`, () => {
        return HttpResponse.json({
          automations: [automationWithCronTrigger],
        });
      }),
      http.patch(`${BASE_URL}/api/automations/${AUTOMATION_ID}`, async () => {
        return HttpResponse.json(automationWithCronTrigger);
      }),
      http.patch(`${BASE_URL}/api/automation-triggers/${TRIGGER_ID}`, () => {
        patchTriggerCalled = true;
        return HttpResponse.json({ trigger: cronTriggerResponse });
      }),
      http.post(`${BASE_URL}/api/automations/${AUTOMATION_ID}/triggers`, () => {
        addTriggerCalled = true;
        return HttpResponse.json({ trigger: cronTriggerResponse }, { status: 201 });
      }),
      http.delete(`${BASE_URL}/api/automation-triggers/${TRIGGER_ID}`, () => {
        removeTriggerCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = createTestClientFactory();

    await deployAutomation(
      client,
      {
        name: "daily-brief",
        agentId: AGENT_ID,
        prompt: "Send daily brief",
        description: "Daily brief",
        timezone: "UTC",
        // Same config as stored.
        cronExpression: "0 9 * * *",
      },
      true,
    );

    expect(patchTriggerCalled).toBe(false);
    expect(addTriggerCalled).toBe(false);
    expect(removeTriggerCalled).toBe(false);
  });

  it("falls back to add-then-remove for multiple non-matching time triggers", async () => {
    const secondTriggerId = "e5555555-5555-4555-8555-555555555555";
    const secondTrigger = {
      ...cronTriggerResponse,
      id: secondTriggerId,
      cronExpression: "0 10 * * *",
    };
    const automationWithTwoTriggers = {
      ...baseAutomationResponse,
      triggers: [cronTriggerResponse, secondTrigger],
    };

    const newTriggerId = "f6666666-6666-4666-8666-666666666666";
    const removedIds: string[] = [];
    let addTriggerCalled = false;
    let inPlacePatchCalled = false;

    server.use(
      http.get(`${BASE_URL}/api/automations`, () => {
        return HttpResponse.json({ automations: [automationWithTwoTriggers] });
      }),
      http.patch(`${BASE_URL}/api/automations/${AUTOMATION_ID}`, async () => {
        return HttpResponse.json(automationWithTwoTriggers);
      }),
      http.post(
        `${BASE_URL}/api/automations/${AUTOMATION_ID}/triggers`,
        () => {
          addTriggerCalled = true;
          return HttpResponse.json(
            {
              trigger: {
                ...cronTriggerResponse,
                id: newTriggerId,
                cronExpression: "0 11 * * *",
              },
            },
            { status: 201 },
          );
        },
      ),
      http.delete(`${BASE_URL}/api/automation-triggers/:id`, ({ params }) => {
        removedIds.push(params.id as string);
        return new HttpResponse(null, { status: 204 });
      }),
      http.patch(`${BASE_URL}/api/automation-triggers/:id`, () => {
        inPlacePatchCalled = true;
        return HttpResponse.json({ trigger: cronTriggerResponse });
      }),
    );

    const client = createTestClientFactory();

    await deployAutomation(
      client,
      {
        name: "daily-brief",
        agentId: AGENT_ID,
        prompt: "Send daily brief",
        description: "Daily brief",
        timezone: "UTC",
        cronExpression: "0 11 * * *",
      },
      true,
    );

    // With 2 non-matching triggers, falls back to add-then-remove.
    expect(addTriggerCalled).toBe(true);
    expect(inPlacePatchCalled).toBe(false);
    expect(removedIds).toContain(TRIGGER_ID);
    expect(removedIds).toContain(secondTriggerId);
  });
});
