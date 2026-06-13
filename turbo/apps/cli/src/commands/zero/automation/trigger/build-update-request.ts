import type { UpdateTriggerRequest } from "@vm0/api-contracts/contracts/automations";
import { parseDurationSeconds } from "../duration";

export interface TriggerUpdateOptions {
  readonly expr?: string;
  readonly at?: string;
  readonly every?: string;
  readonly timezone?: string;
}

/**
 * Build a time-trigger schedule update request from the CLI flags.
 * Rejects missing, ambiguous, or conflicting flags with clear errors.
 */
export function buildTriggerUpdateRequest(
  options: TriggerUpdateOptions,
): UpdateTriggerRequest {
  const provided = [
    options.expr !== undefined ? "expr" : null,
    options.at !== undefined ? "at" : null,
    options.every !== undefined ? "every" : null,
  ].filter((value): value is string => {
    return value !== null;
  });

  if (provided.length === 0) {
    throw new Error("Nothing to update: provide --expr, --at, or --every");
  }

  if (provided.length > 1) {
    throw new Error("Use at most one of --expr, --at, --every");
  }

  if (options.timezone !== undefined && options.every !== undefined) {
    throw new Error("--timezone only applies to cron and once triggers");
  }

  if (options.expr !== undefined) {
    return {
      kind: "cron",
      cronExpression: options.expr,
      ...(options.timezone !== undefined && { timezone: options.timezone }),
    };
  }

  if (options.at !== undefined) {
    return {
      kind: "once",
      atTime: options.at,
      ...(options.timezone !== undefined && { timezone: options.timezone }),
    };
  }

  if (options.every !== undefined) {
    return {
      kind: "loop",
      intervalSeconds: parseDurationSeconds(options.every),
    };
  }

  throw new Error("Nothing to update: provide --expr, --at, or --every");
}
