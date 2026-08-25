import {
  decorateEventWithRsvpDeadline,
  profileHasVoicePart,
  recalculateProfileStatuses,
  recordEventRsvpChange,
} from "../statusAutomationStore";
import type { ManagementRequest } from "./contracts";
import { insertAudit, recordExists } from "./shared";
import { listEventAttendanceFromStore } from "./attendance";

type RsvpOperation = Extract<ManagementRequest, { readonly action: "set_rsvp" }>;
type BulkRsvpOperation = Extract<ManagementRequest, { readonly action: "bulk_set_rsvp" }>;

export function updateEventRsvp(
  storage: DurableObjectStorage,
  rsvpOperation: RsvpOperation,
  occurredAt: string,
): Response {
  if (!recordExists(storage, "events", rsvpOperation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", rsvpOperation.rsvp.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  if (!profileHasVoicePart(storage, rsvpOperation.rsvp.profileId)) {
    return Response.json({ code: "rsvp_voice_part_required" }, { status: 422 });
  }
  const event = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly durationMinutes: number | null;
      readonly isCanceled: number;
      readonly startsAt: string;
      readonly type: "Performance" | "Rehearsal";
      readonly rsvpDeadlineDate: string | null;
    }>(
      "SELECT type, starts_at AS startsAt, duration_minutes AS durationMinutes, is_canceled AS isCanceled, rsvp_deadline_date AS rsvpDeadlineDate FROM events WHERE id = ? AND is_archived = 0 LIMIT 1",
      rsvpOperation.eventId,
    )
    .toArray()
    .at(0);
  if (!event) return Response.json({ code: "event_not_found" }, { status: 404 });
  if (event.isCanceled === 1) {
    return Response.json({ code: "event_canceled" }, { status: 409 });
  }
  if (
    rsvpOperation.selfService &&
    event.type === "Rehearsal" &&
    rsvpOperation.rsvp.rsvp === "No" &&
    rsvpOperation.rsvp.rsvpNote.trim() === ""
  ) {
    return Response.json({ code: "rsvp_decline_note_required" }, { status: 400 });
  }
  if (rsvpOperation.selfService) {
    const timezone = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
        "SELECT timezone FROM organization_metadata LIMIT 1",
      )
      .one().timezone;
    const deadlineFields = decorateEventWithRsvpDeadline(event, timezone, new Date(occurredAt));
    if (!deadlineFields.rsvpSelfServiceOpen) {
      return Response.json({ code: "rsvp_closed" }, { status: 409 });
    }
  }
  storage.transactionSync(() => {
    const rsvpNote = rsvpOperation.rsvp.rsvp === "No" ? rsvpOperation.rsvp.rsvpNote : "";
    recordEventRsvpChange(storage, {
      actor: {
        actorId: rsvpOperation.actorUserId,
        actorType: "organization_member",
        requestId: rsvpOperation.requestId,
      },
      automatic: false,
      eventId: rsvpOperation.eventId,
      newRsvp: rsvpOperation.rsvp.rsvp,
      occurredAt,
      profileId: rsvpOperation.rsvp.profileId,
      reason: rsvpOperation.selfService ? "Member updated RSVP." : "Administrator updated RSVP.",
      rsvpNote,
    });
  });
  recalculateProfileStatuses(
    storage,
    rsvpOperation.organizationId,
    new Date(occurredAt),
    rsvpOperation.requestId,
  );
  return Response.json({
    eventId: rsvpOperation.eventId,
    ...rsvpOperation.rsvp,
    rsvpNote: rsvpOperation.rsvp.rsvp === "No" ? rsvpOperation.rsvp.rsvpNote : "",
    updatedAt: occurredAt,
  });
}

export function bulkUpdateEventRsvp(
  storage: DurableObjectStorage,
  bulkRsvpOperation: BulkRsvpOperation,
  occurredAt: string,
): Response {
  if (!recordExists(storage, "events", bulkRsvpOperation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const event = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly isCanceled: number;
    }>(
      "SELECT is_canceled AS isCanceled FROM events WHERE id = ? AND is_archived = 0 LIMIT 1",
      bulkRsvpOperation.eventId,
    )
    .toArray()
    .at(0);
  if (!event) return Response.json({ code: "event_not_found" }, { status: 404 });
  if (event.isCanceled === 1) {
    return Response.json({ code: "event_canceled" }, { status: 409 });
  }
  const profileIds = new Set(bulkRsvpOperation.updates.map(({ profileId }) => profileId));
  if (profileIds.size !== bulkRsvpOperation.updates.length) {
    return Response.json({ code: "duplicate_profile" }, { status: 400 });
  }
  if ([...profileIds].some((profileId) => !recordExists(storage, "profiles", profileId))) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  if ([...profileIds].some((profileId) => !profileHasVoicePart(storage, profileId))) {
    return Response.json({ code: "rsvp_voice_part_required" }, { status: 422 });
  }
  let changedCount = 0;
  storage.transactionSync(() => {
    for (const update of bulkRsvpOperation.updates) {
      if (
        recordEventRsvpChange(storage, {
          actor: {
            actorId: bulkRsvpOperation.actorUserId,
            actorType: "organization_member",
            requestId: bulkRsvpOperation.requestId,
          },
          automatic: false,
          eventId: bulkRsvpOperation.eventId,
          newRsvp: update.rsvp,
          occurredAt,
          profileId: update.profileId,
          reason: "Administrator updated RSVP.",
          rsvpNote: update.rsvp === "No" ? update.rsvpNote : "",
        })
      ) {
        changedCount += 1;
      }
    }
    insertAudit(
      storage,
      bulkRsvpOperation,
      "event.rsvp.bulk_updated",
      "event",
      bulkRsvpOperation.eventId,
      {
        changedCount,
        profileCount: bulkRsvpOperation.updates.length,
      },
      occurredAt,
    );
  });
  recalculateProfileStatuses(
    storage,
    bulkRsvpOperation.organizationId,
    new Date(occurredAt),
    bulkRsvpOperation.requestId,
  );
  return listEventAttendanceFromStore(storage, {
    eventId: bulkRsvpOperation.eventId,
    organizationId: bulkRsvpOperation.organizationId,
  });
}
