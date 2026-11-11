import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import {
  communicationAudienceRequestSchema,
  communicationHistoryPageResponseSchema,
} from "@choir/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  stores,
  exports,
  api,
  signIn,
} from "./ticketing.integration.fixture";

beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);
const audience = communicationAudienceRequestSchema.parse({ targetAudiences: ["Members"] });
const reach = JSON.stringify({ both: 0, email: 1, sms: 0, total: 1, unreachable: 0 });
async function seedMessages(
  rows: readonly {
    subject: string;
    timestamp: string;
    status?: "Sent" | "Failed";
    automatic?: boolean;
  }[],
) {
  await runInDurableObject<OrganizationStore, undefined>(
    stores.getByName("organization-alpha"),
    (_instance, state) => {
      state.storage.sql.exec("UPDATE organization_metadata SET timezone='America/New_York'");
      const event = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO events (id,title,type,starts_at,created_at,updated_at) VALUES (?,'Christmas Concert','Performance','2026-11-01T17:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')",
        event,
      );
      for (const row of rows)
        state.storage.sql.exec(
          `INSERT INTO communication_messages (id,channel,status,subject,content_markdown,audience_json,reach_json,created_by,created_at,updated_at,sent_at)
      VALUES (?,'Email',? ,?,'Body',?,?,?,?,?,?)`,
          crypto.randomUUID(),
          row.status ?? "Sent",
          row.subject,
          JSON.stringify({ ...audience, eventId: event }),
          reach,
          row.automatic ? "system:scheduler" : "user",
          row.timestamp,
          row.timestamp,
          row.timestamp,
        );
      return undefined;
    },
  );
}
async function read(
  cookie: string,
  search: string,
  cursor?: string,
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams({ q: search, includePreviews: "false", limit: "10", ...extra });
  if (cursor) query.set("cursor", cursor);
  const response = await exports.default.fetch(
    api("alpha.localhost", `/api/organization/communications/history?${query.toString()}`, cookie),
  );
  expect(response.status).toBe(200);
  return communicationHistoryPageResponseSchema.parse(await response.json());
}
function subjects(page: Awaited<ReturnType<typeof read>>) {
  return page.items.map((item) =>
    item.kind === "manual" ? item.message.subject : item.scheduledMessage.subject,
  );
}

