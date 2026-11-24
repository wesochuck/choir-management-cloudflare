import { z } from "zod";

import { storedDonationSettings } from "./donationSettingsStore";

export const DEFAULT_SPONSOR_UPLOAD_CLAIM_TTL_MS = 60 * 60 * 1_000;
export const DEFAULT_MAX_PENDING_SPONSOR_UPLOAD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MAX_PENDING_SPONSOR_UPLOAD_COUNT = 20;

const reservePendingSponsorArtworkSchema = z.object({
  checkoutRequestId: z.uuid(),
  contentHash: z.string().max(128).optional(),
  contentType: z.string().min(1).max(128),
  fileId: z.uuid(),
  fileName: z.string().min(1).max(255),
  levelId: z.string().min(1).max(128),
  maxPendingBytes: z.number().int().positive().optional(),
  maxPendingCount: z.number().int().positive().optional(),
  nowIso: z.iso.datetime().optional(),
  organizationId: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive(),
  ttlMs: z.number().int().positive().optional(),
});

export type ReservePendingSponsorArtworkInput = z.infer<typeof reservePendingSponsorArtworkSchema>;

export type ReservePendingSponsorArtworkResult =
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_request"
        | "level_not_eligible_for_ad"
        | "organization_identity_conflict"
        | "quota_exceeded";
    }
  | {
      readonly contentType: string;
      readonly fileId: string;
      readonly fileName: string;
      readonly ok: true;
      readonly reused: true;
      readonly sizeBytes: number;
      readonly supersededFileIds: readonly string[];
    }
  | {
      readonly fileId: string;
      readonly ok: true;
      readonly reused: false;
      readonly supersededFileIds: readonly string[];
    };

function organizationMatches(storage: DurableObjectStorage, organizationId: string): boolean {
  const stored = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  return stored === organizationId;
}

interface ExistingClaimRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentHash: string;
  readonly contentType: string | null;
  readonly fileId: string;
  readonly fileName: string | null;
  readonly fileStatus: string | null;
  readonly levelId: string;
  readonly sizeBytes: number;
}

export function reservePendingSponsorArtworkInStore(
  storage: DurableObjectStorage,
  rawInput: ReservePendingSponsorArtworkInput,
): ReservePendingSponsorArtworkResult {
  const parsed = reservePendingSponsorArtworkSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_request" };
  }
  const input = parsed.data;
  if (!organizationMatches(storage, input.organizationId)) {
    return { ok: false, reason: "organization_identity_conflict" };
  }

  const settings = storedDonationSettings(storage);
  const level = settings.levels.find((candidate) => candidate.id === input.levelId);
  if (!level?.includesProgramAd) {
    return { ok: false, reason: "level_not_eligible_for_ad" };
  }

  const nowIso = input.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const ttlMs = input.ttlMs ?? DEFAULT_SPONSOR_UPLOAD_CLAIM_TTL_MS;
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const maxPendingBytes = input.maxPendingBytes ?? DEFAULT_MAX_PENDING_SPONSOR_UPLOAD_BYTES;
  const maxPendingCount = input.maxPendingCount ?? DEFAULT_MAX_PENDING_SPONSOR_UPLOAD_COUNT;
  const contentHash = input.contentHash ?? "";

  return storage.transactionSync((): ReservePendingSponsorArtworkResult => {
    const existingForCheckout = storage.sql
      .exec<ExistingClaimRow>(
        `SELECT
          c.file_id AS fileId,
          c.level_id AS levelId,
          c.size_bytes AS sizeBytes,
          c.content_hash AS contentHash,
          pf.file_name AS fileName,
          pf.content_type AS contentType,
          pf.status AS fileStatus
         FROM sponsor_upload_claims c
         LEFT JOIN private_files pf ON pf.id = c.file_id
         WHERE c.donation_id IS NULL
           AND c.expires_at > ?
           AND c.checkout_request_id = ?`,
        nowIso,
        input.checkoutRequestId,
      )
      .toArray();

    const reusable = existingForCheckout.find(
      (row) =>
        row.fileStatus === "ready" &&
        row.levelId === input.levelId &&
        row.sizeBytes === input.sizeBytes &&
        row.fileName === input.fileName &&
        row.contentType === input.contentType &&
        (contentHash === "" || row.contentHash === "" || row.contentHash === contentHash),
    );
    if (reusable?.fileName && reusable.contentType) {
      storage.sql.exec(
        "UPDATE sponsor_upload_claims SET expires_at = ? WHERE file_id = ? AND donation_id IS NULL",
        expiresAt,
        reusable.fileId,
      );
      return {
        contentType: reusable.contentType,
        fileId: reusable.fileId,
        fileName: reusable.fileName,
        ok: true,
        reused: true,
        sizeBytes: reusable.sizeBytes,
        supersededFileIds: [],
      };
    }

    const activeTotals = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly count: number;
        readonly totalBytes: number;
      }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS totalBytes
         FROM sponsor_upload_claims
         WHERE donation_id IS NULL
           AND expires_at > ?
           AND checkout_request_id <> ?`,
        nowIso,
        input.checkoutRequestId,
      )
      .one();

    if (
      activeTotals.count + 1 > maxPendingCount ||
      activeTotals.totalBytes + input.sizeBytes > maxPendingBytes
    ) {
      return { ok: false, reason: "quota_exceeded" };
    }

    const supersededFileIds = existingForCheckout.map((row) => row.fileId);
    if (supersededFileIds.length > 0) {
      storage.sql.exec(
        `DELETE FROM sponsor_upload_claims
         WHERE donation_id IS NULL AND checkout_request_id = ?`,
        input.checkoutRequestId,
      );
    }

    storage.sql.exec(
      `INSERT INTO sponsor_upload_claims
        (file_id, checkout_request_id, level_id, size_bytes, content_hash, donation_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      input.fileId,
      input.checkoutRequestId,
      input.levelId,
      input.sizeBytes,
      contentHash,
      nowIso,
      expiresAt,
    );

    return {
      fileId: input.fileId,
      ok: true,
      reused: false,
      supersededFileIds,
    };
  });
}

