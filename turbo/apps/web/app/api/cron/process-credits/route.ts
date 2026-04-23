import { NextResponse } from "next/server";
import { initServices } from "../../../../src/lib/init-services";
import { processStaleCredits } from "../../../../src/lib/zero/credit/credit-service";
import { processStaleUsageEvents } from "../../../../src/lib/zero/credit/usage-event-service";
import { logger } from "../../../../src/lib/shared/logger";
import { env } from "../../../../src/env";

const log = logger("cron:process-credits");

export async function GET(request: Request): Promise<Response> {
  initServices();

  const authHeader = request.headers.get("authorization");
  const cronSecret = env().CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: { message: "Invalid cron secret", code: "UNAUTHORIZED" } },
      { status: 401 },
    );
  }

  const processed = await processStaleCredits();
  const processedUsageEvents = await processStaleUsageEvents();

  if (processed > 0 || processedUsageEvents > 0) {
    log.debug("Credit processing cron completed", {
      processed,
      processedUsageEvents,
    });
  }

  return NextResponse.json({
    success: true,
    processed,
    processedUsageEvents,
  });
}
