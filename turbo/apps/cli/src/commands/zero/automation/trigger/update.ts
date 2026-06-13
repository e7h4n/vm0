import { Command } from "commander";
import chalk from "chalk";
import { updateAutomationTrigger } from "../../../../lib/api";
import { withErrorHandler } from "../../../../lib/command";
import { buildScheduleUpdate, type ScheduleOptions } from "../schedule-options";
import { printTriggerDetails } from "../trigger-display";

export const updateCommand = new Command()
  .name("update")
  .description("Update a time trigger schedule in place")
  .argument("<trigger>", "Trigger ID")
  .option("--expr <expression>", 'Cron expression (e.g. "0 9 * * *")')
  .option("--at <iso-time>", 'One-time fire time (e.g. "2026-06-10T09:00")')
  .option("--every <duration>", "Loop interval (e.g. 15m, 1h, 90s)")
  .option("-z, --timezone <tz>", "IANA timezone for --expr / --at")
  .addHelpText(
    "after",
    `
Examples:
  Daily cron:   zero automation trigger update <trigger-id> --expr "0 9 * * *" -z Asia/Shanghai
  One-time:     zero automation trigger update <trigger-id> --at "2026-06-10T09:00" -z UTC
  Fixed loop:   zero automation trigger update <trigger-id> --every 15m`,
  )
  .action(
    withErrorHandler(async (id: string, options: ScheduleOptions) => {
      const body = buildScheduleUpdate(options);
      const trigger = await updateAutomationTrigger(id, body);

      console.log(chalk.green(`✓ Trigger ${trigger.id} updated`));
      printTriggerDetails(trigger);
    }),
  );
