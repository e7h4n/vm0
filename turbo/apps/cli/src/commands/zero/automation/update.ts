import { Command } from "commander";
import chalk from "chalk";
import type { AutomationTriggerResponse } from "@vm0/api-contracts/contracts/automations";
import {
  showAutomation,
  updateAutomation,
  updateAutomationTrigger,
} from "../../../lib/api";
import { withErrorHandler } from "../../../lib/command";
import {
  buildScheduleUpdate,
  hasScheduleFlag,
  type ScheduleFlags,
} from "./schedule-update";

interface UpdateOptions extends ScheduleFlags {
  name?: string;
  prompt?: string;
  description?: string;
}

function isTimeTrigger(trigger: AutomationTriggerResponse): boolean {
  return (
    trigger.kind === "cron" ||
    trigger.kind === "once" ||
    trigger.kind === "loop"
  );
}

// Update the automation's single time trigger in place. Sugar for the common
// case; an automation with zero or multiple time triggers is ambiguous, so the
// user is sent to the per-trigger command (which addresses a trigger by id).
async function updateSingleTimeTrigger(
  ref: string,
  options: ScheduleFlags,
): Promise<void> {
  const body = buildScheduleUpdate(options);

  const automation = await showAutomation(ref);
  const timeTriggers = automation.triggers.filter(isTimeTrigger);

  if (timeTriggers.length !== 1) {
    const detail =
      timeTriggers.length === 0
        ? `Automation "${ref}" has no time trigger to update`
        : `Automation "${ref}" has ${timeTriggers.length} time triggers`;
    throw new Error(
      `${detail}. Update one by id with: zero automation trigger update <trigger-id>`,
    );
  }

  const trigger = await updateAutomationTrigger(timeTriggers[0]!.id, body);

  console.log(chalk.green(`✓ Trigger ${trigger.id} schedule updated`));
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
    'Reschedule its time trigger to cron (e.g. "0 9 * * *")',
  )
  .option(
    "--at <iso-time>",
    'Reschedule its time trigger to once (e.g. "2026-06-10T09:00")',
  )
  .option(
    "--every <duration>",
    "Reschedule its time trigger to loop (e.g. 15m, 1h, 90s)",
  )
  .option("-z, --timezone <tz>", "IANA timezone for --expr / --at")
  .addHelpText(
    "after",
    `
Examples:
  zero automation update alerts -p "Summarize alerts and post to Slack"
  zero automation update alerts -n alerts-v2 --description "Daily alert digest"
  zero automation update alerts --every 30m
  zero automation update alerts --expr "0 9 * * *" -z Asia/Shanghai

Notes:
  - The schedule flags update the automation's single time trigger in place.
    For an automation with zero or multiple time triggers, address a trigger by
    id with: zero automation trigger update <trigger-id>`,
  )
  .action(
    withErrorHandler(async (ref: string, options: UpdateOptions) => {
      const scheduleRequested = hasScheduleFlag(options);
      const identityRequested =
        options.name !== undefined ||
        options.prompt !== undefined ||
        options.description !== undefined;

      if (!identityRequested && !scheduleRequested) {
        throw new Error(
          "Nothing to update: provide --name, --prompt, --description, or a schedule flag (--expr/--at/--every)",
        );
      }

      if (identityRequested) {
        const automation = await updateAutomation(ref, {
          name: options.name,
          instruction: options.prompt,
          description: options.description,
        });
        console.log(chalk.green(`✓ Automation "${automation.name}" updated`));
      }

      if (scheduleRequested) {
        await updateSingleTimeTrigger(ref, options);
      }
    }),
  );
