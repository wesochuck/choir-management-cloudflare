import { z } from "zod";
import {
  donationSettingsSchema,
  ticketConfirmationSettingsSchema,
  transactionFeeSettingsSchema,
} from "@choir/contracts";
import { updateDonationSettingsInStore } from "../donationSettingsStore";
import { updateTransactionFeeSettingsInStore } from "../transactionFeeSettingsStore";
import { updateTicketConfirmationSettingsInStore } from "../ticketConfirmationSettingsStore";

import {
  calendarCredentialRequestSchema,
  calendarFeedValidationSchema,
  organizationIdentity,
} from "./storeShared";
import type { CalendarProfileRow, CalendarEventRow } from "./storeShared";

export async function donationSettingsUpdateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = donationSettingsSchema.safeParse(raw);
  const context = z
    .object({
      actorUserId: z.string().min(1),
      organizationId: z.string().min(1),
      requestId: z.uuid(),
    })
    .safeParse(raw);
  if (!parsed.success || !context.success) {
    return Response.json({ code: "validation_failed" }, { status: 400 });
  }
  return updateDonationSettingsInStore(storage, context.data.organizationId, parsed.data, {
    actorUserId: context.data.actorUserId,
    requestId: context.data.requestId,
  });
}

export async function transactionFeeSettingsUpdateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = transactionFeeSettingsSchema.safeParse(raw);
  const context = z
    .object({
      actorUserId: z.string().min(1),
      organizationId: z.string().min(1),
      requestId: z.uuid(),
    })
    .safeParse(raw);
  if (!parsed.success || !context.success) {
    return Response.json({ code: "validation_failed" }, { status: 400 });
  }
  return updateTransactionFeeSettingsInStore(storage, context.data.organizationId, parsed.data, {
    actorUserId: context.data.actorUserId,
    requestId: context.data.requestId,
  });
}

export async function ticketConfirmationSettingsUpdateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = ticketConfirmationSettingsSchema.safeParse(raw);
  const context = z
    .object({
      actorUserId: z.string().min(1),
      organizationId: z.string().min(1),
      requestId: z.uuid(),
    })
    .safeParse(raw);
  if (!parsed.success || !context.success) {
    return Response.json({ code: "validation_failed" }, { status: 400 });
  }
  return updateTicketConfirmationSettingsInStore(
    storage,
    context.data.organizationId,
    parsed.data,
    {
      actorUserId: context.data.actorUserId,
      requestId: context.data.requestId,
    },
  );
}

export async function manageCalendarCredential(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = calendarCredentialRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_calendar_credential_request" }, { status: 400 });
  }
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const profile = storage.sql
    .exec<CalendarProfileRow>(
      `SELECT display_name AS displayName, calendar_feed_version AS calendarFeedVersion
       FROM profiles WHERE id = ? LIMIT 1`,
      parsed.data.profileId,
    )
    .toArray()
    .at(0);
  if (!profile) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  if (parsed.data.action === "read") {
    return Response.json({
      calendarFeedVersion: profile.calendarFeedVersion,
      displayName: profile.displayName,
      profileId: parsed.data.profileId,
    });
  }

  const resetAt = new Date().toISOString();
  const nextVersion = profile.calendarFeedVersion + 1;
  const resetActorUserId: string = parsed.data.actorUserId;
  const resetRequestId: string = parsed.data.requestId;
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE profiles SET calendar_feed_version = ?, updated_at = ? WHERE id = ?`,
      nextVersion,
      resetAt,
      parsed.data.profileId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.calendar_feed.reset',
         'profile', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      resetActorUserId,
      parsed.data.profileId,
      resetRequestId,
      JSON.stringify({ afterVersion: nextVersion, beforeVersion: profile.calendarFeedVersion }),
      resetAt,
    );
  });
  return Response.json({
    calendarFeedVersion: nextVersion,
    displayName: profile.displayName,
    profileId: parsed.data.profileId,
  });
}

export async function validateCalendarFeed(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = calendarFeedValidationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_calendar_feed" }, { status: 400 });
  }
  const organization = organizationIdentity(storage);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "calendar_feed_not_found" }, { status: 404 });
  }
  const profile = storage.sql
    .exec<CalendarProfileRow>(
      `SELECT display_name AS displayName, calendar_feed_version AS calendarFeedVersion
       FROM profiles WHERE id = ? LIMIT 1`,
      parsed.data.profileId,
    )
    .toArray()
    .at(0);
  if (profile?.calendarFeedVersion !== parsed.data.revocationVersion) {
    return Response.json({ code: "calendar_feed_not_found" }, { status: 404 });
  }
  const readAt = new Date(parsed.data.readAt);
  const earliest = new Date(readAt.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const latest = new Date(readAt.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  const rows = storage.sql
    .exec<CalendarEventRow>(
      `SELECT e.id, e.title, e.type, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.call_time AS callTime,
         e.location, e.details, e.set_list_json AS setListJson,
         e.set_list_approved AS setListApproved,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress,
         direct.rsvp AS directRsvp, parent.rsvp AS parentRsvp
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN event_rosters direct
         ON direct.event_id = e.id AND direct.profile_id = ?
       LEFT JOIN event_rosters parent
         ON parent.event_id = e.parent_performance_id AND parent.profile_id = ?
       WHERE e.is_archived = 0 AND e.is_canceled = 0 AND e.starts_at >= ? AND e.starts_at <= ?
       ORDER BY e.starts_at ASC, e.id ASC
       LIMIT 500`,
      parsed.data.profileId,
      parsed.data.profileId,
      earliest,
      latest,
    )
    .toArray();
  const events = rows.flatMap((event) => {
    let resolvedRsvp = event.directRsvp ?? "Pending";
    if (
      event.type === "Rehearsal" &&
      resolvedRsvp === "Pending" &&
      event.parentRsvp !== null &&
      event.parentRsvp !== "Pending"
    ) {
      resolvedRsvp = event.parentRsvp;
    }
    if (resolvedRsvp !== "Yes" && resolvedRsvp !== "Pending") return [];
    return [
      {
        callTime: event.callTime,
        details: event.details,
        durationMinutes: event.durationMinutes,
        id: event.id,
        location: event.location,
        resolvedRsvp,
        setListApproved: event.setListApproved === 1,
        setListJson: event.setListJson,
        startsAt: event.startsAt,
        title: event.title,
        type: event.type,
        venueAddress: event.venueAddress,
        venueName: event.venueName,
      },
    ];
  });
  const setupRow = storage.sql
    .exec<{ readonly organizationName: string }>(
      "SELECT organization_name AS organizationName FROM setup_state LIMIT 1",
    )
    .toArray()
    .at(0);
  const configuredName = setupRow?.organizationName.trim();
  const organizationName =
    configuredName && configuredName.length > 0 ? configuredName : organization.name;
  return Response.json({
    calendarFeedVersion: profile.calendarFeedVersion,
    events,
    organizationName,
    profileId: parsed.data.profileId,
    profileName: profile.displayName,
    timezone:
      storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
          "SELECT timezone FROM organization_metadata LIMIT 1",
        )
        .toArray()
        .at(0)?.timezone ?? "UTC",
  });
}
