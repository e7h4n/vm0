import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "../route";
import {
  testContext,
  uniqueId,
  type UserContext,
} from "../../../../../src/__tests__/test-helpers";
import {
  insertTestUsagePricing,
  insertTestUsageEvent,
  findTestUsageEvent,
  insertTestCreditPricing,
  insertTestCreditUsage,
  getOrgCredits,
  insertOrgCacheEntry,
  insertOrgMembersEntry,
  getOrgMembersEntry,
  updateOrgStripeFields,
  setOrgCredits,
} from "../../../../../src/__tests__/api-test-helpers";
import { reloadEnv } from "../../../../../src/env";

vi.hoisted(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
});

const context = testContext();

function cronRequest(secret?: string) {
  return new Request("http://localhost:3000/api/cron/process-credits", {
    method: "GET",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("GET /api/cron/process-credits — usage_event processing", () => {
  let user: UserContext;

  beforeEach(async () => {
    context.setupMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    reloadEnv();
    user = await context.setupUser();
    await setOrgCredits(user.orgId, 100_000);
  });

  it("charges ceil(quantity × unit_price / unit_size)", async () => {
    await insertTestUsagePricing({
      kind: "connector",
      provider: "x",
      category: "tweet.read",
      unitPrice: 10,
      unitSize: 1,
    });

    const eventId = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      kind: "connector",
      provider: "x",
      category: "tweet.read",
      quantity: 3,
    });

    const response = await GET(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);

    const record = await findTestUsageEvent(eventId);
    expect(record!.status).toBe("processed");
    expect(record!.creditsCharged).toBe(30);
    expect(record!.processedAt).toBeInstanceOf(Date);

    const credits = await getOrgCredits(user.orgId);
    expect(credits).toBe(99_970);
  });

  it("rounds up partial units", async () => {
    // 1 token at $3 / 1M → ceil(1 × 3000 / 1_000_000) = 1
    await insertTestUsagePricing({
      kind: "model",
      provider: "anthropic",
      category: "tokens.input",
      unitPrice: 3000,
      unitSize: 1_000_000,
    });

    const eventId = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      kind: "model",
      provider: "anthropic",
      category: "tokens.input",
      quantity: 1,
    });

    const response = await GET(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);

    const record = await findTestUsageEvent(eventId);
    expect(record!.creditsCharged).toBe(1);
  });

  it("marks records with no matching pricing as processed with zero charge", async () => {
    const eventId = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      kind: "connector",
      provider: "unknown-provider",
      category: "unknown.category",
      quantity: 5,
    });

    const response = await GET(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);

    const record = await findTestUsageEvent(eventId);
    expect(record!.status).toBe("processed");
    expect(record!.creditsCharged).toBe(0);
    expect(record!.processedAt).toBeInstanceOf(Date);
  });

  it("skips already-processed records", async () => {
    await insertTestUsagePricing({
      kind: "connector",
      provider: "x",
      category: "tweet.read",
      unitPrice: 10,
      unitSize: 1,
    });

    const eventId = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      status: "processed",
      creditsCharged: 500,
    });

    const response = await GET(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);

    const record = await findTestUsageEvent(eventId);
    expect(record!.status).toBe("processed");
    expect(record!.creditsCharged).toBe(500);

    const credits = await getOrgCredits(user.orgId);
    expect(credits).toBe(100_000);
  });

  it("processes multiple pending records in a batch", async () => {
    await insertTestUsagePricing({
      kind: "connector",
      provider: "x",
      category: "tweet.read",
      unitPrice: 10,
      unitSize: 1,
    });
    await insertTestUsagePricing({
      kind: "connector",
      provider: "x",
      category: "tweet.write",
      unitPrice: 200,
      unitSize: 1,
    });

    const id1 = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      category: "tweet.read",
      quantity: 2,
    });
    const id2 = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      category: "tweet.write",
      quantity: 1,
    });

    const response = await GET(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);

    const r1 = await findTestUsageEvent(id1);
    expect(r1!.creditsCharged).toBe(20);

    const r2 = await findTestUsageEvent(id2);
    expect(r2!.creditsCharged).toBe(200);

    const credits = await getOrgCredits(user.orgId);
    expect(credits).toBe(100_000 - 220);
  });

  it("concurrent calls serialize via advisory lock", async () => {
    await insertTestUsagePricing({
      kind: "connector",
      provider: "x",
      category: "tweet.read",
      unitPrice: 10,
      unitSize: 1,
    });

    const eventId = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      quantity: 3,
    });

    await Promise.all([
      GET(cronRequest("test-cron-secret")),
      GET(cronRequest("test-cron-secret")),
    ]);

    const record = await findTestUsageEvent(eventId);
    expect(record!.creditsCharged).toBe(30);

    const credits = await getOrgCredits(user.orgId);
    expect(credits).toBe(100_000 - 30);
  });

  it("finds and processes all orgs with pending usage events", async () => {
    await insertTestUsagePricing({
      kind: "connector",
      provider: "x",
      category: "tweet.read",
      unitPrice: 10,
      unitSize: 1,
    });

    const org2Id = uniqueId("org");
    await insertOrgCacheEntry({ orgId: org2Id, slug: uniqueId("slug") });

    const id1 = await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      quantity: 1,
    });
    const id2 = await insertTestUsageEvent(org2Id, {
      userId: user.userId,
      quantity: 1,
    });

    const response = await GET(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.processedUsageEvents).toBeGreaterThanOrEqual(2);

    const r1 = await findTestUsageEvent(id1);
    expect(r1!.status).toBe("processed");

    const r2 = await findTestUsageEvent(id2);
    expect(r2!.status).toBe("processed");
  });

  it("disables member when usage exceeds cap after processing a usage event", async () => {
    const periodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    await updateOrgStripeFields(user.orgId, { currentPeriodEnd: periodEnd });

    await insertOrgMembersEntry({
      orgId: user.orgId,
      userId: user.userId,
      creditCap: 100,
      creditEnabled: true,
    });

    // evaluateMemberCaps currently aggregates only `credit_usage`, so seed a
    // processed credit_usage row above the cap. Then a fresh usage_event
    // triggers the re-evaluation, which must disable the member.
    await insertTestUsagePricing({
      kind: "connector",
      provider: "x",
      category: "tweet.read",
      unitPrice: 200,
      unitSize: 1,
    });

    await insertTestUsageEvent(user.orgId, {
      userId: user.userId,
      quantity: 1,
    });

    await insertTestCreditPricing("gpt-4", {
      inputTokenPrice: 1_000_000,
      outputTokenPrice: 1_000_000,
    });
    await insertTestCreditUsage(user.orgId, {
      userId: user.userId,
      model: "gpt-4",
      inputTokens: 100,
      outputTokens: 100,
      status: "processed",
      creditsCharged: 200,
    });

    const response = await GET(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);

    const member = await getOrgMembersEntry(user.orgId, user.userId);
    expect(member?.creditEnabled).toBe(false);
  });
});
