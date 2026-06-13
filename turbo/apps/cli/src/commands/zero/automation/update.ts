import { Command } from "commander";
import chalk from "chalk";
import {
  showAutomation,
  updateAutomation,
  updateAutomationTrigger,
} from "../../../lib/api";
import { withErrorHandler } from "../../../lib/command";
import { buildTriggerUpdateRequest } from "./trigger/build-update-request";
import { printTriggerDetails } from "./trigger-display";

interface UpdateOptions {
  name?: string;
  prompt?: string;
  description?: string;
  cron?: string;
  once?: string;
  loop?: string;
  timezone?: string;
}

function isScheduleOption(options: UpdateOptions): boolean {
  return (
    options.cron !== undefined ||
    options.once !== undefined ||
    options.loop !== undefined ||
    options.timezone !== undefined
  );
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
    "--cron <expression>",
    "Update the single time trigger to a cron schedule",
  )
  .option(
    "--once <iso-time>",
    "Update the single time trigger to a one-time fire",
  )
  .option(
    "--loop <duration>",
    "Update the single time trigger to a loop interval",
  )
  .option("-z, --timezone <tz>", "IANA timezone for --cron / --once")
  .addHelpText(
    "after",
    `
Examples:
  zero automation update alerts -p "Summarize alerts and post to Slack"
  zero automation update alerts -n alerts-v2 --description "Daily alert digest"
  zero automation update alerts --cron "0 10 * * *"
  zero automation update alerts --once "2026-06-10T09:00" -z UTC
  zero automation update alerts --loop 15m`,
  )
  .action(
    withErrorHandler(async (ref: string, options: UpdateOptions) => {
      if (
        !options.name &&
        !options.prompt &&
        options.description === undefined &&
        !isScheduleOption(options)
      ) {
        throw new Error(
          "Nothing to update: provide --name, --prompt, --description, or schedule flags",
        );
      }

      const hasIdentityUpdate =
        options.name !== undefined ||
        options.prompt !== undefined ||
        options.description !== undefined;

      if (hasIdentityUpdate) {
        await updateAutomation(ref, {
          name: options.name,
          instruction: options.prompt,
          description: options.description,
        });
      }

      if (isScheduleOption(options)) {
        const body = buildTriggerUpdateRequest({
          expr: options.cron,
          at: options.once,
          every: options.loop,
          timezone: options.timezone,
        });

        const automation = await showAutomation(ref);
        const timeTriggers = automation.triggers.filter((trigger) => {
          return (
            trigger.kind === "cron" ||
            trigger.kind === "once" ||
            trigger.kind === "loop"
          );
        });

        if (timeTriggers.length === 0) {
          throw new Error(
            `Automation "${automation.name}" has no time triggers; use \`zero automation trigger add ${ref} ...\` to add one`,
          );
        }

        if (timeTriggers.length > 1) {
          throw new Error(
            `Automation "${automation.name}" has multiple time triggers; use \`zero automation trigger update <trigger-id> ...\` to update one`,
          );
        }

        const [trigger] = timeTriggers;
        const { trigger: updated } = await updateAutomationTrigger(
          trigger.id,
          body,
        );

        console.log(chalk.green(`✓ Automation "${automation.name}" updated`));
        printTriggerDetails(updated);
        return;
      }

      const automation = await showAutomation(ref);
      console.log(chalk.green(`✓ Automation "${automation.name}" updated`));
    }),
  );
