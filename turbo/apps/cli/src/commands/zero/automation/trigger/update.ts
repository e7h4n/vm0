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

function buildUpdateBody(options: UpdateOptions): UpdateTriggerRequest {
  const flags = [options.expr, options.at, options.every].filter(
    (v): v is string => v !== undefined,
  );

  if (flags.length === 0) {
    throw new Error(
      "Nothing to update: provide --expr (cron), --at (once), or --every (loop)",
    );
  }
  if (flags.length > 1) {
    throw new Error(
      "Ambiguous schedule: provide exactly one of --expr, --at, or --every",
    );
  }

  if (options.expr) {
    return {
      kind: "cron",
      cronExpression: options.expr,
      timezone: options.timezone,
    };
  }
  if (options.at) {
    return { kind: "once", atTime: options.at, timezone: options.timezone };
  }
  return {
    kind: "loop",
    intervalSeconds: parseDurationSeconds(options.every!),
  };
}

export const updateCommand = new Command()
  .name("update")
  .description("Update a time trigger's schedule in place")
  .argument("<trigger>", "Trigger ID")
  .option(
    "--expr <expression>",
    'New cron expression (e.g. "0 9 * * *")',
  )
  .option(
    "--at <iso-time>",
    'New one-time fire time (e.g. "2026-06-10T09:00")',
  )
  .option("--every <duration>", "New loop interval (e.g. 15m, 1h, 90s)")
  .option("-z, --timezone <tz>", "IANA timezone for cron/once")
  .addHelpText(
    "after",
    `
Examples:
  Change a cron:  zero automation trigger update <id> --expr "30 8 * * 1-5"
  Change a loop:  zero automation trigger update <id> --every 30m
  Switch to cron: zero automation trigger update <id> --expr "0 9 * * *" --timezone Asia/Shanghai
  Reschedule:     zero automation trigger update <id> --at "2026-12-31T23:59"`,
  )
  .action(
    withErrorHandler(async (id: string, options: UpdateOptions) => {
      if (options.timezone && !options.expr && !options.at) {
        throw new Error("--timezone only applies to cron and once triggers");
      }

      const body = buildUpdateBody(options);

      const { trigger } = await updateAutomationTrigger(id, body);

      console.log(chalk.green(`✓ Trigger ${trigger.id} updated`));
      printTriggerDetails(trigger);
    }),
  );
