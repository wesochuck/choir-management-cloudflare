import { runInDurableObject } from "cloudflare:test";
import {
  communicationDeliveryRecipientsPageResponseSchema,
  communicationHistoryPageResponseSchema,
  communicationTemplatesPageResponseSchema,
} from "@choir/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";
import {
  api,
  database,
  exports,
  managerEmail,
  signIn,
  stores,
} from "./communications.integration.fixture";

describe("Organization communications pagination and keyset cursors", () => {
  beforeEach(async () => {
    await setupOrganizationIntegration(database, stores, {
      displayName: "Communications Manager",
      email: managerEmail,
      organizations: [
        { id: "organization-alpha", role: "admin", slug: "alpha" },
        { id: "organization-bravo", role: "member", slug: "bravo" },
      ],
      userId: "communications-manager",
    });
  });

  afterEach(async () => {
    await teardownOrganizationIntegration();
  });

  it("supports cursor pagination and filters on communication history", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const msgId1 = crypto.randomUUID();
    const msgId2 = crypto.randomUUID();
    const msgId3 = crypto.randomUUID();
    const validAudience = JSON.stringify({
      contactEmailStatus: null,
      contactIds: [],
      contactListIds: [],
      contactSmsStatus: null,
      contactSource: null,
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Members"],
      ticketBuyerMode: "marketing",
      voiceParts: [],
    });
    const validReach = JSON.stringify({
      both: 0,
      email: 0,
      sms: 0,
      ticketBuyerPurchasesOverLimit: 0,
      total: 0,
      undeliverableTicketBuyerPurchases: 0,
      unreachable: 0,
    });
    await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
      const now = new Date();
      const t1 = new Date(now.getTime() - 30_000).toISOString();
      const t2 = new Date(now.getTime() - 20_000).toISOString();
      const t3 = new Date(now.getTime() - 10_000).toISOString();
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, subject, content_markdown, audience_json, reach_json, created_by, status, created_at, updated_at)
         VALUES
          (?, 'Email', 'Test History Draft', 'Draft Content', ?, ?, 'user-1', 'Draft', ?, ?),
          (?, 'Email', 'Test History Queued', 'Queued Content', ?, ?, 'user-1', 'Queued', ?, ?),
          (?, 'Email', 'Test History Sent', 'Sent Content', ?, ?, 'user-1', 'Sent', ?, ?)`,
        msgId1,
        validAudience,
        validReach,
        t1,
        t1,
        msgId2,
        validAudience,
        validReach,
        t2,
        t2,
        msgId3,
        validAudience,
        validReach,
        t3,
        t3,
      );
      return undefined;
    });

    const page1Res = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history?limit=2", cookie),
    );
    expect(page1Res.status).toBe(200);
    const page1 = communicationHistoryPageResponseSchema.parse(await page1Res.json());
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();

    const page2Res = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/history?limit=2&cursor=${encodeURIComponent(page1.nextCursor ?? "")}`,
        cookie,
      ),
    );
    expect(page2Res.status).toBe(200);
    const page2 = communicationHistoryPageResponseSchema.parse(await page2Res.json());
    expect(page2.items.length).toBeGreaterThanOrEqual(1);

    // Test filter: status=draft
    const draftRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history?status=draft", cookie),
    );
    expect(draftRes.status).toBe(200);
    const draftPage = communicationHistoryPageResponseSchema.parse(await draftRes.json());
    expect(draftPage.items.every((i) => i.kind === "manual" && i.message.status === "Draft")).toBe(
      true,
    );
  });

  it("paginates communication delivery recipients with keyset cursor", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const msgId = crypto.randomUUID();
    const validAudience = JSON.stringify({
      contactEmailStatus: null,
      contactIds: [],
      contactListIds: [],
      contactSmsStatus: null,
      contactSource: null,
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Members"],
      ticketBuyerMode: "marketing",
      voiceParts: [],
    });
    const validReach = JSON.stringify({
      both: 0,
      email: 0,
      sms: 0,
      ticketBuyerPurchasesOverLimit: 0,
      total: 0,
      undeliverableTicketBuyerPurchases: 0,
      unreachable: 0,
    });
    await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, subject, content_markdown, audience_json, reach_json, created_by, status, created_at, updated_at)
         VALUES (?, 'Email', 'Recipient Test', 'Content', ?, ?, 'user-1', 'Sent', ?, ?)`,
        msgId,
        validAudience,
        validReach,
        now,
        now,
      );
      for (let i = 1; i <= 3; i++) {
        state.storage.sql.exec(
          `INSERT INTO communication_deliveries
            (id, message_id, profile_id, recipient_name, channel, destination, status,
             attempts, provider_message_id, failure_detail, created_at, updated_at,
             unsubscribe_url, recipient_subject_json)
           VALUES (?, ?, ?, ?, 'email', ?, 'sent', 1, '', '', ?, ?, NULL, '{}')`,
          `deliv-${String(i).padStart(3, "0")}`,
          msgId,
          crypto.randomUUID(),
          `Recipient ${String(i)}`,
          `recipient${String(i)}@example.test`,
          now,
          now,
        );
      }
      return undefined;
    });

    const rec1Res = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/${msgId}/recipients?limit=2`,
        cookie,
      ),
    );
    expect(rec1Res.status).toBe(200);
    const rec1 = communicationDeliveryRecipientsPageResponseSchema.parse(await rec1Res.json());
    expect(rec1.recipients.length).toBe(2);
    expect(rec1.nextCursor).toBeTruthy();

    const rec2Res = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/${msgId}/recipients?limit=2&cursor=${encodeURIComponent(rec1.nextCursor ?? "")}`,
        cookie,
      ),
    );
    expect(rec2Res.status).toBe(200);
    const rec2 = communicationDeliveryRecipientsPageResponseSchema.parse(await rec2Res.json());
    expect(rec2.recipients.length).toBe(1);
    expect(rec2.nextCursor).toBeNull();
  });

  it("paginates communication templates with keyset cursor", async () => {
    const cookie = await signIn();
    const tpl1Res = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/templates?limit=2", cookie),
    );
    expect(tpl1Res.status).toBe(200);
    const tpl1 = communicationTemplatesPageResponseSchema.parse(await tpl1Res.json());
    expect(tpl1.templates.length).toBe(2);
    expect(tpl1.nextCursor).toBeTruthy();

    const tpl2Res = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/templates?limit=2&cursor=${encodeURIComponent(tpl1.nextCursor ?? "")}`,
        cookie,
      ),
    );
    expect(tpl2Res.status).toBe(200);
    const tpl2 = communicationTemplatesPageResponseSchema.parse(await tpl2Res.json());
    expect(tpl2.templates.length).toBeGreaterThanOrEqual(1);
  });
});
