import { describe, it, expect } from "vitest";
import { testContext, uniqueId } from "../../../../__tests__/test-helpers";
import { seedTestCompose } from "../../../../__tests__/db-test-seeders/agents";
import { seedTestRun } from "../../../../__tests__/db-test-seeders/runs";
// eslint-disable-next-line web/no-direct-db-in-tests -- Service-level exception: no API route covers these services yet
import {
  createSession,
  endSession,
  getPriorVoiceChatAgentSessionId,
} from "../session-service";
import {
  attachTestVoiceChatSessionRun,
  attachTestVoiceChatTaskRun,
  getTestAgentRunStatus,
  getTestVoiceChatSession,
  getTestVoiceChatTask,
  listTestVoiceChatEventsByType,
  listTestVoiceChatEventsForSession,
  listTestVoiceChatTasks,
  markTestVoiceChatSessionActive,
  seedTestVoiceChatSessionRow,
  seedTestVoiceChatTask,
} from "../../../../__tests__/api-test-helpers";

const context = testContext();

async function seedAgent() {
  const { userId, orgId } = await context.setupUser();
  const { composeId } = await seedTestCompose({
    userId,
    orgId,
    name: uniqueId("voice-chat-compose"),
  });
  return { userId, orgId, agentId: composeId };
}

/**
 * Seed a voice-chat session row with a pre-assigned runId pointing at a
 * freshly-seeded agent_runs record. Returns all three so callers can assert
 * side effects on each independently.
 */
async function seedSessionWithRun(options: {
  orgId: string;
  userId: string;
  agentId: string;
  runStatus?: string;
  runResult?: Record<string, unknown>;
  sessionStatus?: "active" | "preparing" | "ended" | "timeout";
  createdAt?: Date;
}) {
  const { runId } = await seedTestRun(options.userId, options.agentId, {
    orgId: options.orgId,
    status: options.runStatus ?? "running",
    result: options.runResult,
    triggerSource: "voice-chat",
  });

  const { id } = await seedTestVoiceChatSessionRow({
    orgId: options.orgId,
    userId: options.userId,
    agentId: options.agentId,
    runId,
    status: options.sessionStatus ?? "active",
    createdAt: options.createdAt,
  });
  return { sessionId: id, runId };
}

describe("endSession — cancelSessionPendingRuns hook", () => {
  it("cancels in-flight tasker runs and marks their task rows failed", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    const session = await createSession(orgId, userId, agentId);
    await markTestVoiceChatSessionActive(session.id);

    const task = await seedTestVoiceChatTask({
      sessionId: session.id,
      prompt: "ongoing",
    });
    const { runId } = await seedTestRun(userId, agentId, {
      orgId,
      status: "running",
      triggerSource: "voice-chat",
    });
    await attachTestVoiceChatTaskRun({ taskId: task.id, runId });

    await endSession(session.id, orgId, userId);

    const tasks = await listTestVoiceChatTasks(session.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe("failed");
    expect(tasks[0]!.error).toBe("session ended");

    expect(await getTestAgentRunStatus(runId)).toBe("cancelled");
  });
});

describe("endSession — graceful slow-brain exit", () => {
  it("updates session status to 'ended' and leaves the slow-brain run untouched", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    // createSession establishes a preparing row so we exercise the full path.
    const session = await createSession(orgId, userId, agentId);
    // Link a seeded running agent_run — simulating an in-flight slow-brain.
    const { runId } = await seedTestRun(userId, agentId, {
      orgId,
      status: "running",
      triggerSource: "voice-chat",
    });
    await attachTestVoiceChatSessionRun({ sessionId: session.id, runId });

    await endSession(session.id, orgId, userId);

    const sessionAfter = await getTestVoiceChatSession(session.id);
    expect(sessionAfter!.status).toBe("ended");
    expect(sessionAfter!.endedAt).not.toBeNull();

    // The critical invariant: agent_runs.status MUST NOT be mutated.
    // Prior behaviour flipped it to 'cancelled' which prevented the
    // agent-complete webhook from populating result.agentSessionId —
    // and consequently blocked session continuation.
    expect(await getTestAgentRunStatus(runId)).toBe("running");
  });
});

