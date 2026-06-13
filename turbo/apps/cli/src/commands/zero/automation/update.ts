import { Command } from "commander";
import chalk from "chalk";
import type {
  AutomationTriggerResponse,
  UpdateTriggerRequest,
} from "@vm0/api-contracts/contracts/automations";
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
  cron?: string;
  at?: string;
  every?: string;
  timezone?: string;
}

function isTimeTrigger(
  trigger: AutomationTriggerResponse,
): trigger is AutomationTriggerResponse & {
  kind: "cron" | "once" | "loop";
} {
  return (
    trigger.kind === "cron" ||
    trigger.kind === "once" ||
    trigger.kind === "loop"
  );
}

function buildScheduleBody(options: {
  cron?: string;
  at?: string;
  every?: string;
  timezone?: string;
}): UpdateTriggerRequest {
  const flags = [options.cron, options.at, options.every].filter(
    (v): v is string => v !== undefined,
  );

  if (flags.length === 0) {
    throw new Error(
      "Nothing to update: provide --cron, --at, or --every",
    );
  }
  if (flags.length > 1) {
    throw new Error(
      "Ambiguous schedule: provide exactly one of --cron, --at, or --every",
    );
  }

  if (options.cron) {
    return {
      kind: "cron",
      cronExpression: options.cron,
      timezone: options.timezone,
    };
  }
  if (options.at) {
    return {
      kind: "once",
      atTime: options.at,
      timezone: options.timezone,
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
  .option("--cron <expression>", 'New cron schedule (e.g. "0 9 * * *")')
  .option(
    "--at <iso-time>",
    'New one-time fire time (e.g. "2026-06-10T09:00")',
  )
  .option("--every <duration>", "New loop interval (e.g. 15m, 1h, 90s)")
  .option("-z, --timezone <tz>", "IANA timezone for --cron/--at")
  .addHelpText(
    "after",
    `
Examples:
  zero automation update alerts -p "Summarize alerts and post to Slack"
  zero automation update alerts -n alerts-v2 --description "Daily alert digest"
  zero automation update alerts --cron "30 8 * * 1-5"
  zero automation update alerts --every 30m`,
  )
  .action(
    withErrorHandler(async (ref: string, options: UpdateOptions) => {
      const hasIdentityUpdate =
        options.name || options.prompt || options.description !== undefined;
      const hasScheduleUpdate = !!(options.cron || options.at || options.every);

      if (!hasIdentityUpdate && !hasScheduleUpdate) {
        throw new Error(
          "Nothing to update: provide --name, --prompt, --description, --cron, --at, or --every",
        );
      }

      if (
        options.timezone &&
        !options.cron &&
        !options.at
      ) {
        throw new Error(
          "--timezone only applies to --cron and --at triggers",
        );
      }

      // Update identity/intent fields if provided.
      if (hasIdentityUpdate) {
        const automation = await updateAutomation(ref, {
          name: options.name,
          instruction: options.prompt,
          description: options.description,
        });

        if (!hasScheduleUpdate) {
          console.log(
            chalk.green(`✓ Automation "${automation.name}" updated`),
          );
          return;
        }
      }

      // Update the schedule via in-place trigger update when the automation
      // carries exactly one time trigger.
      if (hasScheduleUpdate) {
        const automation = await showAutomation(ref);
        const timeTriggers = automation.triggers.filter(isTimeTrigger);

        if (timeTriggers.length === 0) {
          throw new Error(
            "No time trigger to update — use `zero automation trigger add` to add one first",
          );
        }
        if (timeTriggers.length > 1) {
          throw new Error(
            "Multiple time triggers — use `zero automation trigger update <trigger-id>` to specify which one",
          );
        }

        const body = buildScheduleBody(options);
        const { trigger } = await updateAutomationTrigger(
          timeTriggers[0].id,
          body,
        );

        console.log(chalk.green(`✓ Automation "${automation.name}" updated`));
        printTriggerDetails(trigger);
        return;
      }
    }),
  );
