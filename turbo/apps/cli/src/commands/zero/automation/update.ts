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
  hasScheduleOptions,
  type ScheduleOptions,
} from "./schedule-options";
import { printTriggerDetails } from "./trigger-display";

interface UpdateOptions extends ScheduleOptions {
  name?: string;
  prompt?: string;
  description?: string;
}

type TimeTrigger = Extract<
  AutomationTriggerResponse,
  { kind: "cron" | "once" | "loop" }
>;

function isTimeTrigger(
  trigger: AutomationTriggerResponse,
): trigger is TimeTrigger {
  return (
    trigger.kind === "cron" ||
    trigger.kind === "once" ||
    trigger.kind === "loop"
  );
}

export const updateCommand = new Command()
  .name("update")
  .description("Update an automation's fields or its single time trigger")
  .argument("<automation>", "Automation ID or name")
  .option("-n, --name <name>", "New automation name")
  .option("-p, --prompt <instruction>", "New instruction")
  .option("--description <text>", "New description")
  .option("--expr <expression>", 'Cron expression (e.g. "0 9 * * *")')
  .option("--at <iso-time>", 'One-time fire time (e.g. "2026-06-10T09:00")')
  .option("--every <duration>", "Loop interval (e.g. 15m, 1h, 90s)")
  .option("-z, --timezone <tz>", "IANA timezone for --expr / --at")
  .addHelpText(
    "after",
    `
Examples:
  zero automation update alerts -p "Summarize alerts and post to Slack"
  zero automation update alerts -n alerts-v2 --description "Daily alert digest"
  zero automation update alerts --expr "0 9 * * *" -z Asia/Shanghai
  zero automation update alerts --every 15m`,
  )
  .action(
    withErrorHandler(async (ref: string, options: UpdateOptions) => {
      const updatesSchedule = hasScheduleOptions(options);
      if (
        !options.name &&
        !options.prompt &&
        options.description === undefined &&
        !updatesSchedule
      ) {
        throw new Error(
          "Nothing to update: provide --name, --prompt, --description, --expr, --at, or --every",
        );
      }

      const scheduleUpdate = updatesSchedule
        ? buildScheduleUpdate(options)
        : null;

      const existing = scheduleUpdate ? await showAutomation(ref) : null;
      const timeTriggers = existing?.triggers.filter(isTimeTrigger) ?? [];
      if (scheduleUpdate && timeTriggers.length !== 1) {
        const countLabel = timeTriggers.length === 0 ? "no" : "multiple";
        throw new Error(
          `Automation "${ref}" has ${countLabel} time triggers. Use zero automation trigger update <trigger-id>.`,
        );
      }

      const updatesIdentity =
        options.name !== undefined ||
        options.prompt !== undefined ||
        options.description !== undefined;
      const automation = updatesIdentity
        ? await updateAutomation(ref, {
            name: options.name,
            instruction: options.prompt,
            description: options.description,
          })
        : existing;

      let trigger: AutomationTriggerResponse | null = null;
      if (scheduleUpdate) {
        const [timeTrigger] = timeTriggers;
        if (!timeTrigger) {
          throw new Error(
            `Automation "${ref}" has no time triggers. Use zero automation trigger update <trigger-id>.`,
          );
        }
        trigger = await updateAutomationTrigger(timeTrigger.id, scheduleUpdate);
      }

      console.log(
        chalk.green(`✓ Automation "${automation?.name ?? ref}" updated`),
      );
      if (trigger) {
        printTriggerDetails(trigger);
      }
    }),
  );