describe("getPriorVoiceChatAgentSessionId", () => {
  it("returns the agentSessionId from the most recent ended session", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "ended",
      runResult: { agentSessionId: "older-cc-session" },
      createdAt: new Date(Date.now() - 2 * 60_000),
    });
    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "ended",
      runResult: { agentSessionId: "newer-cc-session" },
      createdAt: new Date(Date.now() - 30_000),
    });

    const result = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(result).toBe("newer-cc-session");
  });

  it("skips recent sessions whose run did not write an agentSessionId", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    // Earlier session has a valid id.
    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "ended",
      runResult: { agentSessionId: "earlier-cc-session" },
      createdAt: new Date(Date.now() - 2 * 60_000),
    });
    // More recent session's run never populated result.agentSessionId
    // (e.g. crashed before the agent-complete webhook fired). The 5-row
    // scan should fall through past it.
    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "ended",
      runResult: { other: "noise" },
      createdAt: new Date(Date.now() - 30_000),
    });

    const result = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(result).toBe("earlier-cc-session");
  });

  it("returns null when no prior sessions exist for the user", async () => {
    context.setupMocks();
    const { userId, orgId } = await seedAgent();

    const result = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(result).toBeNull();
  });

  it("returns null when every prior session's run lacks an agentSessionId", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "ended",
      runResult: { other: "noise" },
    });

    const result = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(result).toBeNull();
  });

  it("matches both 'ended' and 'timeout' status values", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "timeout",
      runResult: { agentSessionId: "cron-timeout-cc-session" },
    });

    const result = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(result).toBe("cron-timeout-cc-session");
  });

  it("ignores active and preparing sessions", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    // Active session should be ignored even if its run already has a session id
    // — the session is still in flight, not a valid continuation source yet.
    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "active",
      runResult: { agentSessionId: "still-running-cc-session" },
    });

    const result = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(result).toBeNull();
  });

  it("is scoped by (orgId, userId) — does not leak across users", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    // Seed a prior session owned by a different user. setupUser() caches the
    // default user — passing a distinct prefix forces a fresh (userId, orgId).
    const other = await context.setupUser({ prefix: "other-user" });
    await seedSessionWithRun({
      orgId: other.orgId,
      userId: other.userId,
      agentId,
      sessionStatus: "ended",
      runResult: { agentSessionId: "other-user-cc-session" },
    });

    const result = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(result).toBeNull();
  });
});

describe("createSession — auto-end stale rows", () => {
  it("transitions an existing 'active' row to 'ended' and creates a new row", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    const { sessionId: staleId } = await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "active",
    });

    const fresh = await createSession(orgId, userId, agentId);

    expect(fresh.id).not.toBe(staleId);
    expect(fresh.status).toBe("preparing");

    const stale = await getTestVoiceChatSession(staleId);
    expect(stale!.status).toBe("ended");
    expect(stale!.endedAt).not.toBeNull();

    const endEvents = await listTestVoiceChatEventsByType(
      staleId,
      "session-end",
    );
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]!.source).toBe("system");
  });

  it("transitions an existing 'preparing' row to 'ended' and creates a new row", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    const { sessionId: staleId } = await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "preparing",
    });

    const fresh = await createSession(orgId, userId, agentId);

    expect(fresh.id).not.toBe(staleId);

    const stale = await getTestVoiceChatSession(staleId);
    expect(stale!.status).toBe("ended");
  });

  it("leaves stale run's agent_runs.status untouched (graceful-exit invariant)", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    const { runId } = await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "active",
      runStatus: "running",
    });

    await createSession(orgId, userId, agentId);

    // invariant check from #10429
    expect(await getTestAgentRunStatus(runId)).toBe("running");
  });

  it("hands the stale run's agentSessionId to getPriorVoiceChatAgentSessionId for continuation", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "active",
      runResult: { agentSessionId: "prior-cc-session" },
    });

    await createSession(orgId, userId, agentId);

    const prior = await getPriorVoiceChatAgentSessionId(orgId, userId);
    expect(prior).toBe("prior-cc-session");
  });

  it("cancels in-flight tasks on the stale session it force-ends", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    const { sessionId: staleId } = await seedSessionWithRun({
      orgId,
      userId,
      agentId,
      sessionStatus: "active",
    });

    const staleTask = await seedTestVoiceChatTask({
      sessionId: staleId,
      prompt: "stale-task",
    });
    const { runId: staleTaskRunId } = await seedTestRun(userId, agentId, {
      orgId,
      status: "running",
      triggerSource: "voice-chat",
    });
    await attachTestVoiceChatTaskRun({
      taskId: staleTask.id,
      runId: staleTaskRunId,
    });

    await createSession(orgId, userId, agentId);

    const taskRow = await getTestVoiceChatTask(staleTask.id);
    expect(taskRow!.status).toBe("failed");
    expect(taskRow!.error).toBe("session ended");

    expect(await getTestAgentRunStatus(staleTaskRunId)).toBe("cancelled");
  });

  it("does not touch other users' active rows", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();
    const other = await context.setupUser({ prefix: "other-user" });

    const { sessionId: otherStaleId } = await seedSessionWithRun({
      orgId: other.orgId,
      userId: other.userId,
      agentId,
      sessionStatus: "active",
    });

    await createSession(orgId, userId, agentId);

    const untouched = await getTestVoiceChatSession(otherStaleId);
    expect(untouched!.status).toBe("active");
    expect(untouched!.endedAt).toBeNull();
  });

  it("creates the row without emitting a session-end event when no stale row exists", async () => {
    context.setupMocks();
    const { userId, orgId, agentId } = await seedAgent();

    const fresh = await createSession(orgId, userId, agentId);

    const events = await listTestVoiceChatEventsForSession(fresh.id);
    expect(events).toHaveLength(0);
  });
});
