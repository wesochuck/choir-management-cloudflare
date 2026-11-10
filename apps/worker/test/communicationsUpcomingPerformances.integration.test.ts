import { futureDateString, futureIsoDate, pastIsoDate } from "@choir/testkit";
import {
  communicationMessageResponseSchema,
  organizationEventSchema,
  organizationVenueSchema,
} from "@choir/contracts";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";
import {
  createProfile,
  database,
  managerEmail,
  organizationFiles,
  signIn,
  stores,
  write,
} from "./communications.integration.fixture";

interface CapturedEmail {
  readonly html: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

function captureEmailBinding() {
  const sentEmails: CapturedEmail[] = [];
  const send = vi.fn<(message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>>(
    (message) => {
      if ("to" in message) {
        const toValue = typeof message.to === "string" ? message.to : "";
        sentEmails.push({
          html: "html" in message && typeof message.html === "string" ? message.html : "",
          subject:
            "subject" in message && typeof message.subject === "string" ? message.subject : "",
          text: "text" in message && typeof message.text === "string" ? message.text : "",
          to: toValue,
        });
      }
      return Promise.resolve({ messageId: `msg-${String(sentEmails.length)}` });
    },
  );
  return {
    binding: { send } satisfies SendEmail,
    sentEmails,
  };
}

async function deliverCapturedEmailBatch(jobs: readonly DeliveryJob[]) {
  const emailCapture = captureEmailBinding();
  const batch = createMessageBatch(
    "choir-management-jobs-local",
    jobs.map((job, index) => ({
      attempts: 1,
      body: job,
      id: `upcoming-job-${String(index)}`,
      timestamp: new Date(),
    })),
  );
  await processDeliveryBatch(batch, {
    CONTROL_DB: database,
    EXTERNAL_EFFECTS_MODE: "sandbox",
    ORGANIZATION_FILES: organizationFiles,
    ORGANIZATION_STORE: stores,
    PLATFORM_EMAIL: emailCapture.binding,
    PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
    PLATFORM_EMAIL_FROM: "notifications@example.test",
    PLATFORM_EMAIL_MODE: "sandbox",
    PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
    SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
  });
  expect(await getQueueResult(batch, createExecutionContext())).toMatchObject({
    explicitAcks: jobs.map((_job, index) => `upcoming-job-${String(index)}`),
  });
  return emailCapture.sentEmails;
}

async function createVenue(host: string, cookie: string, name: string, address: string) {
  const response = await write(host, "/api/organization/venues", cookie, { address, name });
  expect(response.status).toBe(201);
  return organizationVenueSchema.parse(await response.json());
}

async function createPerformance(
  host: string,
  cookie: string,
  overrides: {
    readonly isTicketingEnabled?: boolean;
    readonly publishOnWebsite?: boolean;
    readonly startsAt: string;
    readonly title: string;
    readonly venueId: string;
  },
) {
  const response = await write(host, "/api/organization/events", cookie, {
    advancePriceCents: overrides.isTicketingEnabled ? 2000 : 0,
    callTime: "",
    dayOfPriceCents: overrides.isTicketingEnabled ? 2500 : 0,
    details: "Internal performance notes",
    doorsOpenTime: "",
    durationMinutes: 90,
    isTicketingEnabled: overrides.isTicketingEnabled ?? false,
    location: "",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: overrides.publishOnWebsite ?? false,
    rsvpDeadlineDate: futureDateString({ days: 3 }),
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    startsAt: overrides.startsAt,
    ticketCapacity: null,
    title: overrides.title,
    type: "Performance",
    venueId: overrides.venueId,
  });
  expect(response.status).toBe(201);
  return organizationEventSchema.parse(await response.json());
}

async function createMemberWithEmail(
  organizationId: string,
  cookie: string,
  displayName: string,
  email: string,
) {
  const profileId = await createProfile(cookie, {
    displayName,
    phone: "",
    voicePart: "S1",
  });
  const userId = crypto.randomUUID();
  const nowMs = Date.now();
  await database.batch([
    database
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
         VALUES (?, ?, ?, 1, ?, ?, 0)`,
      )
      .bind(userId, displayName, email, nowMs, nowMs),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, ?, ?, 'member', ?, ?)`,
      )
      .bind(crypto.randomUUID(), organizationId, userId, profileId, nowMs),
  ]);
  return profileId;
}

async function readCommunicationJob(
  stub: DurableObjectStub<OrganizationStore>,
  organizationId: string,
  messageId: string,
): Promise<DeliveryJob> {
  return runInDurableObject<OrganizationStore, DeliveryJob>(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<{
        readonly idempotencyKey: string;
        readonly jobId: string;
        readonly kind: DeliveryJob["kind"];
      }>(
        `SELECT job_id AS jobId, idempotency_key AS idempotencyKey, kind
         FROM scheduled_job_outbox WHERE idempotency_key = ? LIMIT 1`,
        `communication:${messageId}:initial`,
      )
      .one();
    return {
      attempt: 1,
      idempotencyKey: row.idempotencyKey,
      jobId: row.jobId,
      kind: row.kind,
      organizationId,
      version: 1,
    };
  });
}

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Communications Manager",
    email: managerEmail,
    organizations: [
      { id: "organization-alpha", role: "admin", slug: "alpha" },
      { id: "organization-bravo", role: "admin", slug: "bravo" },
    ],
    userId: "communications-manager",
  });
});