describe("communication history search", () => {
  it("requires Organization authorization and validates bounded search input", async () => {
    const cookie = await signIn();
    const path = "/api/organization/communications/history?q=Christmas";
    expect((await exports.default.fetch(api("alpha.localhost", path))).status).toBe(401);
    expect((await exports.default.fetch(api("bravo.localhost", path, cookie))).status).toBe(403);
    expect(
      await stores
        .getByName("organization-alpha")
        .readCommunicationHistory({ organizationId: "organization-bravo", search: "Christmas" }),
    ).toBeNull();
    for (const query of ["a".repeat(201), Array.from({ length: 13 }, () => "word").join(" ")])
      expect(
        (
          await exports.default.fetch(
            api(
              "alpha.localhost",
              `/api/organization/communications/history?q=${encodeURIComponent(query)}`,
              cookie,
            ),
          )
        ).status,
      ).toBe(400);
    expect((await read(cookie, "")).items).toEqual([]);
  });
  it("filters the entire history before keyset pagination and retains every matching row", async () => {
    const cookie = await signIn();
    await seedMessages([
      ...Array.from({ length: 120 }, (_, index) => ({
        subject: `Unrelated newer notice ${String(index)}`,
        timestamp: new Date(Date.UTC(2026, 10, 10, 0, index)).toISOString(),
      })),
      ...Array.from({ length: 65 }, (_, index) => ({
        subject: `Season confirmation ${String(index)}`,
        timestamp: new Date(Date.UTC(2026, 9, 30, 0, index)).toISOString(),
      })),
    ]);
    const found: string[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 7; index++) {
      const page = await read(cookie, "CHRISTMAS confirmation", cursor, {
        status: "sent",
        origin: "manual",
      });
      found.push(...subjects(page));
      if (index < 6) expect(page.items).toHaveLength(10);
      else expect(page.items).toHaveLength(5);
      cursor = page.nextCursor ?? undefined;
    }
    expect(cursor).toBeUndefined();
    expect(new Set(found).size).toBe(65);
    expect(found.every((subject) => subject.startsWith("Season confirmation"))).toBe(true);
  });
  it("matches metadata and literal text, combining all terms with dropdown constraints", async () => {
    const cookie = await signIn();
    await seedMessages([
      {
        subject: "Rehearsal reminder",
        timestamp: "2026-10-31T12:00:00.000Z",
        status: "Failed",
        automatic: true,
      },
      { subject: "Rehearsal reminder", timestamp: "2026-10-30T12:00:00.000Z" },
      { subject: "Refund 100%_ O'Connor", timestamp: "2026-10-29T12:00:00.000Z" },
    ]);
    expect(subjects(await read(cookie, "failed AUTOMATIC reminder"))).toEqual([
      "Rehearsal reminder",
    ]);
    expect((await read(cookie, "failed reminder", undefined, { origin: "manual" })).items).toEqual(
      [],
    );
    expect(subjects(await read(cookie, "100%_"))).toEqual(["Refund 100%_ O'Connor"]);
    expect(subjects(await read(cookie, "O'Connor"))).toEqual(["Refund 100%_ O'Connor"]);
    expect((await read(cookie, "' OR 1=1")).items).toEqual([]);
    expect((await read(cookie, "unmatched")).nextCursor).toBeNull();
  });
  it("searches rendered ticket subjects, stored message kinds, and skipped status", async () => {
    const cookie = await signIn();
    await runInDurableObject<OrganizationStore, undefined>(
      stores.getByName("organization-alpha"),
      (_instance, state) => {
        const purchase = crypto.randomUUID();
        const time = "2026-10-31T12:00:00.000Z";
        state.storage.sql.exec(
          `INSERT INTO ticket_purchases (id,checkout_request_id,event_id,event_title,event_starts_at,event_timezone,buyer_name,buyer_email,quantity,unit_price_cents,fee_cents,amount_paid_cents,currency,provider_session_id,provider_payment_id,status,marketing_opt_in,created_at,updated_at)
        VALUES (?,?,'11111111-1111-4111-8111-111111111111','Christmas Concert',?,'America/New_York','Test Buyer','buyer@example.test',1,100,0,100,'usd',?,'','paid',0,?,?)`,
          purchase,
          crypto.randomUUID(),
          time,
          crypto.randomUUID(),
          time,
          time,
        );
        for (const status of ["sent", "suppressed"])
          state.storage.sql.exec(
            `INSERT INTO ticket_notifications (id,purchase_id,event_id,dedupe_key,kind,destination,subject,rendered_subject,content_markdown,status,scheduled_for,created_at,updated_at)
        VALUES (?,?,'11111111-1111-4111-8111-111111111111',?,'confirmation','buyer@example.test','Tickets confirmed: {eventTitle}','Tickets confirmed: Christmas Concert','Tickets',?,?,?,?)`,
            crypto.randomUUID(),
            purchase,
            crypto.randomUUID(),
            status,
            time,
            time,
            time,
          );
        return undefined;
      },
    );
    const page = await read(cookie, "Christmas ticket confirmation");
    expect(page.items).toHaveLength(2);
    expect(
      page.items.every(
        (item) => item.kind === "automated" && item.scheduledMessage.kind === "ticket_confirmation",
      ),
    ).toBe(true);
    expect((await read(cookie, "skipped Christmas")).items).toHaveLength(1);
  });
  it("interprets month and day searches in the Organization timezone across DST", async () => {
    const cookie = await signIn();
    await seedMessages([
      { subject: "October boundary", timestamp: "2026-11-01T03:59:59.000Z" },
      { subject: "November start", timestamp: "2026-11-01T04:00:00.000Z" },
      { subject: "November DST end", timestamp: "2026-11-02T04:59:59.000Z" },
      { subject: "Next local day", timestamp: "2026-11-02T05:00:00.000Z" },
      { subject: "November end", timestamp: "2026-12-01T04:59:59.000Z" },
      { subject: "December boundary", timestamp: "2026-12-01T05:00:00.000Z" },
    ]);
    expect(subjects(await read(cookie, "November 2026"))).toEqual([
      "November end",
      "Next local day",
      "November DST end",
      "November start",
    ]);
    expect(subjects(await read(cookie, "Nov 2026"))).toEqual(
      subjects(await read(cookie, "2026-11")),
    );
    expect(subjects(await read(cookie, "2026-11-01"))).toEqual([
      "November DST end",
      "November start",
    ]);
    expect(subjects(await read(cookie, "October 2026"))).toEqual(["October boundary"]);
  });
});
