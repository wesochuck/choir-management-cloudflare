import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  organizationAuditionSettingsSchema,
  type OrganizationAuditionSettings,
} from "@choir/contracts";
import { z } from "zod";

const defaultAuditionSettings: OrganizationAuditionSettings = {
  adminNotifyEnabled: false,
  adminNotifyUsers: [],
  confirmationMessage: "Thank you for your interest. We will be in touch soon.",
  defaultPerformanceId: null,
  enabled: true,
  slots: [],
};

interface AuditionCreateInput {
  readonly adminNotes?: string;
  readonly availabilityNotes: string;
  readonly email: string;
  readonly experience: string;
  readonly name: string;
  readonly performanceId?: string | null;
  readonly phone: string;
  readonly requestedSlots?: readonly string[];
  readonly scheduledTimeSlot?: string | null;
  readonly status?: string;
  readonly voicePart: string;
}

interface AuditionUpdateInput {
  readonly adminNotes?: string;
  readonly availabilityNotes?: string;
  readonly email?: string;
  readonly experience?: string;
  readonly name?: string;
  readonly performanceId?: string | null;
  readonly phone?: string;
  readonly requestedSlots?: readonly string[];
  readonly scheduledTimeSlot?: string | null;
  readonly status?: string;
  readonly voicePart?: string;
}

interface AuditionActor {
  readonly actorUserId: string;
  readonly requestId: string;
}

interface AuditionRow {
  readonly [column: string]: SqlStorageValue;
  readonly adminNotes: string;
  readonly availabilityNotes: string;
  readonly createdAt: string;
  readonly email: string;
  readonly experience: string;
  readonly id: string;
  readonly name: string;
  readonly performanceId: string | null;
  readonly phone: string;
  readonly requestedSlotsJson: string;
  readonly scheduledTimeSlot: string | null;
  readonly status: string;
  readonly updatedAt: string;
  readonly voicePart: string;
}

interface AuditionNotificationRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentMarkdown: string;
  readonly destination: string;
  readonly id: string;
  readonly recipientName: string;
  readonly status: string;
  readonly subject: string;
}

interface AuditionNotificationResult {
  readonly failureDetail: string;
  readonly jobId: string;
  readonly providerMessageId: string | null;
  readonly status: "failed" | "sent" | "suppressed";
}

