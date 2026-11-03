import { organizationRequest } from "@choir/testkit";
import { donationCheckoutResponseSchema } from "@choir/contracts";
import { updateDonationSettingsInStore } from "../src/organization/donationSettingsStore";
import { env, exports } from "cloudflare:workers";
import { issueSignedLink } from "../src/security/signedLinks";
import { readPublicDonationReceipt } from "../src/organization/organizationDonations";
import { attachDonationArtwork } from "../src/organization/donation/mutations";
import { futureDateString } from "@choir/testkit";
import { runInDurableObject } from "cloudflare:test";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  donationPublicationsResponseSchema,
  donationPublicationReviewResponseSchema,
  donationRecordSchema,
} from "@choir/contracts";
import {
  stores,
  setupTicketingIntegration,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { createManualDonation } from "../src/organization/donation/manual";
import { createDonationCheckout } from "../src/organization/donation/checkout";
import { completeStripeDonation } from "../src/organization/donation/stripeLifecycle";
import { donationById, donationResult } from "../src/organization/donation/queries";

const org = "organization-alpha";
const stub = () => stores.getByName(org);
const actor = "publication-manager";
async function publication(
  name = "Holiday",
  recognitionDate: string | null = "2020-01-01",
  artworkDate: string | null = "2020-01-01",
) {
  const id = crypto.randomUUID();
  const response = await stub().saveDonationPublication({
    organizationId: org,
    actorUserId: actor,
    mutation: {
      id,
      name,
      recognitionDate,
      artworkDate,
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
    },
  });
  expect(response.status).toBe(200);
  const current = donationPublicationsResponseSchema.parse(await response.json()).current;
  if (!current) throw new Error("Publication not created");
  return current;
}
async function manual(publicationId?: string | null, receivedAt?: string) {
  const id = crypto.randomUUID();
  return runInDurableObject<OrganizationStore, ReturnType<typeof donationRecordSchema.parse>>(
    stub(),
    (_instance, state) => {
      createManualDonation(state.storage, {
        action: "create_manual_donation",
        organizationId: org,
        actorUserId: actor,
        requestId: crypto.randomUUID(),
        donationId: id,
        donation: {
          amountCents: 2500,
          anonymous: false,
          buyerEmail: "",
          buyerName: "Donor",
          marketingConsent: false,
          paymentMethod: "check",
          paymentReference: "",
          thankYouSent: false,
          tributeName: "",
          tributeNotifyEmail: "",
          tributeType: "none",
          ...(publicationId !== undefined ? { publicationId } : {}),
          ...(receivedAt ? { receivedAt } : {}),
        },
      });
      const row = donationById(state.storage, id);
      if (!row) throw new Error("Missing gift");
      return donationRecordSchema.parse(donationResult(row));
    },
  );
}
beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);
describe("donation publication history and review", () => {
  it("keeps historical and explicitly unassigned gifts unassigned", async () => {
    const old = await manual();
    await publication();
    expect(old.publicationContext).toBeNull();
    expect((await manual(null)).publicationContext).toBeNull();
  });
  it("accepts late gifts and independently flags them without blocking payment", async () => {
    await publication();
    const gift = await manual();
    expect(gift.status).toBe("paid");
    expect(gift.publicationContext?.recognitionStatus).toBe("after_cutoff");
    expect(gift.publicationContext?.artworkStatus).toBe("pending");
  });
  it("supports independent optional dates", async () => {
    await publication("No recognition deadline", null);
    const gift = await manual();
    expect(gift.publicationContext?.recognitionStatus).toBe("unconfigured");
  });
  it("retains the original publication after rollover", async () => {
    const holiday = await publication();
    const gift = await manual();
    await publication("Spring");
    const result = await stub().reviewDonationPublications({
      organizationId: org,
      publicationId: holiday.id,
    });
    const review = donationPublicationReviewResponseSchema.parse(await result.json());
    expect(
      review.donations.find((d) => d.id === gift.id)?.publicationContext?.publication.name,
    ).toBe("Holiday");
  });
  it("records later inclusion idempotently and removes it from outstanding review", async () => {
    await publication();
    const gift = await manual();
    const spring = await publication("Spring");
    const mutation = {
      donationId: gift.id,
      publicationId: spring.id,
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
    };
    expect(
      (await stub().setDonationInclusion({ organizationId: org, actorUserId: actor, mutation }))
        .status,
    ).toBe(200);
    expect(
      (await stub().setDonationInclusion({ organizationId: org, actorUserId: actor, mutation }))
        .status,
    ).toBe(200);
    const response = await stub().reviewDonationPublications({
      organizationId: org,
      filter: "review",
    });
    expect(
      donationPublicationReviewResponseSchema.parse(await response.json()).donations,
    ).toHaveLength(0);
  });
  it("extensions reevaluate flags while inclusion and receipt content remain intact", async () => {
    const p = await publication();
    const gift = await manual();
    await stub().saveDonationPublication({
      organizationId: org,
      actorUserId: actor,
      mutation: {
        ...p,
        recognitionDate: futureDateString({ days: 90 }),
        expectedRevision: p.revision,
        requestId: crypto.randomUUID(),
      },
    });
    const response = await stub().reviewDonationPublications({ organizationId: org });
    expect(
      donationPublicationReviewResponseSchema
        .parse(await response.json())
        .donations.find((d) => d.id === gift.id)?.publicationContext?.recognitionStatus,
    ).toBe("on_time");
  });
  it("rejects stale edits and cross-Organization access", async () => {
    const p = await publication();
    expect(
      (
        await stub().saveDonationPublication({
          organizationId: org,
          actorUserId: actor,
          mutation: { ...p, expectedRevision: 0, requestId: crypto.randomUUID() },
        })
      ).status,
    ).toBe(409);
    expect(
      (await stub().listDonationPublications({ organizationId: "organization-beta" })).status,
    ).toBe(404);
    expect(
      (await stub().reviewDonationPublications({ organizationId: "organization-beta" })).status,
    ).toBe(404);
  });
  it("captures checkout publication and uses provider success time despite delayed processing", async () => {
    const p = await publication();
    const id = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      const result = createDonationCheckout(state.storage, {
        action: "create_stripe_pending_donation",
        organizationId: org,
        donationId: id,
        providerSessionId: "cs_publication",
        checkout: {
          amountCents: 2500,
          anonymous: false,
          buyerEmail: "donor@example.test",
          buyerName: "Donor",
          checkoutRequestId,
          marketingConsent: false,
          tributeName: "",
          tributeNotifyEmail: "",
          tributeType: "none",
          publicationId: p.id,
          publicationRevision: p.revision,
        },
      });
      expect(result.status).toBe(201);
      return null;
    });
    await publication("Spring");
    const gift = await runInDurableObject<
      OrganizationStore,
      ReturnType<typeof donationRecordSchema.parse>
    >(stub(), (_instance, state) => {
      completeStripeDonation(state.storage, {
        action: "stripe_donation_completed",
        organizationId: org,
        providerSessionId: "cs_publication",
        providerPaymentId: "pi_publication",
        stripeEventId: "evt_publication",
        paidAt: "2021-01-01T00:00:00Z",
      });
      const row = donationById(state.storage, id);
      if (!row) throw new Error("Missing gift");
      return donationRecordSchema.parse(donationResult(row));
    });
    expect(gift.publicationContext?.publication.id).toBe(p.id);
    expect(gift.publicationContext?.paidAt).toBe("2021-01-01T00:00:00Z");
  });
  it("paginates beyond 500 gifts and uses selective indexes", async () => {
    await publication();
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      for (let i = 0; i < 505; i++)
        createManualDonation(state.storage, {
          action: "create_manual_donation",
          organizationId: org,
          actorUserId: actor,
          requestId: crypto.randomUUID(),
          donationId: crypto.randomUUID(),
          donation: {
            amountCents: 100,
            anonymous: false,
            buyerEmail: "",
            buyerName: "Donor",
            marketingConsent: false,
            paymentMethod: "cash",
            paymentReference: "",
            thankYouSent: false,
            tributeName: "",
            tributeNotifyEmail: "",
            tributeType: "none",
          },
        });
      const plan = state.storage.sql
        .exec(
          "EXPLAIN QUERY PLAN SELECT donation_id FROM donation_publication_facts WHERE publication_id=?",
          "p",
        )
        .toArray();
      expect(JSON.stringify(plan)).toContain("donation_publication_facts_publication");
      return null;
    });
    let cursor: string | undefined;
    let count = 0;
    do {
      const response = await stub().reviewDonationPublications({
        organizationId: org,
        ...(cursor ? { cursor } : {}),
        filter: "all",
      });
      const page = donationPublicationReviewResponseSchema.parse(await response.json());
      count += page.donations.length;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(count).toBe(505);
  });
  it("accepts late artwork, records submissions, and reopens review for late replacements", async () => {
    const p = await publication();
    const gift = await manual();
    const files = [crypto.randomUUID(), crypto.randomUUID()];
    for (const fileId of files) {
      await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
        state.storage.sql.exec("UPDATE donations SET includes_program_ad=1 WHERE id=?", gift.id);
        state.storage.sql.exec(
          "INSERT INTO private_files(id,storage_key,file_name,content_type,size_bytes,status,uploaded_by,request_id,created_at) VALUES(?,?,?,'application/pdf',10,'ready',?,?,?)",
          fileId,
          `organizations/${org}/${fileId}`,
          "ad.pdf",
          actor,
          crypto.randomUUID(),
          new Date().toISOString(),
        );
        const result = attachDonationArtwork(state.storage, {
          action: "attach_donation_artwork",
          organizationId: org,
          donationId: gift.id,
          fileId,
          actorType: "organization_member",
          actorUserId: actor,
          requestId: crypto.randomUUID(),
        });
        expect(result.status).toBe(200);
        return null;
      });
      if (fileId === files[0])
        expect(
          (
            await stub().setDonationInclusion({
              organizationId: org,
              actorUserId: actor,
              mutation: {
                donationId: gift.id,
                publicationId: p.id,
                expectedRevision: 0,
                requestId: crypto.randomUUID(),
              },
            })
          ).status,
        ).toBe(200);
    }
    const response = await stub().reviewDonationPublications({
      organizationId: org,
      filter: "review",
    });
    const review = donationPublicationReviewResponseSchema.parse(await response.json());
    expect(review.donations[0]?.publicationContext?.artworkStatus).toBe("after_cutoff");
    expect(review.donations[0]?.includedPublicationId).toBe(p.id);
  });
  it("honors advertised cutoff for pending checkout when the date is shortened", async () => {
    const p = await publication("Holiday", futureDateString({ days: 5 }), null);
    const id = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      const result = createDonationCheckout(state.storage, {
        action: "create_stripe_pending_donation",
        organizationId: org,
        donationId: id,
        providerSessionId: "cs_grandfather",
        checkout: {
          amountCents: 2500,
          anonymous: false,
          buyerEmail: "donor@example.test",
          buyerName: "Donor",
          checkoutRequestId: crypto.randomUUID(),
          marketingConsent: false,
          tributeName: "",
          tributeNotifyEmail: "",
          tributeType: "none",
          publicationId: p.id,
          publicationRevision: p.revision,
        },
      });
      expect(result.status).toBe(201);
      return null;
    });
    await stub().saveDonationPublication({
      organizationId: org,
      actorUserId: actor,
      mutation: {
        ...p,
        recognitionDate: "2020-01-01",
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
      },
    });
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      completeStripeDonation(state.storage, {
        action: "stripe_donation_completed",
        organizationId: org,
        providerSessionId: "cs_grandfather",
        providerPaymentId: "pi_grandfather",
        stripeEventId: "evt_grandfather",
        paidAt: new Date().toISOString(),
      });
      const row = donationById(state.storage, id);
      if (!row) throw new Error("Missing gift");
      expect(donationResult(row).publicationContext?.recognitionStatus).toBe("on_time");
      const notification = state.storage.sql
        .exec<{ content: string }>(
          "SELECT content_markdown AS content FROM payment_notifications WHERE resource_id=?",
          id,
        )
        .one();
      expect(notification.content).toContain("Publication recognition");
      return null;
    });
  });
  it("keeps signed receipts on the original publication and rejects expired or cross-Organization links", async () => {
    const secret = env.SIGNED_LINK_SECRET;
    if (!secret) throw new Error("Missing test signing binding");
    const original = await publication();
    const gift = await manual();
    const spring = await publication("Spring");
    await stub().setDonationInclusion({
      organizationId: org,
      actorUserId: actor,
      mutation: {
        donationId: gift.id,
        publicationId: spring.id,
        expectedRevision: 0,
        requestId: crypto.randomUUID(),
      },
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await issueSignedLink(secret, {
      algorithm: "HS256",
      issuedAt: now,
      expiresAt: now + 3600,
      nonce: crypto.randomUUID(),
      organizationId: org,
      purpose: "donation_receipt",
      resourceId: gift.id,
      version: 1,
    });
    const runtime = { ORGANIZATION_STORE: stores, SIGNED_LINK_SECRET: secret };
    const receipt = await readPublicDonationReceipt(runtime, org, token);
    expect(receipt.publicationContext?.publication.id).toBe(original.id);
    expect(Object.hasOwn(receipt, "includedPublicationId")).toBe(false);
    await expect(
      readPublicDonationReceipt(runtime, "organization-beta", token),
    ).rejects.toMatchObject({ code: "donation_receipt_invalid" });
    const expired = await issueSignedLink(secret, {
      algorithm: "HS256",
      issuedAt: now - 7200,
      expiresAt: now - 3600,
      nonce: crypto.randomUUID(),
      organizationId: org,
      purpose: "donation_receipt",
      resourceId: gift.id,
      version: 1,
    });
    await expect(readPublicDonationReceipt(runtime, org, expired)).rejects.toMatchObject({
      code: "donation_receipt_invalid",
    });
  });
  it("keeps the active publication when an older client saves only page copy", async () => {
    const p = await publication();
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      const response = updateDonationSettingsInStore(
        state.storage,
        org,
        { buttonText: "Give", description: "Updated copy", levels: [] },
        { actorUserId: actor, requestId: crypto.randomUUID() },
      );
      expect(response.status).toBe(200);
      return null;
    });
    expect((await manual()).publicationContext?.publication.id).toBe(p.id);
  });
  it("preserves recorded inclusion after refund but disallows new inclusion and outstanding review", async () => {
    const p = await publication();
    const gift = await manual();
    await stub().setDonationInclusion({
      organizationId: org,
      actorUserId: actor,
      mutation: {
        donationId: gift.id,
        publicationId: p.id,
        expectedRevision: 0,
        requestId: crypto.randomUUID(),
      },
    });
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      state.storage.sql.exec("UPDATE donations SET status='refunded' WHERE id=?", gift.id);
      return null;
    });
    expect(
      (
        await stub().setDonationInclusion({
          organizationId: org,
          actorUserId: actor,
          mutation: {
            donationId: gift.id,
            publicationId: p.id,
            expectedRevision: 1,
            requestId: crypto.randomUUID(),
          },
        })
      ).status,
    ).toBe(409);
    const outstanding = await stub().reviewDonationPublications({
      organizationId: org,
      filter: "review",
    });
    expect(
      donationPublicationReviewResponseSchema.parse(await outstanding.json()).donations.length,
    ).toBe(0);
    const history = await stub().reviewDonationPublications({ organizationId: org, filter: "all" });
    const row = donationPublicationReviewResponseSchema.parse(await history.json()).donations[0];
    expect(row?.includedPublicationId).toBe(p.id);
    expect(row?.status).toBe("refunded");
    const correction = await stub().setDonationInclusion({
      organizationId: org,
      actorUserId: actor,
      mutation: {
        donationId: gift.id,
        publicationId: null,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
      },
    });
    expect(correction.status).toBe(200);
  });
  it("retains the exact queued receipt wording and staff inclusion across a deadline extension", async () => {
    const p = await publication();
    const id = crypto.randomUUID();
    const before = await runInDurableObject<OrganizationStore, string>(
      stub(),
      (_instance, state) => {
        const response = createDonationCheckout(state.storage, {
          action: "create_donation_checkout",
          organizationId: org,
          donationId: id,
          providerSessionId: "fake_receipt_history",
          checkout: {
            amountCents: 2500,
            anonymous: false,
            buyerEmail: "receipt@example.test",
            buyerName: "Receipt Donor",
            checkoutRequestId: crypto.randomUUID(),
            marketingConsent: false,
            tributeName: "",
            tributeNotifyEmail: "",
            tributeType: "none",
            publicationId: p.id,
            publicationRevision: 1,
          },
        });
        expect(response.status).toBe(201);
        return state.storage.sql
          .exec<{ content: string }>(
            "SELECT content_markdown AS content FROM payment_notifications WHERE resource_id=?",
            id,
          )
          .one().content;
      },
    );
    expect(before.includes("no longer guaranteed")).toBe(true);
    await stub().setDonationInclusion({
      organizationId: org,
      actorUserId: actor,
      mutation: {
        donationId: id,
        publicationId: p.id,
        expectedRevision: 0,
        requestId: crypto.randomUUID(),
      },
    });
    await stub().saveDonationPublication({
      organizationId: org,
      actorUserId: actor,
      mutation: {
        ...p,
        recognitionDate: futureDateString({ days: 90 }),
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
      },
    });
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      const after = state.storage.sql
        .exec<{ content: string }>(
          "SELECT content_markdown AS content FROM payment_notifications WHERE resource_id=?",
          id,
        )
        .one().content;
      expect(after === before).toBe(true);
      const row = donationById(state.storage, id);
      if (!row) throw new Error("Missing gift");
      const result = donationResult(row);
      expect(result.publicationContext?.recognitionStatus).toBe("on_time");
      expect(result.includedPublicationId).toBe(p.id);
      return null;
    });
  });
  it("redacts staff inclusion fields on the wire when public checkout is replayed", async () => {
    const p = await publication();
    await runInDurableObject<OrganizationStore, null>(stub(), (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE organization_metadata SET payment_activation_json='{"tickets":true,"donations":true,"dues":true}' WHERE organization_id=?`,
        org,
      );
      return null;
    });
    const payload = {
      amountCents: 2500,
      buyerName: "Public Donor",
      buyerEmail: "public.donor@example.test",
      checkoutRequestId: crypto.randomUUID(),
      publicationId: p.id,
      publicationRevision: p.revision,
    };
    const send = () =>
      exports.default.fetch(
        organizationRequest("alpha.localhost", "/api/public/donations/checkout", undefined, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
    const initial = await send();
    expect(initial.status).toBe(201);
    const checkout = donationCheckoutResponseSchema.parse(await initial.json());
    expect(
      (
        await stub().setDonationInclusion({
          organizationId: org,
          actorUserId: actor,
          mutation: {
            donationId: checkout.donation.id,
            publicationId: p.id,
            expectedRevision: 0,
            requestId: crypto.randomUUID(),
          },
        })
      ).status,
    ).toBe(200);
    const replay = await send();
    expect(replay.status).toBe(201);
    const raw: unknown = await replay.json();
    if (
      !raw ||
      typeof raw !== "object" ||
      !("donation" in raw) ||
      !raw.donation ||
      typeof raw.donation !== "object"
    )
      throw new Error("Missing checkout donation");
    for (const key of [
      "includedPublicationId",
      "includedPublicationName",
      "inclusionRevision",
      "includedArtworkFileId",
    ])
      expect(Object.hasOwn(raw.donation, key)).toBe(false);
  });
});
