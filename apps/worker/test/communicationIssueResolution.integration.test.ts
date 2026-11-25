import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import {
  communicationAudienceRequestSchema,
  communicationDeliverySummaryResponseSchema,
  communicationOverviewSchema,
  communicationResolveDeliveryEmailResponseSchema,
  communicationReviewIssuesResponseSchema,
} from "@choir/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  api,
  exports,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);

const audience = communicationAudienceRequestSchema.parse({
  eventId: null,
  globalStatuses: ["Active"],
  profileIds: [],
  rsvp: "All",
  targetAudiences: ["Members"],
  voiceParts: [],
});
const reach = JSON.stringify({ both: 0, email: 2, sms: 0, total: 2, unreachable: 0 });

describe("communication delivery issue visibility and resolution", () => {
  it("surfaces provider issues, marks them reviewed, and resurfaces late bounces", async () => {
    const cookie = await signIn();
    const stub = stores.getByName("organization-alpha");
    const messageId = crypto.randomUUID();
    const bouncedDeliveryId = crypto.randomUUID();
    const complainedDeliveryId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const sentAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const issueAt = new Date(Date.now() - 3600_000).toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Alex Singer', ?, ?)`,
        profileId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO contacts (id, display_name, email, normalized_email, source, created_at, updated_at)
         VALUES (?, 'Pat Patron', 'pat@example.test', 'pat@example.test', 'manual', ?, ?)`,
        contactId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, status, subject, content_markdown, audience_json, reach_json, created_by, created_at, updated_at, sent_at)
         VALUES (?, 'Email', 'Sent', 'Christmas Concert', 'Body', ?, ?, 'user-1', ?, ?, ?)`,
        messageId,
        JSON.stringify(audience),
        reach,
        sentAt,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts,
           provider_status, provider_reason, recipient_subject_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Alex Singer', 'email', 'alex.typo@example.test', 'sent', 1,
                 'bounced', '550 5.1.1 User unknown', ?, ?, ?)`,
        bouncedDeliveryId,
        messageId,
        profileId,
        JSON.stringify({ kind: "profile", profileId }),
        sentAt,
        issueAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts,
           provider_status, provider_reason, recipient_subject_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Pat Patron', 'email', 'pat@example.test', 'sent', 1,
                 'complained', 'Spam complaint', ?, ?, ?)`,
        complainedDeliveryId,
        messageId,
        contactId,
        JSON.stringify({ kind: "contact", contactId }),
        sentAt,
        issueAt,
      );
      return undefined;
    });

    // Overview shows "Sent with issues" + exact issueCount = 2
    const overviewBefore = communicationOverviewSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/overview", cookie),
        )
      ).json(),
    );
    expect(overviewBefore.attention).toHaveLength(1);
    expect(overviewBefore.attention[0]).toMatchObject({
      id: messageId,
      issueCount: 2,
      status: "Sent with issues",
    });

    // Delivery summary surfaces both provider issues with accurate editability
    const summaryBefore = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${messageId}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(summaryBefore.unresolvedIssueCount).toBe(2);
    expect(summaryBefore.issuesReviewedAt).toBeNull();
    expect(summaryBefore.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canEditEmail: true,
          deliveryId: bouncedDeliveryId,
          destination: "alex.typo@example.test",
          issueKind: "bounced",
          providerReason: "550 5.1.1 User unknown",
          recipientId: profileId,
          recipientKind: "profile",
        }),
        expect.objectContaining({
          canEditEmail: false,
          deliveryId: complainedDeliveryId,
          destination: "pat@example.test",
          issueKind: "complained",
          recipientId: contactId,
          recipientKind: "contact",
        }),
      ]),
    );

    // Auth & tenant isolation on review-issues
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/communications/${messageId}/review-issues`,
          "POST",
          {},
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await jsonWrite(
          "bravo.localhost",
          `/api/organization/communications/${messageId}/review-issues`,
          "POST",
          {},
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      await stub.reviewCommunicationIssues({
        actorUserId: "user-1",
        messageId,
        organizationId: "organization-bravo",
        requestId: crypto.randomUUID(),
      }),
    ).toEqual({ status: "not_found" });

    // Mark issues reviewed
    const reviewedResponse = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/review-issues`,
      "POST",
      {},
      cookie,
    );
    expect(reviewedResponse.status).toBe(200);
    const reviewed = communicationReviewIssuesResponseSchema.parse(await reviewedResponse.json());
    expect(reviewed.messageId).toBe(messageId);

    // Overview immediately clears from attention and status returns to Sent
    const overviewAfter = communicationOverviewSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/overview", cookie),
        )
      ).json(),
    );
    expect(overviewAfter.attention).toHaveLength(0);
    expect(overviewAfter.recent[0]).toMatchObject({ id: messageId, status: "Sent" });

    // Delivery summary retains historical issues but unresolvedIssueCount is 0
    const summaryAfter = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${messageId}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(summaryAfter.issues).toHaveLength(2);
    expect(summaryAfter.unresolvedIssueCount).toBe(0);
    expect(summaryAfter.issuesReviewedAt).toBe(reviewed.issuesReviewedAt);

    // A late bounce arriving after issuesReviewedAt automatically resurfaces the message
    const lateBounceAt = new Date(Date.parse(reviewed.issuesReviewedAt) + 60_000).toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts,
           provider_status, provider_reason, created_at, updated_at)
         VALUES (?, ?, ?, 'Late Bounce', 'email', 'late@example.test', 'sent', 1,
                 'bounced', 'Late hard bounce', ?, ?)`,
        crypto.randomUUID(),
        messageId,
        crypto.randomUUID(),
        sentAt,
        lateBounceAt,
      );
      return undefined;
    });
    const overviewResurfaced = communicationOverviewSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/overview", cookie),
        )
      ).json(),
    );
    expect(overviewResurfaced.attention).toHaveLength(1);
    expect(overviewResurfaced.attention[0]).toMatchObject({
      id: messageId,
      issueCount: 1,
      status: "Sent with issues",
    });
  });

  it("fixes a bounced profile email, clears bounce suppression, queues resend, and preserves explicit unsubscribes", async () => {
    const cookie = await signIn();
    const stub = stores.getByName("organization-alpha");
    const messageId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    const unsubDeliveryId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const unsubProfileId = crypto.randomUUID();
    const sentAt = new Date(Date.now() - 3600_000).toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles
          (id, display_name, provider_email_suppressed, provider_email_suppressed_at,
           provider_email_suppressed_reason, last_bounce_at, bounce_reason, created_at, updated_at)
         VALUES (?, 'Bounced Singer', 1, ?, 'Hard bounce', ?, 'Hard bounce', ?, ?)`,
        profileId,
        sentAt,
        sentAt,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_suppressions
          (id, profile_id, channel, reason, active, created_at, updated_at)
         VALUES (?, ?, 'email', 'provider', 1, ?, ?)`,
        crypto.randomUUID(),
        profileId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Opted Out Singer', ?, ?)`,
        unsubProfileId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_suppressions
          (id, profile_id, channel, reason, active, created_at, updated_at)
         VALUES (?, ?, 'email', 'user_unsubscribe', 1, ?, ?)`,
        crypto.randomUUID(),
        unsubProfileId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, status, subject, content_markdown, audience_json, reach_json, created_by, created_at, updated_at, sent_at)
         VALUES (?, 'Email', 'Sent', 'Rehearsal Update', 'Body', ?, ?, 'user-1', ?, ?, ?)`,
        messageId,
        JSON.stringify(audience),
        reach,
        sentAt,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts,
           provider_status, provider_reason, recipient_subject_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Bounced Singer', 'email', 'old.typo@example.test', 'sent', 1,
                 'bounced', '550 Unknown user', ?, ?, ?)`,
        deliveryId,
        messageId,
        profileId,
        JSON.stringify({ kind: "profile", profileId }),
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts,
           provider_status, provider_reason, recipient_subject_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Opted Out Singer', 'email', 'optedout.old@example.test', 'failed', 1,
                 NULL, '', ?, ?, ?)`,
        unsubDeliveryId,
        messageId,
        unsubProfileId,
        JSON.stringify({ kind: "profile", profileId: unsubProfileId }),
        sentAt,
        sentAt,
      );
      return undefined;
    });

    // Resolve bounced profile email with resend = true
    const response = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${deliveryId}/resolve-email`,
      "POST",
      { email: "fixed.singer@example.test", resend: true },
      cookie,
    );
    expect(response.status).toBe(200);
    const resolved = communicationResolveDeliveryEmailResponseSchema.parse(await response.json());
    expect(resolved).toMatchObject({
      clearedBounceSuppression: true,
      deliveryId,
      email: "fixed.singer@example.test",
      messageId,
      resent: true,
    });

    // Verify DB state: linked roster contact created, bounce suppression cleared, delivery queued
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const contact = state.storage.sql
        .exec<{ readonly email: string; readonly normalizedEmail: string }>(
          "SELECT email, normalized_email AS normalizedEmail FROM contacts WHERE profile_id = ?",
          profileId,
        )
        .one();
      expect(contact).toEqual({
        email: "fixed.singer@example.test",
        normalizedEmail: "fixed.singer@example.test",
      });
      const profile = state.storage.sql
        .exec<{ readonly lastBounceAt: string; readonly providerSuppressed: number }>(
          "SELECT provider_email_suppressed AS providerSuppressed, last_bounce_at AS lastBounceAt FROM profiles WHERE id = ?",
          profileId,
        )
        .one();
      expect(profile).toEqual({ lastBounceAt: "", providerSuppressed: 0 });
      const suppression = state.storage.sql
        .exec<{ readonly active: number }>(
          "SELECT active FROM communication_suppressions WHERE profile_id = ? AND channel = 'email'",
          profileId,
        )
        .one();
      expect(suppression.active).toBe(0);
      const delivery = state.storage.sql
        .exec<{
          readonly destination: string;
          readonly providerStatus: string | null;
          readonly status: string;
        }>(
          "SELECT destination, status, provider_status AS providerStatus FROM communication_deliveries WHERE id = ?",
          deliveryId,
        )
        .one();
      expect(delivery).toEqual({
        destination: "fixed.singer@example.test",
        providerStatus: null,
        status: "queued",
      });
      const outboxCount = state.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'communication_delivery'",
        )
        .one().count;
      expect(outboxCount).toBe(1);
      return undefined;
    });

    // Updating an email on a profile with explicit user_unsubscribe must NEVER clear their opt-out
    const unsubResponse = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${unsubDeliveryId}/resolve-email`,
      "POST",
      { email: "optedout.new@example.test", resend: false },
      cookie,
    );
    expect(unsubResponse.status).toBe(200);
    const unsubResolved = communicationResolveDeliveryEmailResponseSchema.parse(
      await unsubResponse.json(),
    );
    expect(unsubResolved.clearedBounceSuppression).toBe(false);
    expect(unsubResolved.resent).toBe(false);

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const suppression = state.storage.sql
        .exec<{ readonly active: number; readonly reason: string }>(
          "SELECT active, reason FROM communication_suppressions WHERE profile_id = ? AND channel = 'email'",
          unsubProfileId,
        )
        .one();
      expect(suppression).toEqual({ active: 1, reason: "user_unsubscribe" });
      return undefined;
    });
  });

  it("clears contact bounce suppression without resend, rejects spam complaints and duplicate emails, and enforces tenant isolation", async () => {
    const cookie = await signIn();
    const stub = stores.getByName("organization-alpha");
    const messageId = crypto.randomUUID();
    const bouncedDeliveryId = crypto.randomUUID();
    const complaintDeliveryId = crypto.randomUUID();
    const bouncedContactId = crypto.randomUUID();
    const existingContactId = crypto.randomUUID();
    const complaintContactId = crypto.randomUUID();
    const sentAt = new Date(Date.now() - 3600_000).toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO contacts (id, display_name, email, normalized_email, source, created_at, updated_at)
         VALUES (?, 'Bounced Contact', 'bad@example.test', 'bad@example.test', 'manual', ?, ?),
                (?, 'Taken Contact', 'taken@example.test', 'taken@example.test', 'manual', ?, ?),
                (?, 'Spam Contact', 'spam@example.test', 'spam@example.test', 'manual', ?, ?)`,
        bouncedContactId,
        sentAt,
        sentAt,
        existingContactId,
        sentAt,
        sentAt,
        complaintContactId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO contact_communication_preferences
          (contact_id, channel, status, source, observed_at, updated_at)
         VALUES (?, 'email', 'unsubscribed', 'provider_bounce', ?, ?),
                (?, 'email', 'unsubscribed', 'provider_complaint', ?, ?)`,
        bouncedContactId,
        sentAt,
        sentAt,
        complaintContactId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, status, subject, content_markdown, audience_json, reach_json, created_by, created_at, updated_at, sent_at)
         VALUES (?, 'Email', 'Sent', 'Holiday Blast', 'Body', ?, ?, 'user-1', ?, ?, ?)`,
        messageId,
        JSON.stringify(audience),
        reach,
        sentAt,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts,
           provider_status, provider_reason, recipient_subject_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Bounced Contact', 'email', 'bad@example.test', 'sent', 1,
                 'bounced', 'Hard bounce', ?, ?, ?),
                (?, ?, ?, 'Spam Contact', 'email', 'spam@example.test', 'sent', 1,
                 'complained', 'Spam report', ?, ?, ?)`,
        bouncedDeliveryId,
        messageId,
        bouncedContactId,
        JSON.stringify({ kind: "contact", contactId: bouncedContactId }),
        sentAt,
        sentAt,
        complaintDeliveryId,
        messageId,
        complaintContactId,
        JSON.stringify({ kind: "contact", contactId: complaintContactId }),
        sentAt,
        sentAt,
      );
      return undefined;
    });

    // Reject duplicate email
    const dupRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${bouncedDeliveryId}/resolve-email`,
      "POST",
      { email: "taken@example.test", resend: false },
      cookie,
    );
    expect(dupRes.status).toBe(409);
    expect(await dupRes.json()).toMatchObject({ code: "contact_duplicate_email" });

    // Reject spam complaint
    const spamRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${complaintDeliveryId}/resolve-email`,
      "POST",
      { email: "other@example.test", resend: true },
      cookie,
    );
    expect(spamRes.status).toBe(409);
    expect(await spamRes.json()).toMatchObject({ code: "delivery_spam_complaint" });

    // Cross-tenant host rejected
    const crossTenant = await jsonWrite(
      "bravo.localhost",
      `/api/organization/communications/${messageId}/deliveries/${bouncedDeliveryId}/resolve-email`,
      "POST",
      { email: "fixed.contact@example.test", resend: false },
      cookie,
    );
    expect(crossTenant.status).toBe(403);

    // Valid contact email update without resend clears provider_bounce preference
    const okRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${bouncedDeliveryId}/resolve-email`,
      "POST",
      { email: "fixed.contact@example.test", resend: false },
      cookie,
    );
    expect(okRes.status).toBe(200);
    expect(communicationResolveDeliveryEmailResponseSchema.parse(await okRes.json())).toMatchObject(
      {
        clearedBounceSuppression: true,
        email: "fixed.contact@example.test",
        resent: false,
      },
    );

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const pref = state.storage.sql
        .exec<{ readonly source: string; readonly status: string }>(
          "SELECT status, source FROM contact_communication_preferences WHERE contact_id = ? AND channel = 'email'",
          bouncedContactId,
        )
        .one();
      expect(pref).toEqual({ source: "email_updated", status: "unknown" });
      return undefined;
    });
  });

  it("supports clearing bounced email addresses and removing standalone contacts", async () => {
    const cookie = await signIn();
    const stub = stores.getByName("organization-alpha");
    const messageId = crypto.randomUUID();
    const namedContactId = crypto.randomUUID();
    const emailOnlyContactId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const profileContactId = crypto.randomUUID();
    const listId = crypto.randomUUID();
    const namedDeliveryId = crypto.randomUUID();
    const emailOnlyDeliveryId = crypto.randomUUID();
    const profileDeliveryId = crypto.randomUUID();
    const sentAt = new Date().toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, provider_email_suppressed, last_bounce_at, bounce_reason, created_at, updated_at)
         VALUES (?, 'Member Bounce', 1, ?, '550 5.1.1', ?, ?)`,
        profileId,
        sentAt,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO contacts (id, display_name, email, normalized_email, profile_id, source, created_at, updated_at)
         VALUES (?, 'Carol Family', 'carol@example.test', 'carol@example.test', NULL, 'manual', ?, ?),
                (?, NULL, 'onlyemail@example.test', 'onlyemail@example.test', NULL, 'manual', ?, ?),
                (?, 'Member Bounce', 'member@example.test', 'member@example.test', ?, 'roster', ?, ?)`,
        namedContactId,
        sentAt,
        sentAt,
        emailOnlyContactId,
        sentAt,
        sentAt,
        profileContactId,
        profileId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO contact_lists (id, name, created_at, updated_at)
         VALUES (?, 'Patrons', ?, ?)`,
        listId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO contact_list_memberships (list_id, contact_id, created_at)
         VALUES (?, ?, ?), (?, ?, ?)`,
        listId,
        namedContactId,
        sentAt,
        listId,
        emailOnlyContactId,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO contact_communication_preferences (contact_id, channel, status, source, observed_at, updated_at)
         VALUES (?, 'email', 'unsubscribed', 'provider_bounce', ?, ?),
                (?, 'email', 'unsubscribed', 'provider_bounce', ?, ?)`,
        namedContactId,
        sentAt,
        sentAt,
        profileContactId,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, status, subject, content_markdown, audience_json, reach_json, created_by, created_at, updated_at, sent_at)
         VALUES (?, 'Email', 'Sent', 'Spring Gala', 'Body', ?, ?, 'user-1', ?, ?, ?)`,
        messageId,
        JSON.stringify(audience),
        reach,
        sentAt,
        sentAt,
        sentAt,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status, attempts,
           provider_status, provider_reason, recipient_subject_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Carol Family', 'email', 'carol@example.test', 'sent', 1, 'bounced', '554 mailbox disabled', ?, ?, ?),
                (?, ?, ?, 'onlyemail@example.test', 'email', 'onlyemail@example.test', 'sent', 1, 'bounced', '550 unknown', ?, ?, ?),
                (?, ?, ?, 'Member Bounce', 'email', 'member@example.test', 'sent', 1, 'bounced', '550 unknown', ?, ?, ?)`,
        namedDeliveryId,
        messageId,
        namedContactId,
        JSON.stringify({ kind: "contact", contactId: namedContactId }),
        sentAt,
        sentAt,
        emailOnlyDeliveryId,
        messageId,
        emailOnlyContactId,
        JSON.stringify({ kind: "contact", contactId: emailOnlyContactId }),
        sentAt,
        sentAt,
        profileDeliveryId,
        messageId,
        profileId,
        JSON.stringify({ kind: "profile", profileId }),
        sentAt,
        sentAt,
      );
      return undefined;
    });

    // Summary advertises accurate capabilities for each recipient type
    const summaryBefore = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${messageId}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(summaryBefore.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canArchiveProfile: false,
          canClearEmail: true,
          canDeleteContact: true,
          canEditEmail: true,
          deliveryId: namedDeliveryId,
          recipientStatus: "active",
        }),
        expect.objectContaining({
          canArchiveProfile: false,
          canClearEmail: false,
          canDeleteContact: true,
          canEditEmail: true,
          deliveryId: emailOnlyDeliveryId,
          recipientStatus: "active",
        }),
        expect.objectContaining({
          canArchiveProfile: true,
          canClearEmail: true,
          canDeleteContact: false,
          canEditEmail: true,
          deliveryId: profileDeliveryId,
          recipientStatus: "active",
        }),
      ]),
    );

    // Standalone contact rejects archive_profile
    const archiveStandaloneRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${namedDeliveryId}/resolve-email`,
      "POST",
      { action: "archive_profile" },
      cookie,
    );
    expect(archiveStandaloneRes.status).toBe(409);
    expect(await archiveStandaloneRes.json()).toMatchObject({
      code: "recipient_profile_not_archivable",
    });

    // Email-only contact rejects clear_email (would leave contact without identity)
    const missingIdentityRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${emailOnlyDeliveryId}/resolve-email`,
      "POST",
      { action: "clear_email" },
      cookie,
    );
    expect(missingIdentityRes.status).toBe(409);
    expect(await missingIdentityRes.json()).toMatchObject({ code: "contact_missing_identity" });

    // Profile rejects delete_contact
    const deleteProfileRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${profileDeliveryId}/resolve-email`,
      "POST",
      { action: "delete_contact" },
      cookie,
    );
    expect(deleteProfileRes.status).toBe(409);
    expect(await deleteProfileRes.json()).toMatchObject({
      code: "recipient_contact_not_deletable",
    });

    // Clear email on named contact keeps contact, clears email & bounce suppression
    const clearNamedRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${namedDeliveryId}/resolve-email`,
      "POST",
      { action: "clear_email" },
      cookie,
    );
    expect(clearNamedRes.status).toBe(200);
    expect(
      communicationResolveDeliveryEmailResponseSchema.parse(await clearNamedRes.json()),
    ).toMatchObject({
      action: "clear_email",
      clearedBounceSuppression: true,
      email: null,
      resent: false,
    });

    // Clear email on profile keeps profile & primary contact, clears email & bounce suppression
    const clearProfileRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${profileDeliveryId}/resolve-email`,
      "POST",
      { action: "clear_email" },
      cookie,
    );
    expect(clearProfileRes.status).toBe(200);
    expect(
      communicationResolveDeliveryEmailResponseSchema.parse(await clearProfileRes.json()),
    ).toMatchObject({
      action: "clear_email",
      clearedBounceSuppression: true,
      email: null,
      resent: false,
    });

    // Delete standalone email-only contact removes contact, preferences, and list memberships
    const deleteContactRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${emailOnlyDeliveryId}/resolve-email`,
      "POST",
      { action: "delete_contact" },
      cookie,
    );
    expect(deleteContactRes.status).toBe(200);
    expect(
      communicationResolveDeliveryEmailResponseSchema.parse(await deleteContactRes.json()),
    ).toMatchObject({
      action: "delete_contact",
      clearedBounceSuppression: false,
      email: null,
      resent: false,
    });

    // Archive Organization Profile hides it from the active roster while preserving history
    const archiveProfileRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/communications/${messageId}/deliveries/${profileDeliveryId}/resolve-email`,
      "POST",
      { action: "archive_profile" },
      cookie,
    );
    expect(archiveProfileRes.status).toBe(200);
    expect(
      communicationResolveDeliveryEmailResponseSchema.parse(await archiveProfileRes.json()),
    ).toMatchObject({
      action: "archive_profile",
      clearedBounceSuppression: false,
      email: null,
      resent: false,
    });

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const namedRow = state.storage.sql
        .exec<{ readonly email: string | null }>(
          "SELECT email FROM contacts WHERE id = ?",
          namedContactId,
        )
        .one();
      expect(namedRow.email).toBeNull();

      const deletedRows = state.storage.sql
        .exec<{ readonly id: string }>("SELECT id FROM contacts WHERE id = ?", emailOnlyContactId)
        .toArray();
      expect(deletedRows).toHaveLength(0);

      const memberships = state.storage.sql
        .exec<{ readonly contactId: string }>(
          "SELECT contact_id AS contactId FROM contact_list_memberships WHERE contact_id = ?",
          emailOnlyContactId,
        )
        .toArray();
      expect(memberships).toHaveLength(0);

      const profileRow = state.storage.sql
        .exec<{
          readonly globalStatus: string;
          readonly hidden: number;
          readonly providerSuppressed: number;
          readonly statusIsManual: number;
        }>(
          `SELECT global_status AS globalStatus, hidden, status_is_manual AS statusIsManual,
             provider_email_suppressed AS providerSuppressed
           FROM profiles WHERE id = ?`,
          profileId,
        )
        .one();
      expect(profileRow).toEqual({
        globalStatus: "Inactive",
        hidden: 1,
        providerSuppressed: 0,
        statusIsManual: 1,
      });
      return undefined;
    });

    // Summary reflects email_removed, contact_removed, and profile_archived statuses
    const summaryAfter = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${messageId}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(summaryAfter.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canArchiveProfile: false,
          canClearEmail: false,
          canDeleteContact: true,
          canEditEmail: true,
          deliveryId: namedDeliveryId,
          recipientStatus: "email_removed",
        }),
        expect.objectContaining({
          canArchiveProfile: false,
          canClearEmail: false,
          canDeleteContact: false,
          canEditEmail: false,
          deliveryId: emailOnlyDeliveryId,
          recipientStatus: "contact_removed",
        }),
        expect.objectContaining({
          canArchiveProfile: false,
          canClearEmail: false,
          canDeleteContact: false,
          canEditEmail: true,
          deliveryId: profileDeliveryId,
          recipientStatus: "profile_archived",
        }),
      ]),
    );
  });
});
