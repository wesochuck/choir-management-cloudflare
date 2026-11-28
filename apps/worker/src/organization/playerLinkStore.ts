import { practiceShareSlug } from "@choir/domain";
import { z } from "zod";

import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";

const identitySchema = z.object({ organizationId: z.string().min(1).max(128) });

const ensureRequestSchema = z.object({
  action: z.literal("ensure"),
  eventId: z.uuid(),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
  rotate: z.boolean().default(false),
  nonce: z.string().min(16).max(128),
});

interface LinkRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly nonce: string;
  readonly updatedAt: string;
}

function identityMatches(storage: DurableObjectStorage, organizationId: string | null): boolean {
  const value = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return identitySchema.safeParse(value).success && value?.organizationId === organizationId;
}

function readLink(storage: DurableObjectStorage, eventId: string): LinkRow | undefined {
  return storage.sql
    .exec<LinkRow>(
      `SELECT event_id AS eventId, nonce, issued_at AS issuedAt,
         expires_at AS expiresAt, updated_at AS updatedAt
       FROM practice_player_links WHERE event_id = ? LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
}

function hasPublishedTrack(storage: DurableObjectStorage, eventId: string): boolean {
  return (
    storage.sql
      .exec(
        `SELECT 1 FROM events e, json_each(e.set_list_json) setItem
         JOIN music_pieces piece ON piece.id = json_extract(setItem.value, '$.pieceId')
           OR piece.parent_id = json_extract(setItem.value, '$.pieceId')
         WHERE e.id = ? AND EXISTS (SELECT 1 FROM json_each(piece.track_file_ids_json)) LIMIT 1`,
        eventId,
      )
      .toArray().length > 0
  );
}

export function savePracticeShareInStore(
  storage: DurableObjectStorage,
  input: {
    readonly organizationId: string;
    readonly eventId: string;
    readonly nonce: string;
    readonly digest: string;
  },
): string | null {
  if (!identityMatches(storage, input.organizationId)) return null;
  const event = storage.sql
    .exec<{ readonly title: string }>("SELECT title FROM events WHERE id = ?", input.eventId)
    .toArray()
    .at(0);
  if (!event) return null;
  return (
    storage.sql
      .exec<{ readonly slug: string }>(
        `UPDATE practice_player_links
         SET share_slug = COALESCE(share_slug, ?), share_code_digest = ?
         WHERE event_id = ? AND nonce = ? AND expires_at > ?
         RETURNING share_slug AS slug`,
        practiceShareSlug(event.title),
        input.digest,
        input.eventId,
        input.nonce,
        Math.floor(Date.now() / 1_000),
      )
      .toArray()
      .at(0)?.slug ?? null
  );
}

export function readPracticeShareInStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string; readonly slug: string; readonly digest: string },
): LinkRow | null {
  if (!identityMatches(storage, input.organizationId)) return null;
  const link = storage.sql
    .exec<LinkRow>(
      `SELECT l.event_id AS eventId, l.nonce, l.issued_at AS issuedAt,
         l.expires_at AS expiresAt, l.updated_at AS updatedAt
       FROM practice_player_links l JOIN events e ON e.id = l.event_id
       WHERE l.share_code_digest = ? AND l.share_slug = ? AND l.expires_at > ?
         AND e.is_archived = 0 AND e.is_canceled = 0 AND e.set_list_approved = 1`,
      input.digest,
      input.slug,
      Math.floor(Date.now() / 1_000),
    )
    .toArray()
    .at(0);
  return link && hasPublishedTrack(storage, link.eventId) ? link : null;
}

export function readPracticePlayerLinkFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly eventId: string | null;
    readonly nonce: string | null;
    readonly organizationId: string | null;
  },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "practice_link_not_found" }, { status: 404 });
  }
  const link = readLink(storage, eventId.data);
  if (!link) {
    return Response.json({ code: "practice_link_not_found" }, { status: 404 });
  }
  if (link.nonce !== input.nonce || link.expiresAt <= Math.floor(Date.now() / 1_000)) {
    return Response.json({ code: "practice_link_revoked" }, { status: 404 });
  }
  const event = storage.sql
    .exec<{
      readonly isArchived: number;
      readonly isCanceled: number;
      readonly setListApproved: number;
    }>(
      `SELECT is_archived AS isArchived, is_canceled AS isCanceled,
         set_list_approved AS setListApproved
       FROM events WHERE id = ? LIMIT 1`,
      eventId.data,
    )
    .toArray()
    .at(0);
  if (
    !event ||
    event.isArchived === 1 ||
    event.isCanceled === 1 ||
    event.setListApproved !== 1 ||
    !hasPublishedTrack(storage, eventId.data)
  ) {
    return Response.json({ code: "practice_link_unavailable" }, { status: 404 });
  }
  return Response.json(link);
}

export async function ensurePracticePlayerLinkInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = ensureRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "practice_link_not_found" }, { status: 404 });
  }
  const event = storage.sql
    .exec<{
      readonly isArchived: number;
      readonly isCanceled: number;
      readonly setListApproved: number;
    }>(
      `SELECT is_archived AS isArchived, is_canceled AS isCanceled,
         set_list_approved AS setListApproved
       FROM events WHERE id = ? LIMIT 1`,
      parsed.data.eventId,
    )
    .toArray()
    .at(0);
  if (
    !event ||
    event.isArchived === 1 ||
    event.isCanceled === 1 ||
    event.setListApproved !== 1 ||
    !hasPublishedTrack(storage, parsed.data.eventId)
  ) {
    return Response.json({ code: "practice_not_published" }, { status: 409 });
  }
  const existing = readLink(storage, parsed.data.eventId);
  if (existing && !parsed.data.rotate && existing.expiresAt > parsed.data.issuedAt) {
    return Response.json(existing);
  }
  const link: LinkRow = {
    eventId: parsed.data.eventId,
    expiresAt: parsed.data.expiresAt,
    issuedAt: parsed.data.issuedAt,
    nonce: parsed.data.nonce,
    updatedAt: new Date().toISOString(),
  };
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO practice_player_links (event_id, nonce, issued_at, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET nonce = excluded.nonce,
         issued_at = excluded.issued_at, expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      link.eventId,
      link.nonce,
      link.issuedAt,
      link.expiresAt,
      link.updatedAt,
    );
  });
  return Response.json(link);
}

export function readPracticePlayerLinkStatusFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly eventId: string | null;
    readonly organizationId: string | null;
  },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "practice_link_not_found" }, { status: 404 });
  }
  const link = readLink(storage, eventId.data);
  if (!link) {
    return Response.json({
      active: false,
      eventId: eventId.data,
      expiresAt: null,
      issuedAt: null,
      status: "none",
    });
  }
  const now = Math.floor(Date.now() / 1_000);
  const isExpired = link.expiresAt <= now;
  return Response.json({
    active: !isExpired,
    eventId: link.eventId,
    expiresAt: link.expiresAt,
    issuedAt: link.issuedAt,
    status: isExpired ? "expired" : "active",
  });
}
