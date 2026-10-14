import {
  communicationMessageResponseSchema,
  communicationReachResponseSchema,
  communicationUnsubscribeResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { invokeOrganizationRpc, organizationStoreStub } from "../src/organization/rpc/client";
import { issueSignedLink } from "../src/security/signedLinks";
import {
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";
import {
  api,
  database,
  managerEmail,
  signIn,
  stores,
  write,
} from "./communications.integration.fixture";

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

afterEach(async () => teardownOrganizationIntegration());

describe("Organization communications unsubscribe and suppressions", () => {
  it("unsubscribes contacts with typed signed links and keeps them listed", async () => {
    const cookie = await signIn();
    const contactEmail = "newsletter.jane@example.test";
    const contactResponse = await write("alpha.localhost", "/api/organization/contacts", cookie, {
      displayName: "Newsletter Jane",
      email: contactEmail,
      emailStatus: "subscribed",
    });
    expect(contactResponse.status).toBe(201);
    const contactId = z
      .object({ contact: z.object({ id: z.uuid() }) })
      .parse(await contactResponse.json()).contact.id;
    const bounceContactResponse = await write(
      "alpha.localhost",
      "/api/organization/contacts",
      cookie,
      {
        displayName: "Bounce June",
        email: "bounce.june@example.test",
        emailStatus: "subscribed",
      },
    );
    expect(bounceContactResponse.status).toBe(201);
    const bounceContactId = z
      .object({ contact: z.object({ id: z.uuid() }) })
      .parse(await bounceContactResponse.json()).contact.id;
    const listResponse = await write("alpha.localhost", "/api/organization/contact-lists", cookie, {
      name: "Newsletter",
    });
    expect(listResponse.status).toBe(201);
    const listId = z.object({ list: z.object({ id: z.uuid() }) }).parse(await listResponse.json())
      .list.id;
    expect(
      (
        await write(
          "alpha.localhost",
          `/api/organization/contact-lists/${listId}/members`,
          cookie,
          {
            contactIds: [contactId, bounceContactId],
          },
        )
      ).status,
    ).toBe(200);

    const secret = env.SIGNED_LINK_SECRET;
    const issuedAt = Math.floor(Date.now() / 1_000);
    const mintContactToken = (
      subjectId: string,
      organizationId: string,
      issued: number = issuedAt,
      expires: number = issuedAt + 3_600,
    ) =>
      issueSignedLink(secret, {
        algorithm: "HS256",
        expiresAt: expires,
        issuedAt: issued,
        organizationId,
        purpose: "unsubscribe",
        resourceId: "contact",
        revocation: "email-v1",
        subjectId,
        version: 1,
      });
    const validToken = await mintContactToken(contactId, "organization-alpha");
    const tamperedToken = `${validToken.slice(0, -1)}${validToken.endsWith("a") ? "b" : "a"}`;
    const expiredToken = await mintContactToken(
      contactId,
      "organization-alpha",
      issuedAt - 7_200,
      issuedAt - 7_140,
    );
    const unknownContactToken = await mintContactToken(crypto.randomUUID(), "organization-alpha");

    const unsubscribe = (host: string, token: string) =>
      write(host, "/api/public/unsubscribe", cookie, { token });

    // A modified contact ID breaks the signature (constant-time verification).
    const tampered = await unsubscribe("alpha.localhost", tamperedToken);
    expect(tampered.status).toBe(400);
    expect(await tampered.json()).toMatchObject({ code: "invalid_unsubscribe_link" });

    // Expired tokens are rejected without touching storage.
    const expired = await unsubscribe("alpha.localhost", expiredToken);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ code: "invalid_unsubscribe_link" });

    // An Organization A token replayed on Organization B's host is rejected:
    // the Organization is resolved from the validated hostname, never from
    // client input, and the envelope stays bound to Organization A.
    const replayed = await unsubscribe("bravo.localhost", validToken);
    expect(replayed.status).toBe(400);
    expect(await replayed.json()).toMatchObject({ code: "invalid_unsubscribe_link" });

    // A well-formed signature for an unknown contact resolves to not-found
    // rather than leaking which IDs exist.
    expect((await unsubscribe("alpha.localhost", unknownContactToken)).status).toBe(404);

    const first = communicationUnsubscribeResponseSchema.parse(
      await (await unsubscribe("alpha.localhost", validToken)).json(),
    );
    expect(first.success).toBe(true);

    // Duplicate unsubscribe is idempotent: still success, no error.
    const second = communicationUnsubscribeResponseSchema.parse(
      await (await unsubscribe("alpha.localhost", validToken)).json(),
    );
    expect(second.success).toBe(true);

    const contactDetailSchema = z.object({
      contact: z.object({ email: z.string().nullable(), id: z.uuid() }),
      listIds: z.array(z.uuid()),
      preferences: z.array(
        z.object({
          channel: z.string(),
          source: z.string().nullable(),
          status: z.string(),
        }),
      ),
    });
    const readContact = async () =>
      contactDetailSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/contacts/${contactId}`, cookie),
          )
        ).json(),
      );
    const detail = await readContact();
    // Unsubscribing never deletes the contact, removes list membership, or
    // changes the stored address: only the email preference flips.
    expect(detail.contact.email).toBe(contactEmail);
    expect(detail.listIds).toContain(listId);
    expect(detail.preferences.find((preference) => preference.channel === "email")).toMatchObject({
      status: "unsubscribed",
      source: "user_unsubscribe",
    });
    expect(detail.preferences.find((preference) => preference.channel === "sms")?.status).not.toBe(
      "unsubscribed",
    );

    // Audit evidence is append-only, one row per request, and carries no
    // email address (audit-safe event).
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const auditSummaries = await runInDurableObject<OrganizationStore, string[]>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly summary: string }>(
            `SELECT change_summary AS summary FROM audit_events
             WHERE action = 'organization.communication.contact.unsubscribed' AND target_id = ?`,
            contactId,
          )
          .toArray()
          .map(({ summary }) => summary),
    );
    expect(auditSummaries).toHaveLength(2);
    for (const summary of auditSummaries) {
      expect(summary).toBe(JSON.stringify({ channel: "email" }));
      expect(summary).not.toContain(contactEmail);
    }
    // The contact path never writes profile-keyed suppression rows: contact
    // IDs are never stored as profile IDs (no fake-ID bolt-on).
    const suppressionCount = await runInDurableObject<OrganizationStore, number>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM communication_suppressions",
          )
          .toArray()[0]?.count ?? -1,
    );
    expect(suppressionCount).toBe(0);

    // Future audience previews exclude the unsubscribed contact regardless of
    // list membership (Scenario I setup: still listed, never delivered).
    const contactsAudience = {
      contactEmailStatus: null,
      contactIds: [],
      contactListIds: [listId],
      contactSmsStatus: null,
      contactSource: null,
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Contacts"],
      voiceParts: [],
    };
    const preview = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: contactsAudience,
          channel: "Email",
        })
      ).json(),
    );
    // Bounce June remains eligible; Newsletter Jane is unreachable.
    expect(preview).toMatchObject({ email: 1, total: 1, unreachable: 1 });

    // Future sends exclude the unsubscribed contact: a list send delivers
    // only to still-eligible June, with no delivery row for Jane.
    const listSend = communicationMessageResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience: contactsAudience,
          channel: "Email",
          contentMarkdown: "Newsletter body",
          subject: "Newsletter",
        })
      ).json(),
    );
    const listDestinations = await runInDurableObject<OrganizationStore, string[]>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly destination: string }>(
            `SELECT destination FROM communication_deliveries
             WHERE message_id = ? AND channel = 'email' ORDER BY destination`,
            listSend.id,
          )
          .toArray()
          .map(({ destination }) => destination),
    );
    expect(listDestinations).toEqual(["bounce.june@example.test"]);

    // A send whose entire audience unsubscribed is refused instead of
    // creating an empty message: zero reachable recipients, 409.
    const janeOnlyAudience = { ...contactsAudience, contactIds: [contactId], contactListIds: [] };
    const janePreview = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: janeOnlyAudience,
          channel: "Email",
        })
      ).json(),
    );
    expect(janePreview).toMatchObject({ email: 0, total: 0, unreachable: 1 });
    const janeOnlySend = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: janeOnlyAudience,
        channel: "Email",
        contentMarkdown: "Newsletter body",
        subject: "Newsletter",
      },
    );
    expect(janeOnlySend.status).toBe(409);
    expect(await janeOnlySend.json()).toMatchObject({
      code: "communication_has_no_recipients",
    });

    // CSV re-import policy (Scenario C/I): an imported `subscribed` value can
    // never override the stored unsubscribe; only an explicit resubscribe
    // workflow could. PATCH shares the import merge helper, so this proves
    // the re-import path too (import-level suppressedPreserved coverage lives
    // in contactImportStore.test.ts).
    const resubscribeResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/contacts/${contactId}`, cookie, {
        body: JSON.stringify({ emailStatus: "subscribed" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );
    expect(resubscribeResponse.status).toBe(200);
    expect(
      (await readContact()).preferences.find((preference) => preference.channel === "email")
        ?.status,
    ).toBe("unsubscribed");

    // Provider webhook (hard bounce): secure receipt resolves the delivery to
    // the correct Organization and contact, marks email unsubscribed with the
    // provider reason, and never touches other contacts or profiles.
    const deliveryId = crypto.randomUUID();
    const providerMessageId = `provider-msg-${deliveryId}`;
    await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
            (id, message_id, profile_id, recipient_name, channel, destination, status,
             attempts, provider_message_id, failure_detail, created_at, updated_at,
             unsubscribe_url, recipient_subject_json)
           VALUES (?, ?, ?, 'Bounce June', 'email', 'bounce.june@example.test', 'sent',
             1, ?, '', ?, ?, NULL, ?)`,
        deliveryId,
        crypto.randomUUID(),
        bounceContactId,
        providerMessageId,
        now,
        now,
        JSON.stringify({ contactId: bounceContactId, kind: "contact" }),
      );
      return undefined;
    });
    const feedbackBody = {
      bounceType: "hard",
      eventId: crypto.randomUUID(),
      eventTimestamp: new Date().toISOString(),
      organizationId: "organization-alpha",
      providerMessageId,
      providerReason: "550 5.1.1 User unknown",
      providerSmtpEnhancedStatusCode: "5.1.1",
      providerSmtpResponse: "550 5.1.1 User unknown",
      providerSmtpStatusCode: "550",
      providerStatus: "bounced",
      recipient: "bounce.june@example.test",
      sourceId: deliveryId,
      sourceKind: "communication_delivery",
      shouldSuppress: true,
    };
    const postFeedback = (body: unknown) =>
      invokeOrganizationRpc(
        organizationStoreStub(env, "organization-alpha"),
        "https://organization.internal/internal/email/provider-event",
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
    const feedbackResponse = await postFeedback(feedbackBody);
    expect(feedbackResponse.status).toBe(200);
    expect(await feedbackResponse.json()).toMatchObject({
      contactId: bounceContactId,
      profileId: null,
      providerSuppressed: true,
      recorded: true,
    });
    const bounceDetail = z
      .object({
        listIds: z.array(z.uuid()),
        preferences: z.array(
          z.object({ channel: z.string(), source: z.string().nullable(), status: z.string() }),
        ),
      })
      .parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/contacts/${bounceContactId}`, cookie),
          )
        ).json(),
      );
    expect(
      bounceDetail.preferences.find((preference) => preference.channel === "email"),
    ).toMatchObject({ status: "unsubscribed", source: "provider_bounce" });
    expect(bounceDetail.listIds).toContain(listId);

    // Webhook replay is idempotent: one preference row, terminal state kept.
    expect((await postFeedback(feedbackBody)).status).toBe(200);
    const bouncePrefCount = await runInDurableObject<OrganizationStore, number>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            `SELECT COUNT(*) AS count FROM contact_communication_preferences
             WHERE contact_id = ? AND channel = 'email'`,
            bounceContactId,
          )
          .toArray()[0]?.count ?? -1,
    );
    expect(bouncePrefCount).toBe(1);

    // A mismatched Organization in the webhook body is rejected at the RPC
    // identity gate (not found, no cross-tenant leak): feedback can never
    // cross the Organization boundary.
    const mismatched = await postFeedback({
      ...feedbackBody,
      organizationId: "organization-bravo",
    });
    expect(mismatched.status).toBe(404);
    expect(await mismatched.json()).toMatchObject({ code: "organization_not_found" });
    // An unknown delivery source is rejected rather than resolved by email.
    expect((await postFeedback({ ...feedbackBody, sourceId: crypto.randomUUID() })).status).toBe(
      404,
    );
  });
});
