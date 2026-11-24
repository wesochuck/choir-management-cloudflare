import { memberCanAccessScoreFile } from "@choir/domain";
import { websiteContentImageIsReferenced } from "../publicWebsiteStore";
import {
  privateFileIdSchema,
  privateFileReclamationSchema,
  privateFileReservationSchema,
  privateFileTransitionSchema,
  privateOrganizationUploadKey,
} from "../../storage/privateFiles";

import { privateFileReclaimResponseSchema } from "./storeShared";
import type { OrganizationIdentityRow, PrivateFileMetadataRow } from "./storeShared";

export async function reservePrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileReservationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file" }, { status: 400 });
  }
  const organization = storage.sql
    .exec<OrganizationIdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const storageKey = privateOrganizationUploadKey(
    parsed.data.organizationId,
    parsed.data.fileId,
    parsed.data.fileName,
    parsed.data.contentType,
  );
  try {
    storage.sql.exec(
      `INSERT INTO private_files
        (id, storage_key, file_name, content_type, size_bytes, status,
         uploaded_by, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      parsed.data.fileId,
      storageKey,
      parsed.data.fileName,
      parsed.data.contentType,
      parsed.data.sizeBytes,
      parsed.data.actorUserId,
      parsed.data.requestId,
      new Date().toISOString(),
    );
    return Response.json({ reserved: true, storageKey });
  } catch {
    return Response.json({ code: "private_file_conflict" }, { status: 409 });
  }
}

export async function finalizePrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  const uploadedAt = new Date().toISOString();
  const ready = storage.transactionSync(() => {
    const result = storage.sql.exec(
      `UPDATE private_files SET status = 'ready', ready_at = ?, r2_version = ?
       WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
         AND status = 'pending'`,
      uploadedAt,
      parsed.data.r2Version ?? null,
      parsed.data.fileId,
      parsed.data.storageKey,
      parsed.data.actorUserId,
      parsed.data.requestId,
    );
    if (result.rowsWritten !== 1) {
      return false;
    }
    storage.sql.exec(
      `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'organization.file.uploaded',
           'private_file', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.fileId,
      parsed.data.requestId,
      JSON.stringify({ fileId: parsed.data.fileId, storageKey: parsed.data.storageKey }),
      uploadedAt,
    );
    return true;
  });
  return ready
    ? Response.json({ ready: true, uploadedAt })
    : Response.json({ code: "private_file_not_reserved" }, { status: 409 });
}

export async function abortPrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  storage.sql.exec(
    `DELETE FROM private_files
     WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
       AND status = 'pending'`,
    parsed.data.fileId,
    parsed.data.storageKey,
    parsed.data.actorUserId,
    parsed.data.requestId,
  );
  return Response.json({ aborted: true });
}

export function privateFileIsReferenced(storage: DurableObjectStorage, fileId: string): boolean {
  const profileReference = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM profiles WHERE photo_file_id = ?",
      fileId,
    )
    .one().count;
  if (profileReference > 0) return true;
  const musicReference = storage.sql
    .exec<{ readonly trackFileIdsJson: string }>(
      "SELECT track_file_ids_json AS trackFileIdsJson FROM music_pieces",
    )
    .toArray()
    .some(({ trackFileIdsJson }) => {
      try {
        const value: unknown = JSON.parse(trackFileIdsJson);
        return (
          typeof value === "object" &&
          value !== null &&
          Object.values(value).some((candidate) => candidate === fileId)
        );
      } catch {
        return false;
      }
    });
  if (musicReference) return true;
  const musicScoreReference = storage.sql
    .exec<{ readonly scoreFileIdsJson: string }>(
      "SELECT score_file_ids_json AS scoreFileIdsJson FROM music_pieces",
    )
    .toArray()
    .some(({ scoreFileIdsJson }) => {
      try {
        const value: unknown = JSON.parse(scoreFileIdsJson);
        return (
          typeof value === "object" &&
          value !== null &&
          Object.values(value).some((candidate) => candidate === fileId)
        );
      } catch {
        return false;
      }
    });
  if (musicScoreReference) return true;
  const publicWebsiteReference = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      `SELECT
        (SELECT COUNT(*) FROM public_website_settings
         WHERE hero_file_id = ? OR logo_file_id = ?) +
        (SELECT COUNT(*) FROM events WHERE public_graphic_file_id = ?) +
        (SELECT COUNT(*) FROM ticket_bundles WHERE public_graphic_file_id = ?) +
        (SELECT COUNT(*) FROM public_website_documents WHERE file_id = ?) AS count`,
      fileId,
      fileId,
      fileId,
      fileId,
      fileId,
    )
    .one().count;
  if (publicWebsiteReference > 0 || websiteContentImageIsReferenced(storage, fileId)) return true;
  return (
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT COUNT(*) AS count FROM organization_resources WHERE file_id = ?",
        fileId,
      )
      .one().count > 0
  );
}

