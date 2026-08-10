import { isValidTimeZone } from "@choir/domain";

import {
  decorateEventWithRsvpDeadline,
  readRosterAutomationConfiguration,
} from "../statusAutomationStore";
import { type EventOperation, type ManagementRequest, type VenueOperation } from "./contracts";
import { existingRecordIds, insertAudit, recordExists } from "./shared";

function ticketConfigurationError(
  storage: DurableObjectStorage,
  event: EventOperation["event"],
): Response | null {
  if (event.isTicketingEnabled && event.type !== "Performance") {
    return Response.json({ code: "ticketing_requires_performance" }, { status: 409 });
  }
  if (event.ticketCapacity !== null) {
    const committedQuantity = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
         WHERE event_id = ? AND status IN ('pending', 'paid')`,
        event.id,
      )
      .one().quantity;
    if (committedQuantity > event.ticketCapacity) {
      return Response.json({ code: "ticket_capacity_below_sales" }, { status: 409 });
    }
  }
  return null;
}

function isActivePerformanceReference(
  event:
    | {
        readonly isArchived: number;
        readonly isCanceled: number;
        readonly type: string;
      }
    | undefined,
): boolean {
  return event?.type === "Performance" && event.isArchived === 0 && event.isCanceled === 0;
}

function eventReferenceError(
  storage: DurableObjectStorage,
  event: EventOperation["event"],
): Response | null {
  const ticketError = ticketConfigurationError(storage, event);
  if (ticketError) return ticketError;
  if (event.venueId && !recordExists(storage, "venues", event.venueId)) {
    return Response.json({ code: "venue_not_found" }, { status: 404 });
  }
  if (event.parentPerformanceId && event.type !== "Rehearsal") {
    return Response.json({ code: "parent_performance_requires_rehearsal" }, { status: 409 });
  }
  if (event.parentPerformanceId) {
    const parent = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly isArchived: number;
        readonly isCanceled: number;
        readonly type: string;
      }>(
        "SELECT type, is_archived AS isArchived, is_canceled AS isCanceled FROM events WHERE id = ? LIMIT 1",
        event.parentPerformanceId,
      )
      .toArray()
      .at(0);
    if (!isActivePerformanceReference(parent)) {
      return Response.json({ code: "parent_performance_not_found" }, { status: 404 });
    }
  }
  if (event.publicGraphicFileId) {
    const graphic = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly contentType: string;
        readonly sizeBytes: number;
      }>(
        `SELECT content_type AS contentType, size_bytes AS sizeBytes
         FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1`,
        event.publicGraphicFileId,
      )
      .toArray()
      .at(0);
    if (
      !graphic ||
      !["image/jpeg", "image/png", "image/webp"].includes(graphic.contentType) ||
      graphic.sizeBytes > 5 * 1024 * 1024
    ) {
      return Response.json({ code: "invalid_public_event_graphic" }, { status: 409 });
    }
  }

  const pieceIds = new Set(
    event.setList.flatMap(({ pieceId }) => (pieceId === undefined ? [] : [pieceId])),
  );
  const existingPieceIds = existingRecordIds(storage, "music_pieces", pieceIds);
  if ([...pieceIds].some((id) => !existingPieceIds.has(id))) {
    return Response.json({ code: "music_piece_not_found" }, { status: 409 });
  }

  const profileIds = new Set(
    event.setList.flatMap(({ performerCredits }) =>
      (performerCredits ?? []).flatMap((credit) =>
        credit.kind === "profile" ? [credit.profileId] : [],
      ),
    ),
  );
  const existingProfileIds = existingRecordIds(storage, "profiles", profileIds);
  return [...profileIds].some((id) => !existingProfileIds.has(id))
    ? Response.json({ code: "performer_profile_not_found" }, { status: 409 })
    : null;
}

export function writeEvent(
  storage: DurableObjectStorage,
  operation: EventOperation,
  occurredAt: string,
): Response {
  const event = operation.event;
  const referenceError = eventReferenceError(storage, event);
  if (referenceError) return referenceError;
  if (operation.action === "update_event" && !recordExists(storage, "events", event.id)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  storage.transactionSync(() => {
    if (operation.action === "create_event") {
      storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
           parent_performance_id, details, public_details, public_graphic_file_id,
           publish_on_website, rsvp_follow_up_lead_hours, rsvp_follow_up_mode,
           advance_price_cents, day_of_price_cents, doors_open_time,
           is_ticketing_enabled, ticket_capacity, set_list_json, set_list_approved,
           is_archived, is_canceled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        event.id,
        event.title,
        event.type,
        event.startsAt,
        event.durationMinutes,
        event.callTime,
        event.location,
        event.venueId,
        event.parentPerformanceId,
        event.details,
        event.publicDetails,
        event.publicGraphicFileId,
        event.publishOnWebsite ? 1 : 0,
        event.rsvpFollowUpLeadHours,
        event.rsvpFollowUpMode,
        event.advancePriceCents,
        event.dayOfPriceCents,
        event.doorsOpenTime,
        event.isTicketingEnabled ? 1 : 0,
        event.ticketCapacity,
        JSON.stringify(event.setList),
        event.setListApproved ? 1 : 0,
        occurredAt,
        occurredAt,
      );
    } else {
      storage.sql.exec(
        `UPDATE events SET title = ?, type = ?, starts_at = ?, duration_minutes = ?,
           call_time = ?, location = ?, venue_id = ?, parent_performance_id = ?, details = ?,
           public_details = ?, public_graphic_file_id = ?, publish_on_website = ?,
           rsvp_follow_up_lead_hours = ?, rsvp_follow_up_mode = ?,
           advance_price_cents = ?, day_of_price_cents = ?, doors_open_time = ?,
           is_ticketing_enabled = ?, ticket_capacity = ?, set_list_json = ?,
           set_list_approved = ?, updated_at = ?
         WHERE id = ?`,
        event.title,
        event.type,
        event.startsAt,
        event.durationMinutes,
        event.callTime,
        event.location,
        event.venueId,
        event.parentPerformanceId,
        event.details,
        event.publicDetails,
        event.publicGraphicFileId,
        event.publishOnWebsite ? 1 : 0,
        event.rsvpFollowUpLeadHours,
        event.rsvpFollowUpMode,
        event.advancePriceCents,
        event.dayOfPriceCents,
        event.doorsOpenTime,
        event.isTicketingEnabled ? 1 : 0,
        event.ticketCapacity,
        JSON.stringify(event.setList),
        event.setListApproved ? 1 : 0,
        occurredAt,
        event.id,
      );
    }
    insertAudit(
      storage,
      operation,
      operation.action === "create_event" ? "event.created" : "event.updated",
      "event",
      event.id,
      {
        isTicketingEnabled: event.isTicketingEnabled,
        publishOnWebsite: event.publishOnWebsite,
        rsvpFollowUpLeadHours: event.rsvpFollowUpLeadHours,
        rsvpFollowUpMode: event.rsvpFollowUpMode,
        startsAt: event.startsAt,
        title: event.title,
        type: event.type,
      },
      occurredAt,
    );
  });
  const createdAt =
    operation.action === "create_event"
      ? occurredAt
      : storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly createdAt: string }>(
            "SELECT created_at AS createdAt FROM events WHERE id = ?",
            event.id,
          )
          .one().createdAt;
  const isCanceled =
    operation.action === "create_event"
      ? 0
      : storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly isCanceled: number }>(
            "SELECT is_canceled AS isCanceled FROM events WHERE id = ?",
            event.id,
          )
          .one().isCanceled;
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  return Response.json({
    ...event,
    isCanceled: isCanceled === 1,
    ...decorateEventWithRsvpDeadline(
      { ...event, isCanceled: isCanceled === 1 },
      configuration,
      timezone,
      new Date(occurredAt),
    ),
    createdAt,
    updatedAt: occurredAt,
  });
}

export function writeVenue(
  storage: DurableObjectStorage,
  operation: VenueOperation,
  occurredAt: string,
): Response {
  if (operation.action === "create_venue") {
    const venue = operation.venue;
    storage.transactionSync(() => {
      storage.sql.exec(
        "INSERT INTO venues (id, name, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        venue.id,
        venue.name,
        venue.address,
        occurredAt,
        occurredAt,
      );
      insertAudit(storage, operation, "venue.created", "venue", venue.id, venue, occurredAt);
    });
    return Response.json({ ...venue, createdAt: occurredAt, updatedAt: occurredAt });
  }
  if (operation.action === "update_venue") {
    const venue = operation.venue;
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly createdAt: string }>(
        "SELECT created_at AS createdAt FROM venues WHERE id = ?",
        venue.id,
      )
      .toArray()[0];
    if (!existing) return Response.json({ code: "venue_not_found" }, { status: 404 });
    storage.transactionSync(() => {
      storage.sql.exec(
        "UPDATE venues SET name = ?, address = ?, updated_at = ? WHERE id = ?",
        venue.name,
        venue.address,
        occurredAt,
        venue.id,
      );
      insertAudit(storage, operation, "venue.updated", "venue", venue.id, venue, occurredAt);
    });
    return Response.json({ ...venue, createdAt: existing.createdAt, updatedAt: occurredAt });
  }
  if (!recordExists(storage, "venues", operation.venueId)) {
    return Response.json({ code: "venue_not_found" }, { status: 404 });
  }
  const referenceCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM events WHERE venue_id = ?) +
         (SELECT COUNT(*) FROM seating_charts WHERE venue_id = ?) AS count`,
      operation.venueId,
      operation.venueId,
    )
    .one().count;
  if (referenceCount > 0) {
    return Response.json({ code: "venue_in_use" }, { status: 409 });
  }
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM venues WHERE id = ?", operation.venueId);
    insertAudit(
      storage,
      operation,
      "venue.deleted",
      "venue",
      operation.venueId,
      { deleted: true },
      occurredAt,
    );
  });
  return Response.json({ status: "deleted", venueId: operation.venueId });
}

export function updateTimezone(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "update_timezone" }>,
  occurredAt: string,
): Response {
  if (!isValidTimeZone(operation.settings.timezone)) {
    return Response.json({ code: "invalid_timezone" }, { status: 400 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET timezone = ?, updated_at = ?",
      operation.settings.timezone,
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      "organization.timezone.updated",
      "organization",
      operation.organizationId,
      { timezone: operation.settings.timezone },
      occurredAt,
    );
  });
  return Response.json(operation.settings);
}