function parseRequestedSlots(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function storedAuditionSettings(storage: DurableObjectStorage): OrganizationAuditionSettings {
  try {
    const raw = storage.sql
      .exec<{ readonly settings: string }>(
        "SELECT audition_settings_json AS settings FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.settings;
    if (raw) {
      const parsed = organizationAuditionSettingsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Use the backwards-compatible defaults for Organizations provisioned before audition settings.
  }
  return defaultAuditionSettings;
}

export function auditionSlotsAreConfigured(
  storage: DurableObjectStorage,
  requestedSlots: readonly string[] | undefined,
): boolean {
  if (!requestedSlots || requestedSlots.length === 0) return true;
  const allowed = new Set(storedAuditionSettings(storage).slots.map(({ startsAt }) => startsAt));
  return requestedSlots.every((slot) => allowed.has(slot));
}

function queueAuditionNotification(
  storage: DurableObjectStorage,
  input: {
    readonly auditionId: string;
    readonly contentMarkdown: string;
    readonly dedupeKey: string;
    readonly destination: string;
    readonly kind: "inquiry_confirmation" | "scheduled_confirmation" | "admin_alert";
    readonly recipientName: string;
    readonly subject: string;
    readonly scheduledFor: string;
  },
): void {
  if (!z.email().safeParse(input.destination).success) return;
  const existing = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM audition_notifications WHERE dedupe_key = ? LIMIT 1",
      input.dedupeKey,
    )
    .toArray()
    .at(0);
  if (existing) return;
  const notificationId = crypto.randomUUID();
  const now = new Date().toISOString();
  storage.sql.exec(
    `INSERT INTO audition_notifications
      (id, audition_id, dedupe_key, kind, destination, recipient_name, subject,
       content_markdown, status, scheduled_for, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    notificationId,
    input.auditionId,
    input.dedupeKey,
    input.kind,
    input.destination,
    input.recipientName,
    input.subject,
    input.contentMarkdown,
    input.scheduledFor,
    now,
    now,
  );
  storage.sql.exec(
    `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
     VALUES (?, 'audition_notification', ?, ?, ?)`,
    crypto.randomUUID(),
    `audition-notification:${notificationId}`,
    input.scheduledFor,
    now,
  );
}

function queueCreateNotifications(
  storage: DurableObjectStorage,
  auditionId: string,
  name: string,
  email: string,
): void {
  const settings = storedAuditionSettings(storage);
  const now = new Date().toISOString();
  queueAuditionNotification(storage, {
    auditionId,
    contentMarkdown: settings.confirmationMessage,
    dedupeKey: `audition-confirmation:${auditionId}`,
    destination: email,
    kind: "inquiry_confirmation",
    recipientName: name,
    scheduledFor: now,
    subject: "Audition inquiry received",
  });
  if (settings.adminNotifyEnabled) {
    for (const destination of settings.adminNotifyUsers) {
      queueAuditionNotification(storage, {
        auditionId,
        contentMarkdown: `${name} submitted an audition inquiry.`,
        dedupeKey: `audition-admin-alert:${auditionId}:${destination}`,
        destination,
        kind: "admin_alert",
        recipientName: "Organization administrator",
        scheduledFor: now,
        subject: `New audition inquiry from ${name}`,
      });
    }
  }
}

function readSlotsForAudition(
  storage: DurableObjectStorage,
  auditionId: string,
): { id: string; startsAt: string; endsAt: string }[] {
  return storage.sql
    .exec<{ id: string; startsAt: string; endsAt: string }>(
      `SELECT id, starts_at AS startsAt, ends_at AS endsAt
       FROM audition_slots WHERE audition_id = ? ORDER BY starts_at`,
      auditionId,
    )
    .toArray();
}

function readAuditionRow(
  storage: DurableObjectStorage,
  auditionId: string,
): AuditionRow | undefined {
  return storage.sql
    .exec<AuditionRow>(
      `SELECT id, name, email, phone, voice_part AS voicePart, experience,
              availability_notes AS availabilityNotes, admin_notes AS adminNotes,
              performance_id AS performanceId, requested_slots_json AS requestedSlotsJson,
              scheduled_time_slot AS scheduledTimeSlot, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM auditions WHERE id = ? LIMIT 1`,
      auditionId,
    )
    .toArray()
    .at(0);
}

function responseForRow(storage: DurableObjectStorage, row: AuditionRow): Response {
  return Response.json({
    adminNotes: row.adminNotes || undefined,
    availabilityNotes: row.availabilityNotes || undefined,
    createdAt: row.createdAt,
    email: row.email,
    experience: row.experience || undefined,
    id: row.id,
    name: row.name,
    performanceId: row.performanceId,
    phone: row.phone || undefined,
    requestedSlots: parseRequestedSlots(row.requestedSlotsJson),
    scheduledTimeSlot: row.scheduledTimeSlot,
    status: row.status,
    slots: readSlotsForAudition(storage, row.id),
    updatedAt: row.updatedAt,
    voicePart: row.voicePart || undefined,
  });
}

function insertAudit(
  storage: DurableObjectStorage,
  actor: AuditionActor,
  action: string,
  targetId: string,
  summary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, 'audition', ?, ?, ?, ?)`,
    `audition:${action}:${actor.requestId}`,
    actor.actorUserId,
    action,
    targetId,
    actor.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

export function createAuditionInStore(
  storage: DurableObjectStorage,
  input: AuditionCreateInput,
  actor?: AuditionActor,
): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO auditions
        (id, name, email, phone, voice_part, experience, availability_notes, admin_notes,
         performance_id, requested_slots_json, scheduled_time_slot, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.email,
      input.phone,
      input.voicePart,
      input.experience,
      input.availabilityNotes,
      input.adminNotes ?? "",
      input.performanceId ?? null,
      JSON.stringify(input.requestedSlots ?? []),
      input.scheduledTimeSlot ?? null,
      input.status ?? "pending",
      now,
      now,
    );
    if (actor) {
      insertAudit(
        storage,
        actor,
        "audition.created",
        id,
        { status: input.status ?? "pending" },
        now,
      );
    }
    queueCreateNotifications(storage, id, input.name, input.email);
  });
  return id;
}

export function readAuditionFromStore(
  storage: DurableObjectStorage,
  _organizationId: string | null,
  auditionId: string,
): Response {
  const row = readAuditionRow(storage, auditionId);
  return row
    ? responseForRow(storage, row)
    : Response.json({ code: "audition_not_found" }, { status: 404 });
}

export function listAuditionsFromStore(storage: DurableObjectStorage): Response {
  const rows = storage.sql
    .exec<AuditionRow>(
      `SELECT id, name, email, phone, voice_part AS voicePart, experience,
              availability_notes AS availabilityNotes, admin_notes AS adminNotes,
              performance_id AS performanceId, requested_slots_json AS requestedSlotsJson,
              scheduled_time_slot AS scheduledTimeSlot, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM auditions ORDER BY created_at DESC, id DESC LIMIT 500`,
    )
    .toArray();
  const auditions = rows.map((row) => ({
    adminNotes: row.adminNotes || undefined,
    availabilityNotes: row.availabilityNotes || undefined,
    createdAt: row.createdAt,
    email: row.email,
    experience: row.experience || undefined,
    id: row.id,
    name: row.name,
    performanceId: row.performanceId,
    phone: row.phone || undefined,
    requestedSlots: parseRequestedSlots(row.requestedSlotsJson),
    scheduledTimeSlot: row.scheduledTimeSlot,
    slots: readSlotsForAudition(storage, row.id),
    status: row.status,
    updatedAt: row.updatedAt,
    voicePart: row.voicePart || undefined,
  }));
  return Response.json({ auditions });
}

export function updateAuditionInStore(
  storage: DurableObjectStorage,
  auditionId: string,
  input: AuditionUpdateInput,
  actor?: AuditionActor,
): Response {
  const previous = readAuditionRow(storage, auditionId);
  if (!previous) {
    return Response.json({ code: "audition_not_found" }, { status: 404 });
  }
  if (input.performanceId && !hasActivePerformance(storage, input.performanceId)) {
    return Response.json({ code: "performance_not_found" }, { status: 400 });
  }
  if (!auditionSlotsAreConfigured(storage, input.requestedSlots)) {
    return Response.json({ code: "invalid_audition_slot" }, { status: 400 });
  }
  const nextStatus = input.status ?? previous.status;
  const nextScheduledTime = input.scheduledTimeSlot ?? previous.scheduledTimeSlot;
  if (nextStatus === "scheduled" && !nextScheduledTime) {
    return Response.json({ code: "scheduled_time_required" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  const fields = auditionUpdateFields(input);
  updates.push(...fields.updates);
  params.push(...fields.params);
  params.push(auditionId);
  storage.transactionSync(() => {
    storage.sql.exec(`UPDATE auditions SET ${updates.join(", ")} WHERE id = ?`, ...params);
    recordAuditionUpdateSideEffects(storage, auditionId, input, previous, actor, now);
  });
  const row = readAuditionRow(storage, auditionId);
  return row
    ? responseForRow(storage, row)
    : Response.json({ code: "audition_not_found" }, { status: 404 });
}

export function deleteAuditionInStore(
  storage: DurableObjectStorage,
  auditionId: string,
  actor: AuditionActor,
): Response {
  if (!readAuditionRow(storage, auditionId)) {
    return Response.json({ code: "audition_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM auditions WHERE id = ?", auditionId);
    insertAudit(storage, actor, "audition.deleted", auditionId, {}, now);
  });
  return Response.json({ auditionId, status: "deleted" });
}

function hasActivePerformance(storage: DurableObjectStorage, performanceId: string): boolean {
  return (
    storage.sql
      .exec(
        "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 LIMIT 1",
        performanceId,
      )
      .toArray().length > 0
  );
}

function auditionUpdateFields(input: AuditionUpdateInput): {
  readonly params: readonly unknown[];
  readonly updates: readonly string[];
} {
  const fields: readonly [boolean, string, unknown][] = [
    [input.adminNotes !== undefined, "admin_notes = ?", input.adminNotes],
    [input.availabilityNotes !== undefined, "availability_notes = ?", input.availabilityNotes],
    [input.email !== undefined, "email = ?", input.email],
    [input.experience !== undefined, "experience = ?", input.experience],
    [input.name !== undefined, "name = ?", input.name],
    [input.performanceId !== undefined, "performance_id = ?", input.performanceId],
    [input.phone !== undefined, "phone = ?", input.phone],
    [
      input.requestedSlots !== undefined,
      "requested_slots_json = ?",
      input.requestedSlots === undefined ? undefined : JSON.stringify(input.requestedSlots),
    ],
    [input.scheduledTimeSlot !== undefined, "scheduled_time_slot = ?", input.scheduledTimeSlot],
    [input.voicePart !== undefined, "voice_part = ?", input.voicePart],
    [input.status !== undefined, "status = ?", input.status],
  ];
  const updates: string[] = [];
  const params: unknown[] = [];
  for (const [included, update, value] of fields) {
    if (included) {
      updates.push(update);
      params.push(value);
    }
  }
  return { params, updates };
}

function recordAuditionUpdateSideEffects(
  storage: DurableObjectStorage,
  auditionId: string,
  input: AuditionUpdateInput,
  previous: AuditionRow,
  actor: AuditionActor | undefined,
  now: string,
): void {
  if (actor) {
    insertAudit(
      storage,
      actor,
      "audition.updated",
      auditionId,
      { changedFields: Object.keys(input), status: input.status ?? null },
      now,
    );
  }
  const shouldNotify =
    input.status === "scheduled" &&
    (previous.status !== "scheduled" || input.scheduledTimeSlot !== undefined);
  if (!shouldNotify) return;
  const scheduledFor = input.scheduledTimeSlot ?? previous.scheduledTimeSlot ?? now;
  queueAuditionNotification(storage, {
    auditionId,
    contentMarkdown: `Your audition has been scheduled for ${scheduledFor}.`,
    dedupeKey: `audition-scheduled:${auditionId}:${scheduledFor}`,
    destination: input.email ?? previous.email,
    kind: "scheduled_confirmation",
    recipientName: input.name ?? previous.name,
    scheduledFor: now,
    subject: "Your audition is scheduled",
  });
}

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
  if (settings.defaultPerformanceId) {
    const performanceExists =
      storage.sql
        .exec(
          "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 LIMIT 1",
          settings.defaultPerformanceId,
        )
        .toArray().length > 0;
    if (!performanceExists) {
      return Response.json({ code: "performance_not_found" }, { status: 400 });
    }
  }
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET audition_settings_json = ?, updated_at = ?",
      JSON.stringify(settings),
      now,
    );
    insertAudit(
      storage,
      actor,
      "audition.settings_updated",
      organizationId,
      {
        enabled: settings.enabled,
        defaultPerformanceId: settings.defaultPerformanceId,
        slotCount: settings.slots.length,
      },
      now,
    );
  });
  return Response.json(settings);
}

export function updateAuditionCandidateInStore(
  storage: DurableObjectStorage,
  auditionId: string,
  availabilityNotes: string | undefined,
  voicePart: string | undefined,
): Response {
  return updateAuditionInStore(storage, auditionId, {
    ...(availabilityNotes === undefined ? {} : { availabilityNotes }),
    ...(voicePart === undefined ? {} : { voicePart }),
  });
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
      `SELECT id, destination, recipient_name AS recipientName, subject,
        content_markdown AS contentMarkdown, status
       FROM audition_notifications WHERE id = ? LIMIT 1`,
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
      provider_message_id = ?, failure_detail = ?, updated_at = ?,
      sent_at = CASE WHEN ? IN ('sent', 'suppressed') THEN ? ELSE sent_at END
     WHERE id = ?`,
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
