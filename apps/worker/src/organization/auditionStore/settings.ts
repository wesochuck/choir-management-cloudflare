import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  organizationAuditionSettingsSchema,
  publicAuditionSettingsSchema,
  type OrganizationAuditionSettings,
} from "@choir/contracts";
import { z } from "zod";

import type {
  AuditionActor,
  AuditionNotificationResult,
  AuditionNotificationRow,
} from "./contracts";
import { defaultAuditionSettings } from "./contracts";
import { insertAudit } from "./records";
import { publicAuditionRosterOptions } from "./helpers";

export function readAuditionSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId)
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  const row = storage.sql
    .exec<{ readonly organizationId: string; readonly settings: string }>(
      `SELECT organization_id AS organizationId, audition_settings_json AS settings
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (row?.organizationId !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(row.settings) as unknown;
  } catch {
    raw = defaultAuditionSettings;
  }
  const parsed = organizationAuditionSettingsSchema.safeParse(raw);
  return Response.json(parsed.success ? parsed.data : defaultAuditionSettings);
}

export function readPublicAuditionSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId)
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  const row = storage.sql
    .exec<{
      readonly organizationId: string;
      readonly settings: string;
      readonly timezone: string;
    }>(
      `SELECT organization_id AS organizationId, audition_settings_json AS settings, timezone
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (row?.organizationId !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(row.settings) as unknown;
  } catch {
    raw = defaultAuditionSettings;
  }
  const settingsResult = organizationAuditionSettingsSchema.safeParse(raw);
  const settings = settingsResult.success ? settingsResult.data : defaultAuditionSettings;
  const performance = settings.defaultPerformanceId
    ? storage.sql
        .exec<{ readonly id: string; readonly startsAt: string; readonly title: string }>(
          `SELECT id, starts_at AS startsAt, title
           FROM events
           WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0
           LIMIT 1`,
          settings.defaultPerformanceId,
        )
        .toArray()
        .at(0)
    : undefined;
  const venueRows = storage.sql
    .exec<{ readonly address: string; readonly id: string; readonly name: string }>(
      "SELECT id, address, name FROM venues",
    )
    .toArray();
  const venuesById = new Map(venueRows.map((venueRow) => [venueRow.id, venueRow]));
  const venue = settings.venueId ? venuesById.get(settings.venueId) : undefined;
  const rehearsalSchedule = settings.rehearsalSchedule.map((session) => ({
    ...session,
    venue: session.venueId ? (venuesById.get(session.venueId) ?? null) : null,
  }));
  const rosterOptions = publicAuditionRosterOptions(storage);
  const publicSettings = publicAuditionSettingsSchema.parse({
    confirmationMessage: settings.confirmationMessage,
    defaultPerformanceId: settings.defaultPerformanceId,
    enabled: settings.enabled,
    mode: settings.mode,
    performerLabel: rosterOptions.performerLabel,
    performance: performance ?? null,
    rehearsalNotes: settings.rehearsalNotes,
    rehearsalSchedule,
    sections: rosterOptions.sections,
    slots: settings.slots,
    startDate: settings.startDate ?? null,
    timezone: row.timezone,
    venue: venue ?? null,
    voiceParts: rosterOptions.voiceParts,
  });
  return Response.json(publicSettings);
}

