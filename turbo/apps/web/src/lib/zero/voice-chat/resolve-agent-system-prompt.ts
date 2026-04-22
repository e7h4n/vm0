import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  agentComposes,
  agentComposeVersions,
} from "../../../db/schema/agent-compose";

/**
 * Shape of the agents map inside an agent_compose_version.content blob.
 * We only care about the `description` field of the first agent — additional
 * agents are ignored (voice-chat agents are single-agent today), and
 * unexpected keys pass through `z.object().catchall(z.unknown())`.
 */
const agentComposeContentSchema = z.object({
  agents: z.record(
    z.string(),
    z.object({ description: z.string().optional() }),
  ),
});

/**
 * Resolve the system prompt for a voice-chat agent, reading the head compose
 * version's first agent description. Returns `null` when the caller passed
 * no agentId. Throws when the agent exists but its compose head version is
 * missing or malformed — that condition represents a data-integrity bug
 * (agent was created without a compose version, or the content shape changed
 * without a migration) and must not be silently swallowed into an empty
 * system prompt.
 */
export async function resolveAgentSystemPrompt(
  agentId: string | null,
): Promise<string | null> {
  if (!agentId) return null;
  const db = globalThis.services.db;
  const [row] = await db
    .select({ content: agentComposeVersions.content })
    .from(agentComposes)
    .leftJoin(
      agentComposeVersions,
      eq(agentComposeVersions.id, agentComposes.headVersionId),
    )
    .where(eq(agentComposes.id, agentId))
    .limit(1);
  if (!row) {
    throw new Error(
      `Agent ${agentId} not found when resolving voice-chat system prompt`,
    );
  }
  if (!row.content) {
    throw new Error(
      `Agent ${agentId} has no head compose version; cannot resolve system prompt`,
    );
  }
  const parsed = agentComposeContentSchema.safeParse(row.content);
  if (!parsed.success) {
    throw new Error(
      `Agent ${agentId} compose content has unexpected shape: ${parsed.error.message}`,
    );
  }
  const firstAgent = Object.values(parsed.data.agents)[0];
  return firstAgent?.description ?? null;
}