export async function claimPrivateFileReclamation(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileReclamationSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ code: "invalid_private_file_reclamation" }, { status: 400 });
  const organization = storage.sql
    .exec<OrganizationIdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const storageKey = storage.sql
    .exec<{ readonly storageKey: string }>(
      `SELECT storage_key AS storageKey FROM private_files
       WHERE id = ? AND status = 'ready' LIMIT 1`,
      parsed.data.fileId,
    )
    .toArray()
    .at(0)?.storageKey;
  if (!storageKey) {
    return Response.json({ code: "private_file_in_use_or_missing" }, { status: 409 });
  }
  const claimed = storage.transactionSync(() => {
    if (privateFileIsReferenced(storage, parsed.data.fileId)) return false;
    return (
      storage.sql.exec(
        `UPDATE private_files SET status = 'pending', uploaded_by = ?, request_id = ?
       WHERE id = ? AND storage_key = ? AND status = 'ready'`,
        parsed.data.actorUserId,
        parsed.data.requestId,
        parsed.data.fileId,
        storageKey,
      ).rowsWritten === 1
    );
  });
  return claimed
    ? Response.json({ claimed: true, storageKey })
    : Response.json({ code: "private_file_in_use_or_missing" }, { status: 409 });
}

export async function finishPrivateFileReclamation(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  const reclaimed = storage.transactionSync(() => {
    const deleted =
      storage.sql
        .exec(
          `DELETE FROM private_files WHERE id = ? AND storage_key = ? AND uploaded_by = ?
       AND request_id = ? AND status = 'pending' RETURNING id`,
          parsed.data.fileId,
          parsed.data.storageKey,
          parsed.data.actorUserId,
          parsed.data.requestId,
        )
        .toArray().length === 1;
    if (!deleted) return false;
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'organization.file.reclaimed',
         'private_file', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.fileId,
      parsed.data.requestId,
      JSON.stringify({ fileId: parsed.data.fileId, storageKey: parsed.data.storageKey }),
      new Date().toISOString(),
    );
    return true;
  });
  return reclaimed
    ? Response.json(privateFileReclaimResponseSchema.parse({ reclaimed: true }))
    : Response.json({ code: "private_file_reclaim_not_claimed" }, { status: 409 });
}

export async function abortPrivateFileReclamation(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  storage.sql.exec(
    `UPDATE private_files SET status = 'ready'
     WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
       AND status = 'pending'`,
    parsed.data.fileId,
    parsed.data.storageKey,
    parsed.data.actorUserId,
    parsed.data.requestId,
  );
  return Response.json({ aborted: true });
}

export function getPrivateFileMetadata(
  storage: DurableObjectStorage,
  encodedFileId: string,
): Response {
  const fileId = privateFileIdSchema.safeParse(decodeURIComponent(encodedFileId));
  if (!fileId.success) {
    return Response.json({ code: "private_file_not_found" }, { status: 404 });
  }
  const metadata = storage.sql
    .exec<PrivateFileMetadataRow>(
      `SELECT id, storage_key AS storageKey, file_name AS fileName,
        content_type AS contentType, size_bytes AS sizeBytes, ready_at AS uploadedAt
       FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1`,
      fileId.data,
    )
    .toArray()
    .at(0);
  return metadata
    ? Response.json(metadata)
    : Response.json({ code: "private_file_not_found" }, { status: 404 });
}

function parseStringRecord(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) {
        record[key] = value;
      }
    }
    return record;
  } catch {
    return {};
  }
}

function parseSetListPieceIds(json: string): readonly { readonly pieceId?: string | undefined }[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const items: { readonly pieceId?: string | undefined }[] = [];
    for (const item of parsed) {
      if (typeof item === "object" && item !== null && "pieceId" in item) {
        const pieceId: unknown = Reflect.get(item, "pieceId");
        if (typeof pieceId === "string" && pieceId.length > 0) {
          items.push({ pieceId });
        }
      }
    }
    return items;
  } catch {
    return [];
  }
}

