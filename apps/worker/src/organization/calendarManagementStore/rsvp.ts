import {
  decorateEventWithRsvpDeadline,
  profileHasVoicePart,
  recalculateProfileStatuses,
  recordEventRsvpChange,
  readRosterAutomationConfiguration,
} from "../statusAutomationStore";
import type { ManagementRequest } from "./contracts";
import { recordExists } from "./shared";

type RsvpOperation = Extract<ManagementRequest, { readonly action: "set_rsvp" }>;

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
    }>(
      "SELECT type, starts_at AS startsAt, duration_minutes AS durationMinutes, is_canceled AS isCanceled FROM events WHERE id = ? AND is_archived = 0 LIMIT 1",
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
    const configuration = readRosterAutomationConfiguration(storage);
    const timezone = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
        "SELECT timezone FROM organization_metadata LIMIT 1",
      )
      .one().timezone;
    const deadlineFields = decorateEventWithRsvpDeadline(
      event,
      configuration,
      timezone,
      new Date(occurredAt),
    );
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
