import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { registerPublicDonationsRoutesWithOptions } from "../routes/publicDonations";
import type { WorkerHonoEnvironment } from "../routes/helpers";
import { issueSignedLink } from "../security/signedLinks";
import { createContactTestAdapter, DEFAULT_CONTACT_TEST_ORG_ID } from "./contactTestkit";
import { organizationSchemaMigrations } from "./schema/migrations";
import {
  claimSponsorArtworkForDonationInStore,
  deleteExpiredSponsorUploadClaimInStore,
  listExpiredUnclaimedSponsorUploadsFromStore,
  releasePendingSponsorArtworkInStore,
  reservePendingSponsorArtworkInStore,
} from "./sponsorArtworkClaims";

const CONTROL_MIGRATION_SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../control/migrations/0001_initial.sql"),
  "utf8",
);

function setupControlD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(CONTROL_MIGRATION_SQL);
  db.prepare(
    `INSERT INTO organizations (id, slug, name, lifecycle_state, durable_object_key, created_at, updated_at)
     VALUES (?, 'alpha', 'Alpha Choir', 'active', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(DEFAULT_CONTACT_TEST_ORG_ID, DEFAULT_CONTACT_TEST_ORG_ID);
  db.prepare(
    `INSERT INTO organization_domains (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
     VALUES ('dom-1', ?, 'alpha.localhost', 'canonical', 'active', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(DEFAULT_CONTACT_TEST_ORG_ID);

  const toBinding = (value: unknown): null | number | bigint | string | Uint8Array => {
    if (
      value === null ||
      value === undefined ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "string" ||
      value instanceof Uint8Array
    ) {
      return value ?? null;
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    throw new Error(`Unsupported SQLite binding type: ${typeof value}`);
  };
  const prepare = (query: string) => {
    let bindings: (null | number | bigint | string | Uint8Array)[] = [];
    const statement = {
      bind(...values: unknown[]) {
        bindings = values.map(toBinding);
        return statement;
      },
      first() {
        const row = db.prepare(query).get(...bindings);
        return Promise.resolve(row ?? null);
      },
      run() {
        const info = db.prepare(query).run(...bindings);
        return Promise.resolve({
          meta: {
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
            rows_written: Number(info.changes),
          },
          results: [],
          success: true,
        });
      },
    };
    return statement;
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only SQLite-backed D1 adapter
  return { prepare } as unknown as D1Database;
}

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePngBytes(totalLength: number): Uint8Array {
  const bytes = new Uint8Array(totalLength);
  bytes.set(PNG_MAGIC.subarray(0, Math.min(totalLength, PNG_MAGIC.length)), 0);
  for (let i = PNG_MAGIC.length; i < totalLength; i += 1) {
    bytes[i] = (i * 17) & 0xff;
  }
  return bytes;
}

function setupSponsorClaimDb() {
  const db = new DatabaseSync(":memory:");
  const adapter = createContactTestAdapter(db);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      adapter.storage.sql.exec(statement);
    }
  }
  adapter.storage.sql.exec(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, timezone, created_at, updated_at, donation_settings_json)
     VALUES (?, 'Test Choir', 'test-choir', 'America/New_York', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?)`,
    DEFAULT_CONTACT_TEST_ORG_ID,
    JSON.stringify({
      buttonText: "Donate",
      description: "Support us",
      levels: [
        {
          amountCents: 25_000,
          artworkInstructions: "Upload PNG or PDF",
          benefit: "Full page ad",
          id: "level-gold",
          includesProgramAd: true,
          label: "Gold Sponsor",
        },
        {
          amountCents: 2_500,
          benefit: "Basic supporter",
          id: "level-friend",
          includesProgramAd: false,
          label: "Friend",
        },
      ],
      thankYouMessage: "Thank you!",
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only structural SQLite adapter
  const storage = adapter.storage as unknown as DurableObjectStorage;
  return { db, storage };
}

function seedReadyFile(storage: DurableObjectStorage, fileId: string, sizeBytes: number): void {
  storage.sql.exec(
    `INSERT INTO private_files
      (id, storage_key, file_name, content_type, size_bytes, status, uploaded_by, request_id, created_at, ready_at)
     VALUES (?, ?, 'ad.png', 'image/png', ?, 'ready', 'public_sponsor', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    fileId,
    `organizations/${DEFAULT_CONTACT_TEST_ORG_ID}/private/${fileId}`,
    sizeBytes,
    crypto.randomUUID(),
  );
}

function createTrackedChunkedByteStream(chunks: readonly Uint8Array[]): {
  readonly cancelled: () => boolean;
  readonly stream: ReadableStream<Uint8Array>;
} {
  let index = 0;
  let wasCancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      cancel() {
        wasCancelled = true;
      },
      pull(controller) {
        const next = chunks[index];
        if (!next) {
          controller.close();
          return;
        }
        index += 1;
        controller.enqueue(next);
      },
    },
    { highWaterMark: 0 },
  );
  return { cancelled: () => wasCancelled, stream };
}