export function releasePendingSponsorArtworkInStore(
  storage: DurableObjectStorage,
  input: {
    readonly checkoutRequestId: string;
    readonly fileId: string;
    readonly organizationId: string;
  },
): { readonly released: boolean } {
  if (!organizationMatches(storage, input.organizationId)) {
    return { released: false };
  }
  const deleted = storage.sql
    .exec<{ readonly fileId: string }>(
      `DELETE FROM sponsor_upload_claims
       WHERE file_id = ? AND checkout_request_id = ? AND donation_id IS NULL
       RETURNING file_id AS fileId`,
      input.fileId,
      input.checkoutRequestId,
    )
    .toArray();
  return { released: deleted.length > 0 };
}

export function claimSponsorArtworkForDonationInStore(
  storage: DurableObjectStorage,
  input: {
    readonly checkoutRequestId: string;
    readonly donationId: string;
    readonly fileId: string;
    readonly nowIso: string;
  },
): boolean {
  const readyFile = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1",
      input.fileId,
    )
    .toArray()
    .at(0);
  if (!readyFile) return false;

  const updated = storage.sql
    .exec<{ readonly fileId: string }>(
      `UPDATE sponsor_upload_claims
       SET donation_id = ?
       WHERE file_id = ?
         AND checkout_request_id = ?
         AND expires_at > ?
         AND (donation_id IS NULL OR donation_id = ?)
       RETURNING file_id AS fileId`,
      input.donationId,
      input.fileId,
      input.checkoutRequestId,
      input.nowIso,
      input.donationId,
    )
    .toArray();
  return updated.length === 1;
}

export function listExpiredUnclaimedSponsorUploadsFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly legacyCutoffIso?: string | undefined;
    readonly limit?: number | undefined;
    readonly nowIso?: string | undefined;
    readonly organizationId: string;
  },
): { readonly fileIds: readonly string[] } {
  if (!organizationMatches(storage, input.organizationId)) {
    return { fileIds: [] };
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  const claimFileIds = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly fileId: string }>(
      `SELECT file_id AS fileId
       FROM sponsor_upload_claims
       WHERE donation_id IS NULL AND expires_at <= ?
       ORDER BY expires_at ASC
       LIMIT ?`,
      nowIso,
      limit,
    )
    .toArray()
    .map((row) => row.fileId);

  const fileIds = new Set<string>(claimFileIds);
  if (input.legacyCutoffIso && fileIds.size < limit) {
    const remaining = limit - fileIds.size;
    const legacyFileIds = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        `SELECT id FROM private_files
         WHERE uploaded_by = 'public_sponsor'
           AND created_at < ?
           AND NOT EXISTS (SELECT 1 FROM donations WHERE artwork_file_id = private_files.id)
           AND NOT EXISTS (SELECT 1 FROM donation_publication_inclusions WHERE artwork_file_id = private_files.id)
           AND NOT EXISTS (
             SELECT 1 FROM sponsor_upload_claims
             WHERE file_id = private_files.id AND (donation_id IS NOT NULL OR expires_at > ?)
           )
         LIMIT ?`,
        input.legacyCutoffIso,
        nowIso,
        remaining,
      )
      .toArray()
      .map((row) => row.id);
    for (const id of legacyFileIds) {
      fileIds.add(id);
    }
  }

  return { fileIds: [...fileIds] };
}

export function deleteExpiredSponsorUploadClaimInStore(
  storage: DurableObjectStorage,
  input: {
    readonly fileId: string;
    readonly nowIso?: string | undefined;
    readonly organizationId: string;
  },
): { readonly deleted: boolean } {
  if (!organizationMatches(storage, input.organizationId)) {
    return { deleted: false };
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const deleted = storage.sql
    .exec<{ readonly fileId: string }>(
      `DELETE FROM sponsor_upload_claims
       WHERE file_id = ? AND donation_id IS NULL AND expires_at <= ?
       RETURNING file_id AS fileId`,
      input.fileId,
      nowIso,
    )
    .toArray();
  return { deleted: deleted.length > 0 };
}
