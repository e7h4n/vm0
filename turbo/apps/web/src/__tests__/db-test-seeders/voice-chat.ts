import { eq } from "drizzle-orm";
import {
  voiceChatEvents,
  voiceChatSessions,
  voiceChatTasks,
} from "../../db/schema/voice-chat";

/**
 * Seed a voice-chat task row directly.
 * @why-db-direct Callback + cancel tests need to construct a task row with a
 *   pre-assigned runId / non-pending status that the public POST /tasks route
 *   would not produce (it always starts pending, attaches a run it just
 *   created, then flips to queued).
 */
export async function seedTestVoiceChatTask(overrides: {
  sessionId: string;
  prompt?: string;
  status?: "pending" | "queued" | "running" | "done" | "failed";
  runId?: string;
  result?: string | null;
  error?: string | null;
  createdAt?: Date;
  finishedAt?: Date | null;
}): Promise<{ id: string }> {
  const [row] = await globalThis.services.db
    .insert(voiceChatTasks)
    .values({
      sessionId: overrides.sessionId,
      prompt: overrides.prompt ?? "test prompt",
      status: overrides.status ?? "pending",
      runId: overrides.runId,
      result: overrides.result ?? null,
      error: overrides.error ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      ...(overrides.finishedAt !== undefined
        ? { finishedAt: overrides.finishedAt }
        : {}),
    })
    .returning({ id: voiceChatTasks.id });
  return row!;
}

/**
 * Attach a runId to an existing voice-chat task row (simulates the
 * POST /tasks happy path side-effect so tests can set up downstream state
 * without dispatching a real zero run).
 * @why-db-direct No public API exists to attach a runId to a task post-hoc;
 *   the productive path creates task + run in one shot.
 */
export async function attachTestVoiceChatTaskRun(params: {
  taskId: string;
  runId: string;
}): Promise<void> {
  await globalThis.services.db
    .update(voiceChatTasks)
    .set({ runId: params.runId, status: "queued" })
    .where(eq(voiceChatTasks.id, params.taskId));
}

/**
 * Flip a voice-chat session row into an end state (`ended` or `timeout`)
 * without going through endSession. Used by callback-race tests that need
 * a session already ended by the time the callback arrives.
 * @why-db-direct endSession performs cancel-run work that would clobber the
 *   test's own seeded runs.
 */
export async function markTestVoiceChatSessionEnded(
  sessionId: string,
  status: "ended" | "timeout" = "ended",
): Promise<void> {
  await globalThis.services.db
    .update(voiceChatSessions)
    .set({ status, endedAt: new Date() })
    .where(eq(voiceChatSessions.id, sessionId));
}

/**
 * Flip a voice-chat session row's status to `active` (bypassing the full
 * activate flow) so endSession accepts it. Used in session-service tests.
 * @why-db-direct createSession returns 'preparing'; flipping to 'active' via
 *   the public surface would require running the full activation flow.
 */
export async function markTestVoiceChatSessionActive(
  sessionId: string,
): Promise<void> {
  await globalThis.services.db
    .update(voiceChatSessions)
    .set({ status: "active" })
    .where(eq(voiceChatSessions.id, sessionId));
}

/**
 * Attach a runId to an existing voice-chat session row.
 * @why-db-direct session-service tests link a session row to a pre-seeded
 *   agent_run; no public API accepts an externally-created runId.
 */
export async function attachTestVoiceChatSessionRun(params: {
  sessionId: string;
  runId: string;
}): Promise<void> {
  await globalThis.services.db
    .update(voiceChatSessions)
    .set({ runId: params.runId })
    .where(eq(voiceChatSessions.id, params.sessionId));
}

/**
 * Seed a voice-chat session row with full override support (including a
 * pre-assigned runId pointing at an externally seeded agent_run). Extends
 * insertTestVoiceChatSession with the `runId` parameter needed by
 * session-service tests.
 * @why-db-direct Voice chat sessions require WebSocket infrastructure; full
 *   override enables impossible-state testing.
 */
export async function seedTestVoiceChatSessionRow(overrides: {
  orgId: string;
  userId: string;
  agentId: string;
  runId?: string;
  status?: "active" | "preparing" | "ended" | "timeout";
  createdAt?: Date;
}): Promise<{ id: string }> {
  const [row] = await globalThis.services.db
    .insert(voiceChatSessions)
    .values({
      orgId: overrides.orgId,
      userId: overrides.userId,
      agentId: overrides.agentId,
      runId: overrides.runId,
      status: overrides.status ?? "active",
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    })
    .returning({ id: voiceChatSessions.id });
  return row!;
}

/**
 * Back-date a voice-chat task's createdAt timestamp for ordering tests.
 * @why-db-direct Postgres `now()` cannot be manually advanced; tests that
 *   need deterministic ordering between two rows created in the same
 *   millisecond must adjust the column directly rather than relying on
 *   wall-clock sleeps.
 */
export async function backDateTestVoiceChatTask(
  taskId: string,
  createdAt: Date,
): Promise<void> {
  await globalThis.services.db
    .update(voiceChatTasks)
    .set({ createdAt })
    .where(eq(voiceChatTasks.id, taskId));
}

/**
 * Append a system-source lifecycle event row directly for tests that need
 * a pre-existing event in the blackboard. Mirrors the production writer
 * shape so downstream assertions are not coupled to private service helpers.
 * @why-db-direct Event writes are internal-only; no external API accepts
 *   a system-source event of the `task-dispatched` / `task-completed` types.
 */
export async function seedTestVoiceChatTaskEvent(params: {
  sessionId: string;
  type: "task-dispatched" | "task-completed";
  taskId: string;
}): Promise<void> {
  await globalThis.services.db.insert(voiceChatEvents).values({
    sessionId: params.sessionId,
    source: "system",
    type: params.type,
    content: JSON.stringify({ taskId: params.taskId }),
  });
}