describe("sponsorArtworkClaims store and index plans (SEC-06)", () => {
  it("uses idx_sponsor_upload_claims_unclaimed for quota and expiration queries", () => {
    const { db } = setupSponsorClaimDb();

    const quotaPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS totalBytes
         FROM sponsor_upload_claims
         WHERE donation_id IS NULL AND expires_at > ? AND checkout_request_id <> ?`,
      )
      .all("2026-01-01T00:00:00.000Z", "req-1")
      .map((row) => String(Reflect.get(row, "detail")));
    expect(quotaPlan.join(" ")).toContain("idx_sponsor_upload_claims_unclaimed");

    const expiryPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT file_id AS fileId
         FROM sponsor_upload_claims
         WHERE donation_id IS NULL AND expires_at <= ?
         ORDER BY expires_at ASC
         LIMIT 50`,
      )
      .all("2026-01-01T00:00:00.000Z")
      .map((row) => String(Reflect.get(row, "detail")));
    expect(expiryPlan.join(" ")).toContain("idx_sponsor_upload_claims_unclaimed");
  });

  it("enforces pending quota under concurrent reservations, reuses retries, releases on failure, and expires only unclaimed files", async () => {
    const { storage } = setupSponsorClaimDb();
    const nowIso = "2026-06-01T12:00:00.000Z";
    const checkoutA = crypto.randomUUID();
    const checkoutB = crypto.randomUUID();
    const checkoutC = crypto.randomUUID();
    const fileA = crypto.randomUUID();
    const fileB = crypto.randomUUID();
    const fileC = crypto.randomUUID();

    // Small fixture quota: max 2 files, max 100 bytes total.
    const results = await Promise.all([
      Promise.resolve(
        reservePendingSponsorArtworkInStore(storage, {
          checkoutRequestId: checkoutA,
          contentHash: "hash-a",
          contentType: "image/png",
          fileId: fileA,
          fileName: "ad.png",
          levelId: "level-gold",
          maxPendingBytes: 100,
          maxPendingCount: 2,
          nowIso,
          organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
          sizeBytes: 60,
          ttlMs: 60_000,
        }),
      ),
      Promise.resolve(
        reservePendingSponsorArtworkInStore(storage, {
          checkoutRequestId: checkoutB,
          contentHash: "hash-b",
          contentType: "image/png",
          fileId: fileB,
          fileName: "ad.png",
          levelId: "level-gold",
          maxPendingBytes: 100,
          maxPendingCount: 2,
          nowIso,
          organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
          sizeBytes: 40,
          ttlMs: 60_000,
        }),
      ),
      Promise.resolve(
        reservePendingSponsorArtworkInStore(storage, {
          checkoutRequestId: checkoutC,
          contentHash: "hash-c",
          contentType: "image/png",
          fileId: fileC,
          fileName: "ad.png",
          levelId: "level-gold",
          maxPendingBytes: 100,
          maxPendingCount: 2,
          nowIso,
          organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
          sizeBytes: 10,
          ttlMs: 60_000,
        }),
      ),
    ]);

    expect(results[0]).toMatchObject({ fileId: fileA, ok: true, reused: false });
    expect(results[1]).toMatchObject({ fileId: fileB, ok: true, reused: false });
    expect(results[2]).toEqual({ ok: false, reason: "quota_exceeded" });

    // Mark file A as ready and retry checkout A: must reuse existing file without duplicate storage!
    seedReadyFile(storage, fileA, 60);
    const retryA = reservePendingSponsorArtworkInStore(storage, {
      checkoutRequestId: checkoutA,
      contentHash: "hash-a",
      contentType: "image/png",
      fileId: crypto.randomUUID(),
      fileName: "ad.png",
      levelId: "level-gold",
      maxPendingBytes: 100,
      maxPendingCount: 2,
      nowIso,
      organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
      sizeBytes: 60,
      ttlMs: 60_000,
    });
    expect(retryA).toMatchObject({ fileId: fileA, ok: true, reused: true });

    // Release file B (simulating failed R2 upload) -> frees quota for checkout C.
    expect(
      releasePendingSponsorArtworkInStore(storage, {
        checkoutRequestId: checkoutB,
        fileId: fileB,
        organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
      }),
    ).toEqual({ released: true });

    const reservedC = reservePendingSponsorArtworkInStore(storage, {
      checkoutRequestId: checkoutC,
      contentHash: "hash-c",
      contentType: "image/png",
      fileId: fileC,
      fileName: "ad.png",
      levelId: "level-gold",
      maxPendingBytes: 100,
      maxPendingCount: 2,
      nowIso,
      organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
      sizeBytes: 30,
      ttlMs: 60_000,
    });
    expect(reservedC).toMatchObject({ fileId: fileC, ok: true, reused: false });
    seedReadyFile(storage, fileC, 30);

    // Claim file A for a donation; leave file C unclaimed.
    const donationId = crypto.randomUUID();
    storage.sql.exec(
      `INSERT INTO patrons (id, name, email, total_donated_cents, donation_count, first_donated_at, last_donated_at, created_at, updated_at)
       VALUES ('patron-1', 'Alice', 'alice@example.test', 25000, 1, ?, ?, ?, ?)`,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
    );
    storage.sql.exec(
      `INSERT INTO donations (id, checkout_request_id, status, amount_cents, fee_cents, tribute_type, tribute_name, tribute_notify_email, anonymous, marketing_consent, buyer_name, buyer_email, patron_id, provider_session_id, provider_payment_id, created_at, updated_at, includes_program_ad, sponsor_name, artwork_file_id, artwork_status, artwork_instructions)
       VALUES (?, ?, 'paid', 25000, 0, 'none', '', '', 0, 0, 'Alice', 'alice@example.test', 'patron-1', 'sess-1', 'pay-1', ?, ?, 1, 'Alice', ?, 'received', '')`,
      donationId,
      checkoutA,
      nowIso,
      nowIso,
      fileA,
    );
    expect(
      claimSponsorArtworkForDonationInStore(storage, {
        checkoutRequestId: checkoutA,
        donationId,
        fileId: fileA,
        nowIso,
      }),
    ).toBe(true);

    // After TTL expiration, ONLY unclaimed file C appears for reclamation — claimed file A is untouched!
    const afterExpiryIso = "2026-06-01T12:05:00.000Z";
    const expired = listExpiredUnclaimedSponsorUploadsFromStore(storage, {
      nowIso: afterExpiryIso,
      organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
    });
    expect(expired.fileIds).toEqual([fileC]);

    // Deleting expired claim removes C and refuses to delete claimed A.
    expect(
      deleteExpiredSponsorUploadClaimInStore(storage, {
        fileId: fileA,
        nowIso: afterExpiryIso,
        organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
      }),
    ).toEqual({ deleted: false });
    expect(
      deleteExpiredSponsorUploadClaimInStore(storage, {
        fileId: fileC,
        nowIso: afterExpiryIso,
        organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
      }),
    ).toEqual({ deleted: true });
  });
});

