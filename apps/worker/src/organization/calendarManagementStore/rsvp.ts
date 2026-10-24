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

interface StoredRsvpEvent {
  readonly [column: string]: SqlStorageValue;
  readonly durationMinutes: number | null;
  readonly isCanceled: number;
  readonly startsAt: string;
  readonly type: "Performance" | "Rehearsal" | "Other";
  readonly rsvpDeadlineDate: string | null;
  readonly otherEventRsvpMode: "off" | "optional" | "response_requested" | null;
}

function validateRsvpOperation(
  storage: DurableObjectStorage,
  rsvpOperation: RsvpOperation,
  occurredAt: string,
): { readonly errorResponse: Response } | { readonly event: StoredRsvpEvent } {
  if (!recordExists(storage, "events", rsvpOperation.eventId)) {
    return { errorResponse: Response.json({ code: "event_not_found" }, { status: 404 }) };
  }
  if (!recordExists(storage, "profiles", rsvpOperation.rsvp.profileId)) {
    return { errorResponse: Response.json({ code: "profile_not_found" }, { status: 404 }) };
  }
  const event = storage.sql
    .exec<StoredRsvpEvent>(
      "SELECT type, starts_at AS startsAt, duration_minutes AS durationMinutes, is_canceled AS isCanceled, rsvp_deadline_date AS rsvpDeadlineDate, other_event_rsvp_mode AS otherEventRsvpMode FROM events WHERE id = ? AND is_archived = 0 LIMIT 1",
      rsvpOperation.eventId,
    )
    .toArray()
    .at(0);
  if (!event) {
    return { errorResponse: Response.json({ code: "event_not_found" }, { status: 404 }) };
  }
  if (event.type !== "Other" && !profileHasVoicePart(storage, rsvpOperation.rsvp.profileId)) {
    return { errorResponse: Response.json({ code: "rsvp_voice_part_required" }, { status: 422 }) };
  }
  if (event.isCanceled === 1) {
    return { errorResponse: Response.json({ code: "event_canceled" }, { status: 409 }) };
  }
  if (event.type === "Other" && event.otherEventRsvpMode === "off") {
    return { errorResponse: Response.json({ code: "rsvp_closed" }, { status: 409 }) };
  }
  if (
    rsvpOperation.selfService &&
    event.type === "Rehearsal" &&
    rsvpOperation.rsvp.rsvp === "No" &&
    rsvpOperation.rsvp.rsvpNote.trim() === ""
  ) {
    return {
      errorResponse: Response.json({ code: "rsvp_decline_note_required" }, { status: 400 }),
    };
  }
  if (rsvpOperation.selfService) {
    const timezone = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
        "SELECT timezone FROM organization_metadata LIMIT 1",
      )
      .one().timezone;
    const deadlineFields = decorateEventWithRsvpDeadline(event, timezone, new Date(occurredAt));
    if (!deadlineFields.rsvpSelfServiceOpen) {
      return { errorResponse: Response.json({ code: "rsvp_closed" }, { status: 409 }) };
    }
  }
  return { event };
}

export function updateEventRsvp(
  storage: DurableObjectStorage,
  rsvpOperation: RsvpOperation,
  occurredAt: string,
): Response {
  const validation = validateRsvpOperation(storage, rsvpOperation, occurredAt);
  if ("errorResponse" in validation) {
    return validation.errorResponse;
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
    [rsvpOperation.rsvp.profileId],
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
      readonly type: "Performance" | "Rehearsal" | "Other";
    }>(
      "SELECT type, is_canceled AS isCanceled FROM events WHERE id = ? AND is_archived = 0 LIMIT 1",
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
  if (
    event.type !== "Other" &&
    [...profileIds].some((profileId) => !profileHasVoicePart(storage, profileId))
  ) {
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
  const affectedProfileIds = [
    ...new Set(bulkRsvpOperation.updates.map((update) => update.profileId)),
  ];
  recalculateProfileStatuses(
    storage,
    bulkRsvpOperation.organizationId,
    new Date(occurredAt),
    bulkRsvpOperation.requestId,
    affectedProfileIds,
  );
  return listEventAttendanceFromStore(storage, {
    eventId: bulkRsvpOperation.eventId,
    organizationId: bulkRsvpOperation.organizationId,
  });
}