afterEach(async () => teardownOrganizationIntegration());

describe("Upcoming performances communication placeholder", () => {
  it("renders audience-scoped upcoming performances in emails and member bulletins with strict tenant isolation", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));

    const memberEmail = "member-upcoming@example.test";
    const contactEmail = "contact-upcoming@example.test";
    const memberProfileId = await createMemberWithEmail(
      "organization-alpha",
      cookie,
      "Alice Member",
      memberEmail,
    );
    const contactResponse = await write("alpha.localhost", "/api/organization/contacts", cookie, {
      displayName: "Bob Contact",
      email: contactEmail,
      emailStatus: "subscribed",
    });
    expect(contactResponse.status).toBe(201);
    const contactId = z
      .object({ contact: z.object({ id: z.uuid() }) })
      .parse(await contactResponse.json()).contact.id;

    const alphaVenue = await createVenue(
      "alpha.localhost",
      cookie,
      "Alpha Symphony Hall",
      "100 Music Way",
    );
    const bravoVenue = await createVenue("bravo.localhost", cookie, "Bravo Hall", "200 Other St");

    // Bravo concert must never leak into Alpha communications
    await createPerformance("bravo.localhost", cookie, {
      publishOnWebsite: true,
      startsAt: futureIsoDate({ days: 8 }),
      title: "Bravo Secret Gala",
      venueId: bravoVenue.id,
    });

    // Alpha performances: internal + published (non-ticketed & ticketed) + canceled + past
    await createPerformance("alpha.localhost", cookie, {
      publishOnWebsite: false,
      startsAt: futureIsoDate({ days: 5 }),
      title: "Alpha Internal Assembly",
      venueId: alphaVenue.id,
    });
    const ticketedPerformance = await createPerformance("alpha.localhost", cookie, {
      isTicketingEnabled: true,
      publishOnWebsite: true,
      startsAt: futureIsoDate({ days: 20 }),
      title: "Alpha Ticketed Gala",
      venueId: alphaVenue.id,
    });
    await createPerformance("alpha.localhost", cookie, {
      isTicketingEnabled: false,
      publishOnWebsite: true,
      startsAt: futureIsoDate({ days: 12 }),
      title: "Alpha Free Showcase",
      venueId: alphaVenue.id,
    });
    const canceledPerformance = await createPerformance("alpha.localhost", cookie, {
      publishOnWebsite: true,
      startsAt: futureIsoDate({ days: 15 }),
      title: "Alpha Canceled Concert",
      venueId: alphaVenue.id,
    });

    const cancelResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${canceledPerformance.id}/cancel`,
      cookie,
      {},
    );
    expect(cancelResponse.status).toBe(200);

    // Seed a past performance and an upcoming rehearsal directly
    await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, venue_id, publish_on_website, created_at, updated_at)
         VALUES (?, 'Alpha Past Concert', 'Performance', ?, ?, 1, ?, ?)`,
        crypto.randomUUID(),
        pastIsoDate({ days: 4 }),
        alphaVenue.id,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, venue_id, publish_on_website, created_at, updated_at)
         VALUES (?, 'Alpha Dress Rehearsal', 'Rehearsal', ?, ?, 1, ?, ?)`,
        crypto.randomUUID(),
        futureIsoDate({ days: 6 }),
        alphaVenue.id,
        now,
        now,
      );
      return undefined;
    });

    // 1. Send Members-only email -> includes unpublished + published performances
    const membersSend = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: {
          eventId: null,
          globalStatuses: ["Active"],
          profileIds: [memberProfileId],
          rsvp: "All",
          targetAudiences: ["Members"],
          voiceParts: [],
        },
        channel: "Email",
        contentMarkdown: "Hi {recipientName},\n\n{{UPCOMING_PERFORMANCES}}",
        subject: "Season schedule for members",
      },
    );
    expect(membersSend.status).toBe(202);
    const membersMessage = communicationMessageResponseSchema.parse(await membersSend.json());

    // 2. Send Members + Contacts email -> includes published performances ONLY
    const mixedSend = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: {
          contactIds: [contactId],
          eventId: null,
          globalStatuses: ["Active"],
          profileIds: [memberProfileId],
          rsvp: "All",
          targetAudiences: ["Members", "Contacts"],
          voiceParts: [],
        },
        channel: "Email",
        contentMarkdown: "Hi {recipientName},\n\n{{UPCOMING_PERFORMANCES}}",
        subject: "Season schedule for everyone",
      },
    );
    expect(mixedSend.status).toBe(202);
    const mixedMessage = communicationMessageResponseSchema.parse(await mixedSend.json());

    const membersJob = await readCommunicationJob(
      alphaStub,
      "organization-alpha",
      membersMessage.id,
    );
    const mixedJob = await readCommunicationJob(alphaStub, "organization-alpha", mixedMessage.id);
    const sentEmails = await deliverCapturedEmailBatch([membersJob, mixedJob]);

    const membersDelivered = sentEmails.find(
      (item) => item.subject === "Season schedule for members",
    );
    if (!membersDelivered) throw new Error("Missing members-only delivered email");
    const ticketPathSegment = ticketedPerformance.ticketSlug ?? ticketedPerformance.id;
    expect(membersDelivered.text).toContain("Alpha Internal Assembly");
    expect(membersDelivered.text).toContain("Alpha Free Showcase");
    expect(membersDelivered.text).toContain("Alpha Ticketed Gala");
    expect(membersDelivered.text).toContain("Alpha Symphony Hall, 100 Music Way");
    expect(membersDelivered.text).toContain(`https://alpha.localhost/tickets/${ticketPathSegment}`);
    expect(membersDelivered.text).not.toContain("Alpha Canceled Concert");
    expect(membersDelivered.text).not.toContain("Alpha Past Concert");
    expect(membersDelivered.text).not.toContain("Alpha Dress Rehearsal");
    expect(membersDelivered.text).not.toContain("Bravo Secret Gala");
    expect(membersDelivered.text.indexOf("Alpha Internal Assembly")).toBeLessThan(
      membersDelivered.text.indexOf("Alpha Free Showcase"),
    );
    expect(membersDelivered.text.indexOf("Alpha Free Showcase")).toBeLessThan(
      membersDelivered.text.indexOf("Alpha Ticketed Gala"),
    );

    const mixedDeliveredToContact = sentEmails.find(
      (item) => item.subject === "Season schedule for everyone" && item.to === contactEmail,
    );
    if (!mixedDeliveredToContact) throw new Error("Missing contact delivered email");
    expect(mixedDeliveredToContact.text).not.toContain("Alpha Internal Assembly");
    expect(mixedDeliveredToContact.text).toContain("Alpha Free Showcase");
    expect(mixedDeliveredToContact.text).toContain("Alpha Ticketed Gala");

    // 3. Verify member bulletins resolve {{UPCOMING_PERFORMANCES}} cleanly too
    const bulletinRes = await alphaStub.fetch(
      `https://organization.internal/internal/communications/member-bulletins?organizationId=organization-alpha&profileId=${memberProfileId}`,
    );
    expect(bulletinRes.status).toBe(200);
    const bulletinJson = z
      .object({
        bulletins: z.array(
          z.object({
            contentMarkdown: z.string(),
            id: z.string(),
            preview: z.string(),
            subject: z.string(),
          }),
        ),
      })
      .parse(await bulletinRes.json());
    const memberBulletin = bulletinJson.bulletins.find((b) => b.id === membersMessage.id);
    if (!memberBulletin) throw new Error("Missing member bulletin");
    expect(memberBulletin.contentMarkdown).not.toContain("{{UPCOMING_PERFORMANCES}}");
    expect(memberBulletin.contentMarkdown).toContain("Alpha Internal Assembly");
    expect(memberBulletin.contentMarkdown).toContain(
      `[Buy tickets](/tickets/${ticketPathSegment})`,
    );
  });

  it("blocks invalid send requests when no matching upcoming performances exist, and falls back gracefully if canceled before delivery", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    await createMemberWithEmail(
      "organization-alpha",
      cookie,
      "Alice Member",
      "member-empty@example.test",
    );
    const contactResponse = await write("alpha.localhost", "/api/organization/contacts", cookie, {
      displayName: "Bob Contact",
      email: "contact-empty@example.test",
      emailStatus: "subscribed",
    });
    expect(contactResponse.status).toBe(201);
    const contactId = z
      .object({ contact: z.object({ id: z.uuid() }) })
      .parse(await contactResponse.json()).contact.id;

    const venue = await createVenue("alpha.localhost", cookie, "Main Hall", "1 Main St");

    // Only an internal performance exists initially
    const internalPerf = await createPerformance("alpha.localhost", cookie, {
      publishOnWebsite: false,
      startsAt: futureIsoDate({ days: 10 }),
      title: "Internal Only Perf",
      venueId: venue.id,
    });

    // External audience send is rejected because 0 published performances exist
    const blockedContactsSend = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: {
          contactIds: [contactId],
          eventId: null,
          globalStatuses: [],
          profileIds: [],
          rsvp: "All",
          targetAudiences: ["Contacts"],
          voiceParts: [],
        },
        channel: "Email",
        contentMarkdown: "Lineup:\n\n{{UPCOMING_PERFORMANCES}}",
        subject: "Upcoming shows",
      },
    );
    expect(blockedContactsSend.status).toBe(400);
    expect(await blockedContactsSend.json()).toMatchObject({
      code: "invalid_communication_context",
    });

    // Subject usage is rejected
    const blockedSubjectSend = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: {
          eventId: null,
          globalStatuses: ["Active"],
          profileIds: [],
          rsvp: "All",
          targetAudiences: ["Members"],
          voiceParts: [],
        },
        channel: "Email",
        contentMarkdown: "Details inside",
        subject: "Shows: {{UPCOMING_PERFORMANCES}}",
      },
    );
    expect(blockedSubjectSend.status).toBe(400);
    expect(await blockedSubjectSend.json()).toMatchObject({
      code: "invalid_communication_context",
    });

    // Members-only send succeeds while internalPerf exists
    const queuedSend = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: {
          eventId: null,
          globalStatuses: ["Active"],
          profileIds: [],
          rsvp: "All",
          targetAudiences: ["Members"],
          voiceParts: [],
        },
        channel: "Email",
        contentMarkdown: "Lineup:\n\n{{UPCOMING_PERFORMANCES}}",
        subject: "Member lineup",
      },
    );
    expect(queuedSend.status).toBe(202);
    const queuedMessage = communicationMessageResponseSchema.parse(await queuedSend.json());

    // Cancel internalPerf AFTER queueing and BEFORE delivery executes
    const cancelRes = await write(
      "alpha.localhost",
      `/api/organization/events/${internalPerf.id}/cancel`,
      cookie,
      {},
    );
    expect(cancelRes.status).toBe(200);

    const job = await readCommunicationJob(alphaStub, "organization-alpha", queuedMessage.id);
    const sentEmails = await deliverCapturedEmailBatch([job]);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.text).toContain("No upcoming performances scheduled.");
    expect(sentEmails[0]?.text).not.toContain("{{UPCOMING_PERFORMANCES}}");
  });

  it("supports test email delivery, cross-tenant RPC isolation, and indexed query execution", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const venue = await createVenue("alpha.localhost", cookie, "Civic Theater", "55 Center St");
    await createPerformance("alpha.localhost", cookie, {
      publishOnWebsite: false,
      startsAt: futureIsoDate({ days: 9 }),
      title: "Alpha Member-Only Rehearsal Concert",
      venueId: venue.id,
    });

    const testEmailRes = await write(
      "alpha.localhost",
      "/api/organization/communications/test-email",
      cookie,
      {
        audience: {
          eventId: null,
          globalStatuses: ["Active"],
          profileIds: [],
          rsvp: "All",
          targetAudiences: ["Members"],
          voiceParts: [],
        },
        contentMarkdown: "Preview:\n\n{{UPCOMING_PERFORMANCES}}",
        email: "qa-test@example.test",
        subject: "Test Season Email",
      },
    );
    expect(testEmailRes.status).toBe(202);

    const memberRpc = await alphaStub.readUpcomingPerformancesContext({
      includeUnpublished: true,
      organizationId: "organization-alpha",
    });
    expect(memberRpc.performances.map((p) => p.title)).toEqual([
      "Alpha Member-Only Rehearsal Concert",
    ]);

    const externalRpc = await alphaStub.readUpcomingPerformancesContext({
      includeUnpublished: false,
      organizationId: "organization-alpha",
    });
    expect(externalRpc.performances).toEqual([]);

    await runInDurableObject<OrganizationStore, undefined>(alphaStub, async (instance) => {
      await expect(
        instance.readUpcomingPerformancesContext({
          includeUnpublished: true,
          organizationId: "organization-bravo",
        }),
      ).rejects.toThrow("organization_not_found");
      return undefined;
    });

    // Verify SQLite uses idx_events_active_calendar rather than a full table scan
    const planDetails = await runInDurableObject<OrganizationStore, readonly string[]>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly detail: string }>(
            `EXPLAIN QUERY PLAN
             SELECT e.id, e.title, e.starts_at AS startsAt
             FROM events e
             LEFT JOIN venues v ON v.id = e.venue_id
             WHERE e.is_archived = 0
               AND e.is_canceled = 0
               AND e.starts_at >= ?
               AND e.type = 'Performance'
             ORDER BY e.starts_at ASC, e.title ASC, e.id ASC
             LIMIT 200`,
            new Date().toISOString(),
          )
          .toArray()
          .map(({ detail }) => detail),
    );
    expect(planDetails.some((detail) => detail.includes("idx_events_active_calendar"))).toBe(true);
  });
});
