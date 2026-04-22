import { and, eq, type InferSelectModel } from "drizzle-orm";
import {
  voiceChatEvents,
  voiceChatSessions,
  voiceChatTasks,
} from "../../db/schema/voice-chat";
import { agentRuns } from "../../db/schema/agent-run";

type VoiceChatTaskRow = InferSelectModel<typeof voiceChatTasks>;

/**
 * Read a voice-chat task row by id for test assertions.
 * @why-db-direct Callback/route tests assert terminal state (status, result,
 *   error, finishedAt); `GET /tasks/:id` returns a projection (no direct
 *   row), so assertions on private columns still need DB reads.
 */
export async function getTestVoiceChatTask(
  taskId: string,
): Promise<VoiceChatTaskRow | undefined> {
  const [row] = await globalThis.services.db
    .select()
    .from(voiceChatTasks)
    .where(eq(voiceChatTasks.id, taskId))
    .limit(1);
  return row;
}

/**
 * List voice-chat tasks scoped to a session, ordered by insertion. Used by
 * integration tests that want to verify how cancelSessionPendingRuns
 * terminated in-flight tasks.
 * @why-db-direct Downstream callers need the raw row shape (runId, error)
 *   which is not fully exposed in the JSON task projection.
 */
export async function listTestVoiceChatTasks(
  sessionId: string,
): Promise<VoiceChatTaskRow[]> {
  return globalThis.services.db
    .select()
    .from(voiceChatTasks)
    .where(eq(voiceChatTasks.sessionId, sessionId));
}

/**
 * Read a single task's row constrained to its session (used by the two-task
 * isolation assertions).
 * @why-db-direct Same rationale as getTestVoiceChatTask — tests inspect
 *   columns not exposed by any route.
 */
export async function getTestVoiceChatTaskInSession(
  taskId: string,
  sessionId: string,
): Promise<VoiceChatTaskRow | undefined> {
  const [row] = await globalThis.services.db
    .select()
    .from(voiceChatTasks)
    .where(
      and(
        eq(voiceChatTasks.id, taskId),
        eq(voiceChatTasks.sessionId, sessionId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Read a voice-chat session row snapshot. Used to verify endSession side
 * effects (status flip, endedAt non-null) without relying on a session
 * read API.
 * @why-db-direct No route exposes endedAt; session-service tests need the
 *   concrete column to assert the graceful-exit invariant.
 */
export async function getTestVoiceChatSession(id: string): Promise<
  | {
      status: string;
      endedAt: Date | null;
    }
  | undefined
> {
  const [row] = await globalThis.services.db
    .select({
      status: voiceChatSessions.status,
      endedAt: voiceChatSessions.endedAt,
    })
    .from(voiceChatSessions)
    .where(eq(voiceChatSessions.id, id));
  return row;
}

/**
 * Read an agent_run's status for graceful-exit verification.
 * @why-db-direct Runs have no "read status" route; session-service tests
 *   must inspect agent_runs.status directly to assert the #10429 invariant
 *   (slow-brain runs MUST NOT be cancelled on endSession).
 */
export async function getTestAgentRunStatus(
  runId: string,
): Promise<string | undefined> {
  const [row] = await globalThis.services.db
    .select({ status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  return row?.status;
}

/**
 * Count voice-chat events for a session, filtered by type. Used by
 * createSession tests that assert exactly one `session-end` event was
 * emitted when the stale row was auto-ended.
 * @why-db-direct Event writes are a private side effect; the route that
 * creates them does not expose an event-read API.
 */
export async function listTestVoiceChatEventsByType(
  sessionId: string,
  type: string,
): Promise<Array<{ source: string; content: string | null }>> {
  return globalThis.services.db
    .select({
      source: voiceChatEvents.source,
      content: voiceChatEvents.content,
    })
    .from(voiceChatEvents)
    .where(
      and(
        eq(voiceChatEvents.sessionId, sessionId),
        eq(voiceChatEvents.type, type),
      ),
    );
}

/**
 * Read all voice-chat events for a session. Used by callback + session-end
 * tests that verify the task-completed / task-dispatched events landed.
 * @why-db-direct Events are only exposed through the SSE blackboard stream;
 *   snapshot reads are a test-only concern.
 */
export async function listTestVoiceChatEventsForSession(
  sessionId: string,
): Promise<Array<{ type: string; source: string; content: string | null }>> {
  return globalThis.services.db
    .select({
      type: voiceChatEvents.type,
      source: voiceChatEvents.source,
      content: voiceChatEvents.content,
    })
    .from(voiceChatEvents)
    .where(eq(voiceChatEvents.sessionId, sessionId));
}
