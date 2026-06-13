import { Command } from "commander";
import chalk from "chalk";
import type { UpdateTriggerRequest } from "@vm0/api-contracts/contracts/automations";
import { updateAutomationTrigger } from "../../../../lib/api";
import { withErrorHandler } from "../../../../lib/command";
import { parseDurationSeconds } from "../duration";
import { printTriggerDetails } from "../trigger-display";

interface UpdateOptions {
  expr?: string;
  at?: string;
  every?: string;
  timezone?: string;
}

function buildUpdateRequest(options: UpdateOptions): UpdateTriggerRequest {
  const hasExpr = options.expr !== undefined;
  const hasAt = options.at !== undefined;
  const hasEvery = options.every !== undefined;
  const scheduleCount = [hasExpr, hasAt, hasEvery].filter(Boolean).length;

  if (scheduleCount === 0) {
    throw new Error(
      "Provide exactly one schedule flag: --expr (cron), --at (once), or --every (loop)",
    );
  }
  if (scheduleCount > 1) {
    const provided = [
      hasExpr && "--expr",
      hasAt && "--at",
      hasEvery && "--every",
    ].filter(Boolean);
    throw new Error(
      `Only one schedule flag can be used at a time; got: ${provided.join(", ")}`,
    );
  }
  if (hasEvery && options.timezone !== undefined) {
    throw new Error("--timezone does not apply to loop triggers (--every)");
  }

  if (hasExpr) {
    return {
      kind: "cron",
      cronExpression: options.expr!,
      ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
    };
  }
  if (hasAt) {
    return {
      kind: "once",
      atTime: options.at!,
      ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
    };
  }
  return {
    kind: "loop",
    intervalSeconds: parseDurationSeconds(options.every!),
  };
}

export const updateTriggerCommand = new Command()
  .name("update")
  .description("Update a time trigger's schedule in place")
  .argument("<trigger>", "Trigger ID")
  .option(
    "--expr <expression>",
    'New cron expression (e.g. "0 9 * * *")',
  )
  .option(
    "--at <iso-time>",
    'New fire time for a once trigger (e.g. "2026-06-15T09:00")',
  )
  .option(
    "--every <duration>",
    'New interval for a loop trigger (e.g. 15m, 1h, 90s)',
  )
  .option("-z, --timezone <tz>", "IANA timezone for cron/once")
  .addHelpText(
    "after",
    `
Examples:
  zero automation trigger update <trigger-id> --expr "0 10 * * *"
  zero automation trigger update <trigger-id> --every 30m
  zero automation trigger update <trigger-id> --at "2026-06-15T09:00" --timezone Asia/Shanghai
  zero automation trigger update <trigger-id> --expr "0 9 * * 1-5" --timezone America/New_York

Notes:
  - Provide exactly one of --expr, --at, or --every
  - Switching trigger kind (e.g. cron → loop) is supported
  - nextRunAt is recomputed; runtime history (lastRunAt) is preserved`,
  )
  .action(
    withErrorHandler(async (id: string, options: UpdateOptions) => {
      const body = buildUpdateRequest(options);
      const trigger = await updateAutomationTrigger(id, body);

      console.log(chalk.green(`✓ Trigger ${trigger.id} updated`));
      printTriggerDetails(trigger);
    }),
  );
