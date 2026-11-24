import {
  donationCheckoutResponseSchema,
  publicDonationReceiptResponseSchema,
  publicSponsorArtworkUploadResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { privateOrganizationFileKey } from "../src/storage/privateFiles";
import { reclaimExpiredSponsorUploadClaims } from "../src/storage/sponsorArtworkCleanup";
import {
  api,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(marker: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(24));
  bytes.set(PNG_HEADER, 0);
  bytes.fill(marker, PNG_HEADER.length);
  return bytes;
}

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Public donation sponsor artwork claim isolation and reclamation (SEC-02 & SEC-06)", () => {
  it("prevents associating unrelated private files or another sponsor's upload, preserves retries, isolates tenants, and reclaims only unclaimed expired files", async () => {
    const adminCookie = await signIn();

    // Configure an ad-eligible donation level in Organization Alpha.
    const settingsRes = await jsonWrite(
      "alpha.localhost",
      "/api/organization/donation-settings",
      "PUT",
      {
        buttonText: "Sponsor Our Season",
        description: "Support the choir.",
        levels: [
          {
            amountCents: 25_000,
            artworkInstructions: "Upload a PNG or PDF.",
            benefit: "Full-page concert program ad",
            id: "level-gold-ad",
            includesProgramAd: true,
            label: "Gold Program Sponsor",
          },
        ],
        thankYouMessage: "Thank you for sponsoring our season!",
      },
      adminCookie,
    );
    expect(settingsRes.status).toBe(200);

    // 1. Seed a private score in Organization Alpha (uploaded by admin) and a private file in Organization Bravo.
    const privateScoreFileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const scoreBytes = new TextEncoder().encode("%PDF-1.4 confidential orchestral score");
    const uploadScoreRes = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${privateScoreFileId}`, adminCookie, {
        body: scoreBytes,
        headers: {
          "content-length": String(scoreBytes.byteLength),
          "content-type": "application/pdf",
          "x-file-name": encodeURIComponent("Confidential Score.pdf"),
        },
        method: "PUT",
      }),
    );
    expect(uploadScoreRes.status).toBe(201);

    const bravoFileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const bravoBytes = makePng(0xbb);
    const uploadBravoRes = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/files/${bravoFileId}`, adminCookie, {
        body: bravoBytes,
        headers: {
          "content-length": String(bravoBytes.byteLength),
          "content-type": "image/png",
          "x-file-name": encodeURIComponent("bravo-secret.png"),
        },
        method: "PUT",
      }),
    );
    expect(uploadBravoRes.status).toBe(201);

    // 2. Upload Sponsor A artwork and Sponsor B artwork in Organization Alpha.
    const checkoutRequestIdA = crypto.randomUUID();
    const checkoutRequestIdB = crypto.randomUUID();
    const sponsorAPng = makePng(0x11);
    const sponsorBPng = makePng(0x22);

    const uploadARes = await exports.default.fetch(
      api("tickets.example.test", "/api/public/donations/artwork/upload", undefined, {
        body: sponsorAPng,
        headers: {
          "content-length": String(sponsorAPng.byteLength),
          "content-type": "image/png",
          "x-checkout-request-id": checkoutRequestIdA,
          "x-donation-level-id": "level-gold-ad",
          "x-file-name": encodeURIComponent("sponsor-a.png"),
        },
        method: "POST",
      }),
    );
    expect(uploadARes.status).toBe(201);
    const uploadA = publicSponsorArtworkUploadResponseSchema.parse(await uploadARes.json());

    // Retrying Sponsor A's upload reuses the same fileId without duplicate R2 storage (SEC-06).
    const retryUploadARes = await exports.default.fetch(
      api("tickets.example.test", "/api/public/donations/artwork/upload", undefined, {
        body: sponsorAPng,
        headers: {
          "content-length": String(sponsorAPng.byteLength),
          "content-type": "image/png",
          "x-checkout-request-id": checkoutRequestIdA,
          "x-donation-level-id": "level-gold-ad",
          "x-file-name": encodeURIComponent("sponsor-a.png"),
        },
        method: "POST",
      }),
    );
    expect(retryUploadARes.status).toBe(201);
    const retryUploadA = publicSponsorArtworkUploadResponseSchema.parse(
      await retryUploadARes.json(),
    );
    expect(retryUploadA.fileId).toBe(uploadA.fileId);

    const uploadBRes = await exports.default.fetch(
      api("tickets.example.test", "/api/public/donations/artwork/upload", undefined, {
        body: sponsorBPng,
        headers: {
          "content-length": String(sponsorBPng.byteLength),
          "content-type": "image/png",
          "x-checkout-request-id": checkoutRequestIdB,
          "x-donation-level-id": "level-gold-ad",
          "x-file-name": encodeURIComponent("sponsor-b.png"),
        },
        method: "POST",
      }),
    );
    expect(uploadBRes.status).toBe(201);
    const uploadB = publicSponsorArtworkUploadResponseSchema.parse(await uploadBRes.json());
    expect(uploadB.fileId).not.toBe(uploadA.fileId);

    const baseCheckoutA = {
      amountCents: 25_000,
      anonymous: false,
      buyerEmail: "sponsor.a@example.test",
      buyerName: "Sponsor A",
      checkoutRequestId: checkoutRequestIdA,
      levelId: "level-gold-ad",
      marketingConsent: false,
      sponsorName: "Acme Music",
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none" as const,
    };

    // 3. Checkout A MUST reject the private score, Sponsor B's upload, and Bravo's file.
    for (const forbiddenFileId of [privateScoreFileId, uploadB.fileId, bravoFileId]) {
      const rejected = await exports.default.fetch(
        api("tickets.example.test", "/api/public/donations/checkout", undefined, {
          body: JSON.stringify({ ...baseCheckoutA, artworkFileId: forbiddenFileId }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ code: "invalid_artwork_claim" });
    }

    // 4. Checkout A accepts A's own upload and preserves it on idempotent retry.
    const checkoutARes = await exports.default.fetch(
      api("tickets.example.test", "/api/public/donations/checkout", undefined, {
        body: JSON.stringify({ ...baseCheckoutA, artworkFileId: uploadA.fileId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(checkoutARes.status).toBe(201);
    const checkoutA = donationCheckoutResponseSchema.parse(await checkoutARes.json());

    const retryCheckoutARes = await exports.default.fetch(
      api("tickets.example.test", "/api/public/donations/checkout", undefined, {
        body: JSON.stringify({ ...baseCheckoutA, artworkFileId: uploadA.fileId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(retryCheckoutARes.status).toBe(201);
    const retryCheckoutA = donationCheckoutResponseSchema.parse(await retryCheckoutARes.json());
    expect(retryCheckoutA.donation.id).toBe(checkoutA.donation.id);
    expect(retryCheckoutA.donation.artworkFileId).toBe(uploadA.fileId);

    // 5. Fetch receipt & sponsor token; sponsor download returns ONLY A's accepted file.
    const receiptRes = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/public/donation-receipt?token=${encodeURIComponent(checkoutA.successToken)}`,
      ),
    );
    expect(receiptRes.status).toBe(200);
    const receipt = publicDonationReceiptResponseSchema.parse(await receiptRes.json());
    expect(receipt.sponsorToken).toBeTruthy();
    const sponsorToken = receipt.sponsorToken ?? "";

    const downloadARes = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/public/donations/artwork/${uploadA.fileId}?token=${encodeURIComponent(sponsorToken)}`,
      ),
    );
    expect(downloadARes.status).toBe(200);
    expect(new Uint8Array(await downloadARes.arrayBuffer())).toEqual(sponsorAPng);

    for (const forbiddenFileId of [privateScoreFileId, uploadB.fileId, bravoFileId]) {
      const forbiddenDownload = await exports.default.fetch(
        api(
          "tickets.example.test",
          `/api/public/donations/artwork/${forbiddenFileId}?token=${encodeURIComponent(sponsorToken)}`,
        ),
      );
      expect(forbiddenDownload.status).toBe(404);
    }

    // Negative control: sponsor token from Alpha fails on Bravo's host.
    const crossTenantDownload = await exports.default.fetch(
      api(
        "bravo.localhost",
        `/api/public/donations/artwork/${bravoFileId}?token=${encodeURIComponent(sponsorToken)}`,
      ),
    );
    expect(crossTenantDownload.status).toBe(404);

    // 6. Expiration reclamation reclaims unclaimed B (R2 + SQLite) while leaving claimed A intact.
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE sponsor_upload_claims SET expires_at = '2020-01-01T00:00:00.000Z'",
      );
      return null;
    });

    const cleanup = await reclaimExpiredSponsorUploadClaims(
      { ORGANIZATION_FILES: env.ORGANIZATION_FILES, ORGANIZATION_STORE: stores },
      "organization-alpha",
    );
    expect(cleanup.reclaimedCount).toBe(1);

    // B's R2 object is gone; A's R2 object is preserved and still downloadable.
    await expect(
      env.ORGANIZATION_FILES.head(privateOrganizationFileKey("organization-alpha", uploadB.fileId)),
    ).resolves.toBeNull();
    await expect(
      env.ORGANIZATION_FILES.head(privateOrganizationFileKey("organization-alpha", uploadA.fileId)),
    ).resolves.not.toBeNull();
  });
});
