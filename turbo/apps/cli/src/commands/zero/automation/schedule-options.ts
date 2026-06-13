import type { UpdateTriggerRequest } from "@vm0/api-contracts/contracts/automations";
import { parseDurationSeconds } from "./duration";

export interface ScheduleOptions {
  readonly expr?: string;
  readonly at?: string;
  readonly every?: string;
  readonly timezone?: string;
}

export function hasScheduleOptions(options: ScheduleOptions): boolean {
  return (
    options.expr !== undefined ||
    options.at !== undefined ||
    options.every !== undefined ||
    options.timezone !== undefined
  );
}

export function buildScheduleUpdate(
  options: ScheduleOptions,
): UpdateTriggerRequest {
  const scheduleCount = [options.expr, options.at, options.every].filter(
    (value) => {
      return value !== undefined;
    },
  ).length;

  if (scheduleCount === 0) {
    if (options.timezone !== undefined) {
      throw new Error("--timezone requires --expr or --at");
    }
    throw new Error("Provide one of --expr, --at, or --every");
  }

  if (scheduleCount > 1) {
    throw new Error("Use only one of --expr, --at, or --every");
  }

  if (options.every !== undefined && options.timezone !== undefined) {
    throw new Error("--timezone only applies with --expr or --at");
  }

  if (options.expr !== undefined) {
    return {
      kind: "cron",
      cronExpression: options.expr,
      timezone: options.timezone,
    };
  }

  if (options.at !== undefined) {
    return {
      kind: "once",
      atTime: options.at,
      timezone: options.timezone,
    };
  }

  const every = options.every;
  if (every === undefined) {
    throw new Error("Provide one of --expr, --at, or --every");
  }
  return {
    kind: "loop",
    intervalSeconds: parseDurationSeconds(every),
  };
}