function isFileReferencedAsMemberAccessibleAsset(
  storage: DurableObjectStorage,
  fileId: string,
): boolean {
  const directRefCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      `SELECT
        (SELECT COUNT(*) FROM organization_resources WHERE file_id = ?) +
        (SELECT COUNT(*) FROM profiles WHERE photo_file_id = ?) +
        (SELECT COUNT(*) FROM organization_metadata WHERE logo_file_id = ?) +
        (SELECT COUNT(*) FROM public_website_settings WHERE hero_file_id = ? OR logo_file_id = ?) +
        (SELECT COUNT(*) FROM public_website_documents WHERE file_id = ?) +
        (SELECT COUNT(*) FROM events WHERE public_graphic_file_id = ?) +
        (SELECT COUNT(*) FROM ticket_bundles WHERE public_graphic_file_id = ?) AS count`,
      fileId,
      fileId,
      fileId,
      fileId,
      fileId,
      fileId,
      fileId,
      fileId,
    )
    .one().count;
  if (directRefCount > 0 || websiteContentImageIsReferenced(storage, fileId)) {
    return true;
  }
  return storage.sql
    .exec<{ readonly trackFileIdsJson: string }>(
      "SELECT track_file_ids_json AS trackFileIdsJson FROM music_pieces",
    )
    .toArray()
    .some(({ trackFileIdsJson }) =>
      Object.values(parseStringRecord(trackFileIdsJson)).includes(fileId),
    );
}

function isFileReferencedAsSponsorArtwork(storage: DurableObjectStorage, fileId: string): boolean {
  return (
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        `SELECT
          (SELECT COUNT(*) FROM donations WHERE artwork_file_id = ?) +
          (SELECT COUNT(*) FROM donation_publication_inclusions WHERE artwork_file_id = ?) AS count`,
        fileId,
        fileId,
      )
      .one().count > 0
  );
}

export function canMemberReadPrivateFileFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly actorUserId: string;
    readonly fileId: string;
    readonly organizationId: string;
  },
): boolean {
  const parsedFileId = privateFileIdSchema.safeParse(input.fileId);
  if (!parsedFileId.success) return false;
  const organization = storage.sql
    .exec<OrganizationIdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (organization?.organizationId !== input.organizationId) return false;

  const fileRow = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly uploadedBy: string }>(
      "SELECT uploaded_by AS uploadedBy FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1",
      parsedFileId.data,
    )
    .toArray()
    .at(0);
  if (!fileRow) return false;

  if (isFileReferencedAsMemberAccessibleAsset(storage, parsedFileId.data)) {
    return true;
  }

  const scorePieces = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly id: string;
      readonly parentId: string | null;
      readonly scoreFileIdsJson: string;
    }>(
      "SELECT id, parent_id AS parentId, score_file_ids_json AS scoreFileIdsJson FROM music_pieces",
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      parentId: row.parentId,
      scoreFileIds: parseStringRecord(row.scoreFileIdsJson),
    }));

  const isScoreFile = scorePieces.some((piece) =>
    Object.values(piece.scoreFileIds).includes(parsedFileId.data),
  );
  if (isScoreFile) {
    const activeEvents = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly id: string;
        readonly isCanceled: number;
        readonly parentPerformanceId: string | null;
        readonly setListApproved: number;
        readonly setListJson: string;
        readonly type: string;
      }>(
        `SELECT id, type, parent_performance_id AS parentPerformanceId,
          set_list_json AS setListJson, set_list_approved AS setListApproved,
          is_canceled AS isCanceled
         FROM events WHERE is_archived = 0`,
      )
      .toArray()
      .map((event) => ({
        id: event.id,
        isCanceled: event.isCanceled === 1,
        parentPerformanceId: event.parentPerformanceId,
        setList: parseSetListPieceIds(event.setListJson),
        setListApproved: event.setListApproved === 1,
        type: event.type,
      }));
    return memberCanAccessScoreFile(parsedFileId.data, scorePieces, activeEvents);
  }

  if (isFileReferencedAsSponsorArtwork(storage, parsedFileId.data)) {
    return false;
  }

  return fileRow.uploadedBy === input.actorUserId;
}
