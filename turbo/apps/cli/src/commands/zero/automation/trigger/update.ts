import { Command } from "commander";
import chalk from "chalk";
import { updateAutomationTrigger } from "../../../../lib/api";
import { withErrorHandler } from "../../../../lib/command";
import {
  buildTriggerUpdateRequest,
  type TriggerUpdateOptions,
} from "./build-update-request";
import { printTriggerDetails } from "../trigger-display";

export const updateCommand = new Command()
  .name("update")
  .description("Update a time trigger's schedule in place")
  .argument("<trigger>", "Trigger ID")
  .option("--expr <expression>", 'New cron expression (e.g. "0 9 * * *")')
  .option("--at <iso-time>", 'New one-time fire time (e.g. "2026-06-10T09:00")')
  .option("--every <duration>", "New loop interval (e.g. 15m, 1h, 90s)")
  .option("-z, --timezone <tz>", "IANA timezone for cron/once")
  .addHelpText(
    "after",
    `
Examples:
  Change cron expr:   zero automation trigger update 22222222-2222-4222-8222-222222222222 --expr "0 10 * * *"
  Switch to once:     zero automation trigger update 22222222-2222-4222-8222-222222222222 --at "2026-06-10T09:00" -z UTC
  Switch to loop:     zero automation trigger update 22222222-2222-4222-8222-222222222222 --every 15m

Notes:
  - Webhook triggers cannot be updated with this command
  - The trigger id stays the same; only the schedule changes`,
  )
  .action(
    withErrorHandler(async (id: string, options: TriggerUpdateOptions) => {
      const body = buildTriggerUpdateRequest(options);

      const { trigger } = await updateAutomationTrigger(id, body);

      console.log(chalk.green(`✓ Trigger ${trigger.id} updated`));
      printTriggerDetails(trigger);
    }),
  );
