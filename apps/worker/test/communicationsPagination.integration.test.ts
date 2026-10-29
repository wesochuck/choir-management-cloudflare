import { runInDurableObject } from "cloudflare:test";
import {
  communicationDeliveryRecipientsPageResponseSchema,
  communicationHistoryPageResponseSchema,
  communicationMessageResponseSchema,
  communicationMessagesResponseSchema,
  communicationReachResponseSchema,
  communicationTemplatesPageResponseSchema,
  organizationEventSchema,
  organizationVenueSchema,
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
  write,
} from "./communications.integration.fixture";
import { sendMessage } from "../src/organization/communicationStore/messages";
import { sendOperationSchema } from "../src/organization/communicationStore/contracts";

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

  it("lists event promotion history through the organization-scoped route", async () => {
    const cookie = await signIn();
    const eventId = crypto.randomUUID();

    const response = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/events/${eventId}/promotions`,
        cookie,
      ),
    );

    expect(response.status).toBe(200);
    const payload = communicationMessagesResponseSchema.parse(await response.json());
    expect(payload.messages).toEqual([]);

    const invalidResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        "/api/organization/communications/events/not-a-uuid/promotions",
        cookie,
      ),
    );
    expect(invalidResponse.status).toBe(400);
  });

  it("reuses a client-stable event promotion draft ID when the save response is retried", async () => {
    const cookie = await signIn();
    const venueResponse = await write("alpha.localhost", "/api/organization/venues", cookie, {
      address: "1 Test Way",
      name: "Test Hall",
    });
    expect(venueResponse.status).toBe(201);
    const venueId = organizationVenueSchema.parse(await venueResponse.json()).id;
    const eventResponse = await write("alpha.localhost", "/api/organization/events", cookie, {
      advancePriceCents: 1000,
      callTime: "",
      dayOfPriceCents: 1200,
      details: "",
      doorsOpenTime: "",
      durationMinutes: null,
      isTicketingEnabled: true,
      location: "",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      rsvpDeadlineDate: "2030-01-01",
      rsvpFollowUpLeadHours: null,
      rsvpFollowUpMode: "inherit",
      setList: [],
      setListApproved: false,
      startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      ticketCapacity: 100,
      title: "Promotion Retry Test",
      type: "Performance",
      venueId,
    });
    expect(eventResponse.status).toBe(201);
    const eventId = organizationEventSchema.parse(await eventResponse.json()).id;
    const messageId = crypto.randomUUID();
    const draftRequest = {
      audience: {
        excludeTicketBuyersForEventId: eventId,
        targetAudiences: ["Contacts"],
      },
      channel: "Email",
      contentMarkdown: "Join us for the concert.",
      eventPromotion: { announcementKind: "initial", eventId, parentMessageId: null },
      messageId,
      subject: "Tickets are available",
    };

    const firstResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      draftRequest,
    );
    expect(firstResponse.status).toBe(201);
    const firstDraft = communicationMessageResponseSchema.parse(await firstResponse.json());
    const retryResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      draftRequest,
    );
    expect(retryResponse.status).toBe(201);
    const retriedDraft = communicationMessageResponseSchema.parse(await retryResponse.json());
    expect(retriedDraft).toMatchObject({ id: messageId, status: "Draft", draftRevision: 1 });
    expect(retriedDraft.createdAt).toBe(firstDraft.createdAt);

    const historyResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/events/${eventId}/promotions`,
        cookie,
      ),
    );
    expect(historyResponse.status).toBe(200);
    const history = communicationMessagesResponseSchema.parse(await historyResponse.json());
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]?.id).toBe(messageId);
  });

  it("allows deleting an initial event promotion draft and saving a new initial draft", async () => {
    const cookie = await signIn();
    const venueResponse = await write("alpha.localhost", "/api/organization/venues", cookie, {
      address: "1 Test Way",
      name: "Promotion Draft Deletion Hall",
    });
    expect(venueResponse.status).toBe(201);
    const venueId = organizationVenueSchema.parse(await venueResponse.json()).id;
    const eventResponse = await write("alpha.localhost", "/api/organization/events", cookie, {
      advancePriceCents: 1000,
      callTime: "",
      dayOfPriceCents: 1200,
      details: "",
      doorsOpenTime: "",
      durationMinutes: null,
      isTicketingEnabled: true,
      location: "",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      rsvpDeadlineDate: "2030-01-01",
      rsvpFollowUpLeadHours: null,
      rsvpFollowUpMode: "inherit",
      setList: [],
      setListApproved: false,
      startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      ticketCapacity: 100,
      title: "Draft Deletion Test",
      type: "Performance",
      venueId,
    });
    expect(eventResponse.status).toBe(201);
    const eventId = organizationEventSchema.parse(await eventResponse.json()).id;
    const initialMessageId = crypto.randomUUID();

    const saveResponse1 = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      {
        audience: { excludeTicketBuyersForEventId: eventId, targetAudiences: ["Contacts"] },
        channel: "Email",
        contentMarkdown: "First invitation draft.",
        eventPromotion: { announcementKind: "initial", eventId, parentMessageId: null },
        messageId: initialMessageId,
        subject: "First draft",
      },
    );
    expect(saveResponse1.status).toBe(201);

    const historyResponse1 = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/events/${eventId}/promotions`,
        cookie,
      ),
    );
    expect(historyResponse1.status).toBe(200);
    const history1 = communicationMessagesResponseSchema.parse(await historyResponse1.json());
    expect(history1.messages).toHaveLength(1);
    expect(history1.messages[0]?.id).toBe(initialMessageId);

    const deleteResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/drafts/${initialMessageId}`,
        cookie,
        { method: "DELETE" },
      ),
    );
    expect(deleteResponse.status).toBe(200);

    const historyResponse2 = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/events/${eventId}/promotions`,
        cookie,
      ),
    );
    expect(historyResponse2.status).toBe(200);
    const history2 = communicationMessagesResponseSchema.parse(await historyResponse2.json());
    expect(history2.messages).toHaveLength(0);

    const nextMessageId = crypto.randomUUID();
    const saveResponse2 = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      {
        audience: { excludeTicketBuyersForEventId: eventId, targetAudiences: ["Contacts"] },
        channel: "Email",
        contentMarkdown: "Replacement invitation draft.",
        eventPromotion: { announcementKind: "initial", eventId, parentMessageId: null },
        messageId: nextMessageId,
        subject: "Second draft",
      },
    );
    expect(saveResponse2.status).toBe(201);
    const replacementDraft = communicationMessageResponseSchema.parse(await saveResponse2.json());
    expect(replacementDraft.id).toBe(nextMessageId);

    const historyResponse3 = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/events/${eventId}/promotions`,
        cookie,
      ),
    );
    expect(historyResponse3.status).toBe(200);
    const history3 = communicationMessagesResponseSchema.parse(await historyResponse3.json());
    expect(history3.messages).toHaveLength(1);
    expect(history3.messages[0]?.id).toBe(nextMessageId);
  });

  it("reuses an open follow-up draft when Create follow-up retries with a new client ID", async () => {
    const cookie = await signIn();
    const venueResponse = await write("alpha.localhost", "/api/organization/venues", cookie, {
      address: "1 Test Way",
      name: "Follow-up Hall",
    });
    const venueId = organizationVenueSchema.parse(await venueResponse.json()).id;
    const eventResponse = await write("alpha.localhost", "/api/organization/events", cookie, {
      advancePriceCents: 1000,
      callTime: "",
      dayOfPriceCents: 1200,
      details: "",
      doorsOpenTime: "",
      durationMinutes: null,
      isTicketingEnabled: true,
      location: "",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      rsvpDeadlineDate: "2030-01-01",
      rsvpFollowUpLeadHours: null,
      rsvpFollowUpMode: "inherit",
      setList: [],
      setListApproved: false,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      ticketCapacity: 100,
      title: "Follow-up Retry Test",
      type: "Performance",
      venueId,
    });
    const eventId = organizationEventSchema.parse(await eventResponse.json()).id;
    const initialMessageId = crypto.randomUUID();
    const initialResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      {
        audience: { excludeTicketBuyersForEventId: eventId, targetAudiences: ["Contacts"] },
        channel: "Email",
        contentMarkdown: "Join us for the concert.",
        eventPromotion: { announcementKind: "initial", eventId, parentMessageId: null },
        messageId: initialMessageId,
        subject: "Tickets are available",
      },
    );
    expect(initialResponse.status).toBe(201);

    const organizationStub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, undefined>(organizationStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE communication_messages SET status = 'Queued' WHERE id = ?",
        initialMessageId,
      );
    });

    const firstFollowUpId = crypto.randomUUID();
    const followUpRequest = (messageId: string) => ({
      audience: { excludeTicketBuyersForEventId: eventId, targetAudiences: ["Contacts"] },
      channel: "Email",
      contentMarkdown: "A follow-up invitation.",
      eventPromotion: {
        announcementKind: "follow_up",
        eventId,
        parentMessageId: initialMessageId,
      },
      messageId,
      subject: "Follow-up: Tickets are available",
    });
    const firstResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      followUpRequest(firstFollowUpId),
    );
    expect(firstResponse.status).toBe(201);
    const firstDraft = communicationMessageResponseSchema.parse(await firstResponse.json());
    const retryResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      followUpRequest(crypto.randomUUID()),
    );
    expect(retryResponse.status).toBe(201);
    const retriedDraft = communicationMessageResponseSchema.parse(await retryResponse.json());
    expect(retriedDraft.id).toBe(firstDraft.id);
    expect(retriedDraft.eventPromotion).toMatchObject({
      announcementKind: "follow_up",
      eventId,
      parentMessageId: initialMessageId,
    });

    const historyResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/communications/events/${eventId}/promotions`,
        cookie,
      ),
    );
    const history = communicationMessagesResponseSchema.parse(await historyResponse.json());
    expect(
      history.messages.filter(
        (message) => message.eventPromotion?.announcementKind === "follow_up",
      ),
    ).toHaveLength(1);
  });

  it("rejects a promotion if a reviewed Contact buys the target event before queueing", async () => {
    const cookie = await signIn();
    const venueResponse = await write("alpha.localhost", "/api/organization/venues", cookie, {
      address: "1 Test Way",
      name: "Purchase Race Hall",
    });
    const venueId = organizationVenueSchema.parse(await venueResponse.json()).id;
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const eventResponse = await write("alpha.localhost", "/api/organization/events", cookie, {
      advancePriceCents: 1000,
      callTime: "",
      dayOfPriceCents: 1200,
      details: "",
      doorsOpenTime: "",
      durationMinutes: null,
      isTicketingEnabled: true,
      location: "",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      rsvpDeadlineDate: "2030-01-01",
      rsvpFollowUpLeadHours: null,
      rsvpFollowUpMode: "inherit",
      setList: [],
      setListApproved: false,
      startsAt,
      ticketCapacity: 100,
      title: "Purchase Race Concert",
      type: "Performance",
      venueId,
    });
    const eventId = organizationEventSchema.parse(await eventResponse.json()).id;
    const contactId = crypto.randomUUID();
    const organizationStub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, undefined>(organizationStub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO contacts
          (id, first_name, last_name, display_name, email, normalized_email, phone,
           normalized_phone, profile_id, source, created_at, updated_at)
         VALUES (?, 'Alex', 'Buyer', 'Alex Buyer', 'alex@example.test', 'alex@example.test',
           NULL, NULL, NULL, 'test', ?, ?)`,
        contactId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO contact_communication_preferences
          (contact_id, channel, status, source, observed_at, updated_at)
         VALUES (?, 'email', 'subscribed', 'test', ?, ?)`,
        contactId,
        now,
        now,
      );
    });

    const messageId = crypto.randomUUID();
    const audience = {
      contactIds: [contactId],
      excludeTicketBuyersForEventId: eventId,
      targetAudiences: ["Contacts"],
    };
    const promotion = { announcementKind: "initial", eventId, parentMessageId: null } as const;
    const message = {
      audience,
      channel: "Email",
      contentMarkdown: "Join us for the concert.",
      eventPromotion: promotion,
      messageId,
      subject: "Tickets are available",
    };
    const draftResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      message,
    );
    expect(draftResponse.status).toBe(201);
    const reachResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/reach-preview",
      cookie,
      { ...message, draftRevision: 1 },
    );
    expect(reachResponse.status).toBe(200);
    const review = communicationReachResponseSchema.parse(await reachResponse.json());
    expect(review.reviewSnapshot).toBeDefined();

    const purchaseId = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, undefined>(organizationStub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at, fulfilled_at, contact_id)
         VALUES (?, ?, ?, 'Purchase Race Concert', ?, 'America/New_York', 'Alex Buyer',
           'alex@example.test', 1, 2500, 0, 2500, 'usd', ?, 'payment-race-test', 'paid',
           0, ?, ?, ?, ?)`,
        purchaseId,
        crypto.randomUUID(),
        eventId,
        startsAt,
        crypto.randomUUID(),
        now,
        now,
        now,
        contactId,
      );
    });

    const sendOperation = sendOperationSchema.parse({
      action: "send",
      actorUserId: "communications-manager",
      actorType: "organization_member",
      actorUserName: "Communications Manager",
      dedupeKey: `event-promotion:${eventId}:initial:initial:${messageId}`,
      jobId: crypto.randomUUID(),
      message: {
        ...message,
        expectedRevision: 1,
        reviewSnapshot: review.reviewSnapshot,
      },
      messageId,
      organizationId: "organization-alpha",
      recipients: [
        {
          email: "alex@example.test",
          name: "Alex Buyer",
          phone: "",
          profileId: contactId,
          subject: { kind: "contact", contactId },
          unsubscribeUrl: null,
        },
      ],
      requestId: crypto.randomUUID(),
    });
    const result = await runInDurableObject<
      OrganizationStore,
      {
        readonly body: unknown;
        readonly deliveryCount: number;
        readonly status: number;
      }
    >(organizationStub, async (_instance, state) => {
      const response = await sendMessage(state.storage, sendOperation, new Date().toISOString());
      const payload: unknown = await response.json();
      const deliveryCount =
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM communication_deliveries WHERE message_id = ?",
            messageId,
          )
          .toArray()[0]?.count ?? 0;
      return { body: payload, deliveryCount, status: response.status };
    });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ code: "event_promotion_review_stale" });
    expect(result.deliveryCount).toBe(0);
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
