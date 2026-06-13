import { Command } from "commander";
import chalk from "chalk";
import { updateAutomationTrigger } from "../../../../lib/api";
import { withErrorHandler } from "../../../../lib/command";
import { buildScheduleUpdate, type ScheduleFlags } from "../schedule-update";
import { printTriggerDetails } from "../trigger-display";

export const updateCommand = new Command()
  .name("update")
  .description("Update a time trigger's schedule in place (cron | once | loop)")
  .argument("<trigger>", "Trigger ID")
  .option(
    "--expr <expression>",
    'Switch to a cron schedule (e.g. "0 9 * * *")',
  )
  .option(
    "--at <iso-time>",
    'Switch to a one-time fire (e.g. "2026-06-10T09:00")',
  )
  .option("--every <duration>", "Switch to a loop interval (e.g. 15m, 1h, 90s)")
  .option("-z, --timezone <tz>", "IANA timezone for cron/once")
  .addHelpText(
    "after",
    `
The trigger keeps its id and run history; only its schedule changes. Switching
kinds is allowed (e.g. loop → cron):
  To cron:   zero automation trigger update <trigger-id> --expr "0 9 * * *" [--timezone Asia/Shanghai]
  To once:   zero automation trigger update <trigger-id> --at "2026-06-10T09:00" [--timezone UTC]
  To loop:   zero automation trigger update <trigger-id> --every 15m

Notes:
  - Provide exactly one of --expr, --at, --every
  - Webhook triggers carry no schedule and cannot be updated this way`,
  )
  .action(
    withErrorHandler(async (id: string, options: ScheduleFlags) => {
      const body = buildScheduleUpdate(options);

      const trigger = await updateAutomationTrigger(id, body);

      console.log(chalk.green(`✓ Trigger ${trigger.id} updated`));
      printTriggerDetails(trigger);
    }),
  );
