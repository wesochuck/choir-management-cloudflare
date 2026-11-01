import type { SqlStorageValue } from "@cloudflare/workers-types";
import type {
  NotificationFilter,
  NotificationKind,
  OrganizationNotification,
  OrganizationNotificationsResponse,
} from "@choir/contracts";

export interface NotificationInboxStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): { toArray(): T[] };
  };
}

export interface InsertNotificationReceiptInput {
  readonly body: string;
  readonly destinationPath: string | null;
  readonly kind: NotificationKind;
  readonly now?: string;
  readonly originalOccurredAt: string;
  readonly recipientProfileId: string;
  readonly sourceKey: string;
  readonly title: string;
}

export const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

interface StoredNotificationReceiptRow extends Record<string, SqlStorageValue> {
  readonly body: string;
  readonly createdAt: string;
  readonly destinationPath: string | null;
  readonly expiresAt: string;
  readonly id: string;
  readonly kind: NotificationKind;
  readonly readAt: string | null;
  readonly title: string;
}

function parseCursor(cursor: string): { readonly createdAt: string; readonly id: string } | null {
  try {
    const raw = cursor.includes(":") ? cursor : atob(cursor);
    const separatorIndex = raw.indexOf(":");
    if (separatorIndex <= 0) return null;
    const createdAt = raw.slice(0, separatorIndex);
    const id = raw.slice(separatorIndex + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return `${createdAt}:${id}`;
}

export function insertNotificationReceipt(
  storage: NotificationInboxStorage,
  input: InsertNotificationReceiptInput,
): boolean {
  const now = input.now ?? new Date().toISOString();
  const meta = storage.sql
    .exec<{ readonly inboxStartAt: string | null }>(
      "SELECT inbox_start_at AS inboxStartAt FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (meta?.inboxStartAt && input.originalOccurredAt < meta.inboxStartAt) {
    return false;
  }

  const occurredTime = new Date(input.originalOccurredAt).getTime();
  if (!Number.isFinite(occurredTime)) return false;
  const expiresAt = new Date(occurredTime + NOTIFICATION_RETENTION_MS).toISOString();
  if (new Date(now).getTime() > new Date(expiresAt).getTime()) {
    return false;
  }

  const id = crypto.randomUUID();
  storage.sql.exec(
    `INSERT OR IGNORE INTO notification_receipts
      (id, recipient_profile_id, kind, source_key, title, body, destination_path, created_at, expires_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id,
    input.recipientProfileId,
    input.kind,
    input.sourceKey,
    input.title,
    input.body,
    input.destinationPath,
    input.originalOccurredAt,
    expiresAt,
  );
  return true;
}

export function listNotificationReceipts(
  storage: NotificationInboxStorage,
  input: {
    readonly cursor?: string | null | undefined;
    readonly filter?: NotificationFilter | undefined;
    readonly limit?: number | undefined;
    readonly now?: Date | undefined;
    readonly profileId: string;
  },
): Omit<OrganizationNotificationsResponse, "requestId"> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = Math.max(1, Math.min(input.limit ?? 25, 50));
  const filter = input.filter ?? "all";

  const conditions: string[] = ["recipient_profile_id = ?", "expires_at > ?"];
  const bindings: unknown[] = [input.profileId, nowIso];

  if (filter === "unread") {
    conditions.push("read_at IS NULL");
  } else if (filter === "audition" || filter === "ticket_sale" || filter === "donation") {
    conditions.push("kind = ?");
    bindings.push(filter);
  }

  if (input.cursor) {
    const parsed = parseCursor(input.cursor);
    if (parsed) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(parsed.createdAt, parsed.createdAt, parsed.id);
    }
  }

  const query = `
    SELECT id, kind, title, body, destination_path AS destinationPath,
           created_at AS createdAt, expires_at AS expiresAt, read_at AS readAt
    FROM notification_receipts
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `;

  const rows = storage.sql
    .exec<StoredNotificationReceiptRow>(query, ...bindings, limit + 1)
    .toArray();

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

  const lastItem = pageRows.at(-1);
  const nextCursor = hasNextPage && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

  const countRow = storage.sql
    .exec<{ readonly unreadCapped: number }>(
      `SELECT COUNT(*) AS unreadCapped FROM (
         SELECT 1 FROM notification_receipts
         WHERE recipient_profile_id = ? AND read_at IS NULL AND expires_at > ?
         LIMIT 101
       )`,
      input.profileId,
      nowIso,
    )
    .toArray()
    .at(0);

  const rawUnread = countRow?.unreadCapped ?? 0;
  const unreadCount = Math.min(rawUnread, 100);
  const hasMoreUnread = rawUnread > 100;

  return {
    hasMoreUnread,
    nextCursor,
    notifications: pageRows.map((row) => ({
      body: row.body,
      createdAt: row.createdAt,
      destinationPath: row.destinationPath,
      expiresAt: row.expiresAt,
      id: row.id,
      kind: row.kind,
      readAt: row.readAt,
      title: row.title,
    })),
    snapshotBoundary: nowIso,
    unreadCount,
  };
}

export function markNotificationReceiptRead(
  storage: NotificationInboxStorage,
  input: {
    readonly now?: Date | undefined;
    readonly notificationId: string;
    readonly profileId: string;
  },
): OrganizationNotification | null {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  storage.sql.exec(
    `UPDATE notification_receipts
     SET read_at = ?
     WHERE id = ? AND recipient_profile_id = ? AND read_at IS NULL`,
    nowIso,
    input.notificationId,
    input.profileId,
  );

  const row = storage.sql
    .exec<StoredNotificationReceiptRow>(
      `SELECT id, kind, title, body, destination_path AS destinationPath,
              created_at AS createdAt, expires_at AS expiresAt, read_at AS readAt
       FROM notification_receipts
       WHERE id = ? AND recipient_profile_id = ? AND expires_at > ?
       LIMIT 1`,
      input.notificationId,
      input.profileId,
      nowIso,
    )
    .toArray()
    .at(0);

  if (!row) return null;

  return {
    body: row.body,
    createdAt: row.createdAt,
    destinationPath: row.destinationPath,
    expiresAt: row.expiresAt,
    id: row.id,
    kind: row.kind,
    readAt: row.readAt,
    title: row.title,
  };
}

export function markAllNotificationReceiptsRead(
  storage: NotificationInboxStorage,
  input: {
    readonly boundary: string;
    readonly now?: Date | undefined;
    readonly profileId: string;
  },
): number {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const dueRows = storage.sql
    .exec<{ readonly id: string }>(
      `SELECT id FROM notification_receipts
       WHERE recipient_profile_id = ? AND read_at IS NULL AND created_at <= ? AND expires_at > ?
       LIMIT 500`,
      input.profileId,
      input.boundary,
      nowIso,
    )
    .toArray();

  if (dueRows.length === 0) return 0;

  for (const row of dueRows) {
    storage.sql.exec("UPDATE notification_receipts SET read_at = ? WHERE id = ?", nowIso, row.id);
  }

  return dueRows.length;
}

export function cleanupExpiredNotificationReceipts(
  storage: NotificationInboxStorage,
  now = new Date(),
  limit = 100,
): number {
  const nowIso = now.toISOString();
  const expiredRows = storage.sql
    .exec<{ readonly id: string }>(
      "SELECT id FROM notification_receipts WHERE expires_at <= ? LIMIT ?",
      nowIso,
      limit,
    )
    .toArray();

  if (expiredRows.length === 0) return 0;

  for (const row of expiredRows) {
    storage.sql.exec("DELETE FROM notification_receipts WHERE id = ?", row.id);
  }

  return expiredRows.length;
}