describe("Public donation artwork bounded streaming caps (SEC-05)", () => {
  const SIGNED_LINK_SECRET = "test-signed-link-secret-at-least-32-chars-long";
  const DONATION_ID = "22222222-2222-4222-8222-222222222222";

  function createArtworkRouteTestHarness(maxArtworkBytes: number) {
    const r2PutSpy = vi.fn().mockResolvedValue({ version: "v1" });
    const r2DeleteSpy = vi.fn().mockResolvedValue(undefined);
    const { storage } = setupSponsorClaimDb();

    const stub = {
      commerceRpc(call: { readonly path: string }) {
        if (call.path === "/internal/donations/donation") {
          return Promise.resolve({
            headers: {},
            ok: true as const,
            status: 200,
            value: {
              amountCents: 25_000,
              anonymous: false,
              artworkFileId: null,
              artworkFileName: null,
              artworkInstructions: "Upload PNG",
              artworkStatus: "not_received",
              artworkUploadedAt: null,
              buyerEmail: "sponsor@example.test",
              buyerName: "Sponsor One",
              createdAt: "2026-06-01T12:00:00.000Z",
              expiredAt: null,
              feeCents: 0,
              id: DONATION_ID,
              includedArtworkFileId: null,
              includedPublicationId: null,
              includedPublicationName: null,
              includesProgramAd: true,
              inclusionRevision: 0,
              marketingConsent: false,
              patronId: "44444444-4444-4444-8444-444444444444",
              paymentMethod: "stripe",
              paymentReference: "",
              processorFeeCents: null,
              processorFeeReconciledAt: null,
              providerBalanceTransactionId: null,
              providerPaymentId: "pay-1",
              providerSessionId: "sess-1",
              publicationContext: null,
              refundRequested: false,
              selectedLevelId: "level-gold",
              selectedLevelName: "Gold Sponsor",
              sponsorName: "Sponsor One",
              status: "paid",
              thankYouSentAt: null,
              tributeName: "",
              tributeNotifyEmail: "",
              tributeType: "none",
              updatedAt: "2026-06-01T12:00:00.000Z",
            },
          });
        }
        if (call.path === "/internal/donations/manage") {
          return Promise.resolve({
            headers: {},
            ok: true as const,
            status: 200,
            value: {
              amountCents: 25_000,
              anonymous: false,
              artworkFileId: "33333333-3333-4333-8333-333333333333",
              artworkFileName: "ad.png",
              artworkInstructions: "Upload PNG",
              artworkStatus: "received",
              artworkUploadedAt: "2026-06-01T12:01:00.000Z",
              buyerEmail: "sponsor@example.test",
              buyerName: "Sponsor One",
              createdAt: "2026-06-01T12:00:00.000Z",
              expiredAt: null,
              feeCents: 0,
              id: DONATION_ID,
              includedArtworkFileId: null,
              includedPublicationId: null,
              includedPublicationName: null,
              includesProgramAd: true,
              inclusionRevision: 0,
              marketingConsent: false,
              patronId: "44444444-4444-4444-8444-444444444444",
              paymentMethod: "stripe",
              paymentReference: "",
              processorFeeCents: null,
              processorFeeReconciledAt: null,
              providerBalanceTransactionId: null,
              providerPaymentId: "pay-1",
              providerSessionId: "sess-1",
              publicationContext: null,
              refundRequested: false,
              selectedLevelId: "level-gold",
              selectedLevelName: "Gold Sponsor",
              sponsorName: "Sponsor One",
              status: "paid",
              thankYouSentAt: null,
              tributeName: "",
              tributeNotifyEmail: "",
              tributeType: "none",
              updatedAt: "2026-06-01T12:01:00.000Z",
            },
          });
        }
        throw new Error(`Unexpected commerceRpc: ${call.path}`);
      },
      fileRpc(call: { readonly body?: { readonly fileId?: string }; readonly path: string }) {
        if (call.path === "/internal/files/reserve") {
          const fileId = call.body?.fileId ?? "";
          return Promise.resolve({
            headers: {},
            ok: true as const,
            status: 201,
            value: {
              reserved: true,
              storageKey: `organizations/${DEFAULT_CONTACT_TEST_ORG_ID}/private/${fileId}`,
            },
          });
        }
        if (call.path === "/internal/files/ready") {
          return Promise.resolve({
            headers: {},
            ok: true as const,
            status: 200,
            value: { ready: true, uploadedAt: "2026-06-01T12:00:00.000Z" },
          });
        }
        return Promise.resolve({ headers: {}, ok: true as const, status: 200, value: {} });
      },
      reservePendingSponsorArtwork(
        input: Parameters<typeof reservePendingSponsorArtworkInStore>[1],
      ) {
        return Promise.resolve(reservePendingSponsorArtworkInStore(storage, input));
      },
      releasePendingSponsorArtwork(
        input: Parameters<typeof releasePendingSponsorArtworkInStore>[1],
      ) {
        return Promise.resolve(releasePendingSponsorArtworkInStore(storage, input));
      },
    };

    const app = new Hono<WorkerHonoEnvironment>();
    app.use("*", async (context, next) => {
      context.set("requestId", "11111111-1111-4111-8111-111111111111");
      await next();
    });
    registerPublicDonationsRoutesWithOptions(app, { maxArtworkBytes });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only mock environment
    const env = {
      APP_ENV: "local",
      BETTER_AUTH_SECRET: "a".repeat(40),
      BUILD_VERSION: "test",
      CONTROL_DB: setupControlD1(),
      CUSTOM_DOMAIN_PROVIDER_MODE: "fake",
      EMAIL_EVENTS_DLQ_NAME: "email-dlq",
      EMAIL_EVENTS_QUEUE_NAME: "email-q",
      EXTERNAL_EFFECTS_MODE: "fake",
      JOBS_DLQ_NAME: "jobs-dlq",
      JOBS_QUEUE_NAME: "jobs-q",
      ORGANIZATION_FILES: { delete: r2DeleteSpy, put: r2PutSpy },
      ORGANIZATION_STORE: { getByName: () => stub },
      PLATFORM_EMAIL_FROM: "noreply@example.test",
      PLATFORM_EMAIL_MODE: "capture",
      PRODUCT_BASE_DOMAIN: "localhost",
      ROUTING_CACHE: {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve(),
      },
      SIGNED_LINK_SECRET,
    } as unknown as Env;

    return { app, env, r2PutSpy };
  }

  it("cancels 1-byte-over chunked uploads with zero R2 writes and accepts exact-limit valid PNGs on both handlers", async () => {
    const cap = 32;
    const { app, env, r2PutSpy } = createArtworkRouteTestHarness(cap);

    const exactPng = makePngBytes(cap);
    const overPng = makePngBytes(cap + 1);

    // 1. Pre-checkout handler: chunked 1 byte over cap -> 413, cancelled stream, ZERO R2 writes.
    const preOverStream = createTrackedChunkedByteStream([
      overPng.subarray(0, 16),
      overPng.subarray(16),
    ]);
    const preOverRes = await app.request(
      new Request("https://alpha.localhost/api/public/donations/artwork/upload", {
        body: preOverStream.stream,
        duplex: "half",
        headers: {
          "content-type": "image/png",
          "x-checkout-request-id": crypto.randomUUID(),
          "x-donation-level-id": "level-gold",
          "x-file-name": "ad.png",
        },
        method: "POST",
      } as RequestInit),
      undefined,
      env,
    );
    expect(preOverRes.status).toBe(413);
    expect(preOverStream.cancelled()).toBe(true);
    expect(r2PutSpy).not.toHaveBeenCalled();

    // 2. Pre-checkout handler: exact-limit valid PNG -> 201 and 1 R2 write.
    const preExactStream = createTrackedChunkedByteStream([
      exactPng.subarray(0, 16),
      exactPng.subarray(16),
    ]);
    const preExactRes = await app.request(
      new Request("https://alpha.localhost/api/public/donations/artwork/upload", {
        body: preExactStream.stream,
        duplex: "half",
        headers: {
          "content-type": "image/png",
          "x-checkout-request-id": crypto.randomUUID(),
          "x-donation-level-id": "level-gold",
          "x-file-name": "ad.png",
        },
        method: "POST",
      } as RequestInit),
      undefined,
      env,
    );
    expect(preExactRes.status).toBe(201);
    expect(r2PutSpy).toHaveBeenCalledTimes(1);

    // 3. Sponsor-token handler: chunked 1 byte over cap -> 413, cancelled stream, ZERO new R2 writes.
    r2PutSpy.mockClear();
    const sponsorToken = await issueSignedLink(SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1_000) + 3600,
      issuedAt: Math.floor(Date.now() / 1_000),
      nonce: crypto.randomUUID(),
      organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
      purpose: "donation_sponsor_artwork",
      resourceId: DONATION_ID,
      version: 1,
    });

    const postOverStream = createTrackedChunkedByteStream([
      overPng.subarray(0, 16),
      overPng.subarray(16),
    ]);
    const postOverRes = await app.request(
      new Request(
        `https://alpha.localhost/api/public/donations/sponsor-artwork?token=${encodeURIComponent(sponsorToken)}`,
        {
          body: postOverStream.stream,
          duplex: "half",
          headers: {
            "content-type": "image/png",
            "x-file-name": "ad.png",
          },
          method: "POST",
        } as RequestInit,
      ),
      undefined,
      env,
    );
    expect(postOverRes.status).toBe(413);
    expect(postOverStream.cancelled()).toBe(true);
    expect(r2PutSpy).not.toHaveBeenCalled();

    // 4. Sponsor-token handler: exact-limit valid PNG -> 200 and 1 R2 write.
    const postExactStream = createTrackedChunkedByteStream([
      exactPng.subarray(0, 16),
      exactPng.subarray(16),
    ]);
    const postExactRes = await app.request(
      new Request(
        `https://alpha.localhost/api/public/donations/sponsor-artwork?token=${encodeURIComponent(sponsorToken)}`,
        {
          body: postExactStream.stream,
          duplex: "half",
          headers: {
            "content-type": "image/png",
            "x-file-name": "ad.png",
          },
          method: "POST",
        } as RequestInit,
      ),
      undefined,
      env,
    );
    expect(postExactRes.status).toBe(200);
    expect(r2PutSpy).toHaveBeenCalledTimes(1);
  });
});