export function updateAuditionSettingsInStore(
  storage: DurableObjectStorage,
  organizationId: string,
  settings: OrganizationAuditionSettings,
  actor: AuditionActor,
): Response {
  const row = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (row?.organizationId !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  let validatedSettings = settings;
  const rehearsalVenueIds = new Set(
    validatedSettings.rehearsalSchedule.flatMap((session) =>
      session.venueId ? [session.venueId] : [],
    ),
  );
  const venueIds = new Set(
    storage.sql
      .exec<{ readonly id: string }>("SELECT id FROM venues")
      .toArray()
      .map(({ id }) => id),
  );
  if (
    validatedSettings.mode === "open_inquiry" &&
    validatedSettings.rehearsalSchedule.some((session) => session.venueId === null)
  ) {
    return Response.json({ code: "rehearsal_venue_required" }, { status: 400 });
  }
  if ([...rehearsalVenueIds].some((venueId) => !venueIds.has(venueId))) {
    return Response.json({ code: "rehearsal_venue_not_found" }, { status: 400 });
  }
  if (validatedSettings.mode === "audition") {
    if (!validatedSettings.venueId) {
      return Response.json({ code: "venue_required" }, { status: 400 });
    }
    const venueExists = venueIds.has(validatedSettings.venueId);
    if (!venueExists) {
      return Response.json({ code: "venue_not_found" }, { status: 400 });
    }
    if (validatedSettings.defaultPerformanceId) {
      const performanceExists =
        storage.sql
          .exec(
            "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0 LIMIT 1",
            validatedSettings.defaultPerformanceId,
          )
          .toArray().length > 0;
      if (!performanceExists) {
        return Response.json({ code: "performance_not_found" }, { status: 400 });
      }
    }
  } else {
    if (validatedSettings.venueId && !venueIds.has(validatedSettings.venueId)) {
      validatedSettings = { ...validatedSettings, venueId: null };
    }
    if (validatedSettings.defaultPerformanceId) {
      const performanceExists =
        storage.sql
          .exec(
            "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0 LIMIT 1",
            validatedSettings.defaultPerformanceId,
          )
          .toArray().length > 0;
      if (!performanceExists) {
        validatedSettings = { ...validatedSettings, defaultPerformanceId: null };
      }
    }
  }
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET audition_settings_json = ?, updated_at = ?",
      JSON.stringify(validatedSettings),
      now,
    );
    insertAudit(
      storage,
      actor,
      "audition.settings_updated",
      organizationId,
      {
        defaultPerformanceId: validatedSettings.defaultPerformanceId,
        enabled: validatedSettings.enabled,
        mode: validatedSettings.mode,
        slotCount: validatedSettings.slots.length,
        startDate: validatedSettings.startDate,
        venueId: validatedSettings.venueId,
      },
      now,
    );
  });
  return Response.json(validatedSettings);
}

export function readAuditionNotificationJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  const parsedJobId = z.uuid().safeParse(jobId);
  if (!organizationId || !parsedJobId.success) {
    return Response.json({ code: "audition_notification_not_found" }, { status: 404 });
  }
  const identity = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== organizationId) {
    return Response.json({ code: "audition_notification_not_found" }, { status: 404 });
  }
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'audition_notification' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const notificationId = job?.idempotencyKey.split(":")[1];
  if (!notificationId) {
    return Response.json({ code: "audition_notification_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<AuditionNotificationRow>(
      `SELECT n.id, n.destination, n.recipient_name AS recipientName, n.subject,
        n.audition_id AS auditionId, n.kind, n.content_markdown AS contentMarkdown, n.status,
        n.provider_event_at AS providerEventAt, n.provider_message_id AS providerMessageId,
        n.provider_reason AS providerReason, n.provider_status AS providerStatus
       FROM audition_notifications n
       JOIN auditions a ON a.id = n.audition_id
       WHERE n.id = ? LIMIT 1`,
      notificationId,
    )
    .toArray()
    .at(0);
  if (!row || !["queued", "processing"].includes(row.status)) {
    return Response.json({ code: "audition_notification_not_found" }, { status: 404 });
  }
  storage.sql.exec(
    "UPDATE audition_notifications SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'queued'",
    new Date().toISOString(),
    row.id,
  );
  return Response.json(row);
}

export function recordAuditionNotificationResult(
  storage: DurableObjectStorage,
  organizationId: string | null,
  result: AuditionNotificationResult,
): Response {
  const identity = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== organizationId) {
    return Response.json({ code: "audition_notification_not_found" }, { status: 404 });
  }
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'audition_notification' LIMIT 1`,
      result.jobId,
    )
    .toArray()
    .at(0);
  const notificationId = job?.idempotencyKey.split(":")[1];
  if (!notificationId) {
    return Response.json({ code: "audition_notification_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  storage.sql.exec(
    `UPDATE audition_notifications SET status = ?, attempts = attempts + 1,
      provider_message_id = ?,
      provider_status = CASE WHEN ? = 'sent' AND ? IS NOT NULL AND provider_status IS NULL THEN 'accepted' ELSE provider_status END,
      failure_detail = ?, updated_at = ?,
      sent_at = CASE WHEN ? IN ('sent', 'suppressed') THEN ? ELSE sent_at END
     WHERE id = ?`,
    result.status,
    result.providerMessageId,
    result.status,
    result.providerMessageId,
    result.failureDetail,
    now,
    result.status,
    now,
    notificationId,
  );
  return Response.json({ recorded: true });
}
