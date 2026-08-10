import type { ManagementRequest } from "./contracts";
import { insertAudit, recordExists } from "./shared";

type ArchiveEventOperation = Extract<ManagementRequest, { readonly action: "archive_event" }>;
type CancelEventOperation = Extract<ManagementRequest, { readonly action: "cancel_event" }>;

export function archiveEvent(
  storage: DurableObjectStorage,
  operation: ArchiveEventOperation,
  occurredAt: string,
): Response {
  if (!recordExists(storage, "events", operation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const childCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM events WHERE parent_performance_id = ? AND is_archived = 0",
      operation.eventId,
    )
    .one().count;
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE events SET is_archived = 1, updated_at = ? WHERE id = ?",
      occurredAt,
      operation.eventId,
    );
    storage.sql.exec(
      `UPDATE events SET is_archived = 1, updated_at = ?
       WHERE parent_performance_id = ? AND is_archived = 0`,
      occurredAt,
      operation.eventId,
    );
    insertAudit(
      storage,
      operation,
      "event.archived",
      "event",
      operation.eventId,
      { archived: true, childEventsArchived: childCount },
      occurredAt,
    );
  });
  return Response.json({ eventId: operation.eventId, status: "archived" });
}

export function cancelEvent(
  storage: DurableObjectStorage,
  operation: CancelEventOperation,
  occurredAt: string,
): Response {
  const eventState = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly isArchived: number;
      readonly isCanceled: number;
    }>(
      "SELECT is_archived AS isArchived, is_canceled AS isCanceled FROM events WHERE id = ? LIMIT 1",
      operation.eventId,
    )
    .toArray()
    .at(0);
  if (!eventState || eventState.isArchived === 1) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  if (eventState.isCanceled === 1) {
    return Response.json({ eventId: operation.eventId, status: "canceled" });
  }
  const childCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM events WHERE parent_performance_id = ? AND is_archived = 0 AND is_canceled = 0",
      operation.eventId,
    )
    .one().count;
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE events SET is_canceled = 1, updated_at = ? WHERE id = ? AND is_archived = 0",
      occurredAt,
      operation.eventId,
    );
    storage.sql.exec(
      `UPDATE events SET is_canceled = 1, updated_at = ?
       WHERE parent_performance_id = ? AND is_archived = 0 AND is_canceled = 0`,
      occurredAt,
      operation.eventId,
    );
    insertAudit(
      storage,
      operation,
      "event.canceled",
      "event",
      operation.eventId,
      { canceled: true, childEventsCanceled: childCount },
      occurredAt,
    );
  });
  return Response.json({ eventId: operation.eventId, status: "canceled" });
}
