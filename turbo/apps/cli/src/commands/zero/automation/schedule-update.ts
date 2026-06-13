import type { UpdateTriggerScheduleRequest } from "@vm0/api-contracts/contracts/automations";
import { parseDurationSeconds } from "./duration";

/**
 * The schedule flags shared by `automation trigger update` and the
 * `automation update` schedule sugar: a time trigger's kind is inferred from
 * which one is present (--expr → cron, --at → once, --every → loop), with
 * --timezone applying to cron/once only.
 */
export interface ScheduleFlags {
  expr?: string;
  at?: string;
  every?: string;
  timezone?: string;
}

/** Whether any schedule flag was supplied (for the update sugar's gating). */
export function hasScheduleFlag(flags: ScheduleFlags): boolean {
  return (
    flags.expr !== undefined ||
    flags.at !== undefined ||
    flags.every !== undefined ||
    flags.timezone !== undefined
  );
}

/**
 * Resolve the schedule flags into an in-place trigger schedule update. Exactly
 * one of --expr / --at / --every must be given; a missing, ambiguous, or
 * conflicting combination throws a clear error.
 */
export function buildScheduleUpdate(
  flags: ScheduleFlags,
): UpdateTriggerScheduleRequest {
  const provided = [
    flags.expr !== undefined,
    flags.at !== undefined,
    flags.every !== undefined,
  ].filter(Boolean).length;

  if (provided > 1) {
    throw new Error("Use at most one of --expr, --at, --every");
  }

  if (flags.expr !== undefined) {
    return {
      kind: "cron",
      cronExpression: flags.expr,
      timezone: flags.timezone,
    };
  }
  if (flags.at !== undefined) {
    return { kind: "once", atTime: flags.at, timezone: flags.timezone };
  }
  if (flags.every !== undefined) {
    if (flags.timezone !== undefined) {
      throw new Error(
        "--timezone only applies to --expr (cron) or --at (once)",
      );
    }
    return { kind: "loop", intervalSeconds: parseDurationSeconds(flags.every) };
  }

  throw new Error(
    "Provide one schedule flag: --expr (cron), --at (once), or --every (loop)",
  );
}
