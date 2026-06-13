import { Command } from "commander";
import chalk from "chalk";
import type { UpdateTriggerRequest } from "@vm0/api-contracts/contracts/automations";
import {
  showAutomation,
  updateAutomation,
  updateAutomationTrigger,
} from "../../../lib/api";
import { withErrorHandler } from "../../../lib/command";
import { parseDurationSeconds } from "./duration";
import { printTriggerDetails } from "./trigger-display";

interface UpdateOptions {
  name?: string;
  prompt?: string;
  description?: string;
  expr?: string;
  at?: string;
  every?: string;
  timezone?: string;
}

function buildScheduleBody(options: UpdateOptions): UpdateTriggerRequest {
  if (options.expr !== undefined) {
    return {
      kind: "cron",
      cronExpression: options.expr,
      ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
    };
  }
  if (options.at !== undefined) {
    return {
      kind: "once",
      atTime: options.at,
      ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
    };
  }
  return {
    kind: "loop",
    intervalSeconds: parseDurationSeconds(options.every!),
  };
}

export const updateCommand = new Command()
  .name("update")
  .description(
    "Update an automation's name, instruction, description, or schedule",
  )
  .argument("<automation>", "Automation ID or name")
  .option("-n, --name <name>", "New automation name")
  .option("-p, --prompt <instruction>", "New instruction")
  .option("--description <text>", "New description")
  .option(
    "--expr <expression>",
    'New cron expression for the automation\'s time trigger (e.g. "0 9 * * *")',
  )
  .option(
    "--at <iso-time>",
    'New one-time fire time (e.g. "2026-06-15T09:00")',
  )
  .option(
    "--every <duration>",
    'New loop interval (e.g. 15m, 1h, 90s)',
  )
  .option("-z, --timezone <tz>", "IANA timezone for cron/once schedule update")
  .addHelpText(
    "after",
    `
Examples:
  zero automation update alerts -p "Summarize alerts and post to Slack"
  zero automation update alerts -n alerts-v2 --description "Daily alert digest"
  zero automation update alerts --expr "0 10 * * *"
  zero automation update morning-brief --every 30m
  zero automation update report --at "2026-06-15T09:00" --timezone Asia/Shanghai

Schedule flags (--expr, --at, --every):
  Exactly one is required when updating the schedule. They update the
  automation's single time trigger in place; the trigger's runtime history
  and ID are preserved. If the automation has zero or multiple time triggers,
  use: zero automation trigger update <trigger-id>`,
  )
  .action(
    withErrorHandler(async (ref: string, options: UpdateOptions) => {
      const hasExpr = options.expr !== undefined;
      const hasAt = options.at !== undefined;
      const hasEvery = options.every !== undefined;
      const scheduleCount = [hasExpr, hasAt, hasEvery].filter(Boolean).length;
      const hasIdentityUpdate =
        options.name !== undefined ||
        options.prompt !== undefined ||
        options.description !== undefined;

      if (!hasIdentityUpdate && scheduleCount === 0) {
        throw new Error(
          "Nothing to update: provide --name, --prompt, --description, or a schedule flag (--expr, --at, --every)",
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

      if (hasIdentityUpdate) {
        const automation = await updateAutomation(ref, {
          name: options.name,
          instruction: options.prompt,
          description: options.description,
        });
        console.log(chalk.green(`✓ Automation "${automation.name}" updated`));
      }

      if (scheduleCount > 0) {
        const automation = await showAutomation(ref);
        const timeTriggers = automation.triggers.filter(
          (t) =>
            t.kind === "cron" || t.kind === "once" || t.kind === "loop",
        );

        if (timeTriggers.length === 0) {
          throw new Error(
            `Automation "${ref}" has no time trigger to update. Add one with:\n` +
              `  zero automation trigger add ${ref} cron --expr "0 9 * * *"`,
          );
        }
        if (timeTriggers.length > 1) {
          const ids = timeTriggers.map((t) => t.id).join(", ");
          throw new Error(
            `Automation "${ref}" has ${timeTriggers.length} time triggers (${ids}).\n` +
              `Use: zero automation trigger update <trigger-id>`,
          );
        }

        const [trigger] = timeTriggers;
        const body = buildScheduleBody(options);
        const updated = await updateAutomationTrigger(trigger!.id, body);
        console.log(chalk.green(`✓ Trigger ${updated.id} schedule updated`));
        printTriggerDetails(updated);
      }
    }),
  );
