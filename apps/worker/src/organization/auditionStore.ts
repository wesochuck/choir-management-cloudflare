import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  organizationAuditionSettingsSchema,
  organizationRosterConfigurationRequestSchema,
  publicAuditionSettingsSchema,
  type OrganizationAuditionSettings,
} from "@choir/contracts";
import { defaultRosterConfiguration, renderCommunicationTemplate } from "@choir/domain";
import { z } from "zod";

import {
  auditionSystemCommunicationTemplateIds,
  auditionSystemCommunicationTemplates,
} from "./schema";

const defaultAuditionSettings: OrganizationAuditionSettings = {
  adminNotifyEnabled: false,
  adminNotifyUsers: [],
  confirmationMessage: "Thank you for your interest. We will be in touch soon.",
  defaultPerformanceId: null,
  enabled: true,
  slots: [],
  venueId: null,
};

const publicAuditionRateLimitRequestSchema = z.object({
  clientKey: z.string().regex(/^[a-f0-9]{64}$/),
  emailKey: z.string().regex(/^[a-f0-9]{64}$/),
  organizationId: z.string().trim().min(1).max(128),
});

const publicAuditionRateLimits = [
  { durationMs: 10 * 60 * 1_000, key: "ip", limit: 10 },
  { durationMs: 24 * 60 * 60 * 1_000, key: "email", limit: 3 },
  { durationMs: 60 * 60 * 1_000, key: "organization", limit: 100 },
] as const;

export async function checkPublicAuditionInquiryRateLimit(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = publicAuditionRateLimitRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ code: "invalid_public_rate_limit_request" }, { status: 400 });
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const now = Date.now();
  const buckets = [
    ...publicAuditionRateLimits.map((limit) => ({
      ...limit,
      bucketKey:
        limit.key === "ip"
          ? `audition:ip:${parsed.data.clientKey}`
          : limit.key === "email"
            ? `audition:email:${parsed.data.emailKey}`
            : `audition:organization:${parsed.data.organizationId}`,
    })),
  ];
  const result = storage.transactionSync(() => {
    const existing = buckets.map((bucket) => ({
      ...bucket,
      row: storage.sql
        .exec<{ readonly requestCount: number; readonly windowStartedAt: number }>(
          `SELECT request_count AS requestCount, window_started_at AS windowStartedAt
           FROM public_rate_limit_buckets WHERE bucket_key = ? LIMIT 1`,
          bucket.bucketKey,
        )
        .toArray()
        .at(0),
    }));
    const retryAfterSeconds = existing.reduce((retryAfter, bucket) => {
      if (!bucket.row || now - bucket.row.windowStartedAt >= bucket.durationMs) return retryAfter;
      if (bucket.row.requestCount < bucket.limit) return retryAfter;
      return Math.max(
        retryAfter,
        Math.ceil((bucket.durationMs - (now - bucket.row.windowStartedAt)) / 1_000),
      );
    }, 0);
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };
    for (const bucket of existing) {
      const active = bucket.row && now - bucket.row.windowStartedAt < bucket.durationMs;
      if (active) {
        storage.sql.exec(
          `UPDATE public_rate_limit_buckets
           SET request_count = request_count + 1 WHERE bucket_key = ?`,
          bucket.bucketKey,
        );
      } else {
        storage.sql.exec(
          `INSERT INTO public_rate_limit_buckets (bucket_key, window_started_at, request_count)
           VALUES (?, ?, 1)
           ON CONFLICT(bucket_key) DO UPDATE SET window_started_at = excluded.window_started_at,
             request_count = excluded.request_count`,
          bucket.bucketKey,
          now,
        );
      }
    }
    storage.sql.exec(
      "DELETE FROM public_rate_limit_buckets WHERE window_started_at < ?",
      now - 24 * 60 * 60 * 1_000,
    );
    return { allowed: true, retryAfterSeconds: 0 };
  });
  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        code: "public_rate_limit_exceeded",
        retryAfterSeconds: result.retryAfterSeconds,
      }),
      {
        headers: {
          "content-type": "application/json",
          "retry-after": String(result.retryAfterSeconds),
        },
        status: 429,
      },
    );
  }
  return Response.json({ allowed: true });
}

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
  readonly auditionId: string;
  readonly contentMarkdown: string;
  readonly destination: string;
  readonly id: string;
  readonly kind:
    "inquiry_confirmation" | "scheduled_confirmation" | "audition_reminder" | "admin_alert";
  readonly recipientName: string;
  readonly status: string;
  readonly subject: string;
  readonly providerEventAt: string | null;
  readonly providerMessageId: string | null;
  readonly providerReason: string;
  readonly providerStatus: string | null;
}

interface AuditionNotificationResult {
  readonly failureDetail: string;
  readonly jobId: string;
  readonly providerMessageId: string | null;
  readonly status: "failed" | "sent" | "suppressed";
}

interface AuditionSystemCommunicationTemplate {
  readonly [column: string]: SqlStorageValue;
  readonly contentMarkdown: string;
  readonly subject: string;
}

const AUDITION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1_000;

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

function publicAuditionRosterOptions(storage: DurableObjectStorage): {
  readonly performerLabel: string;
  readonly sections: readonly { readonly code: string; readonly name: string }[];
  readonly voiceParts: readonly {
    readonly fullName: string;
    readonly label: string;
    readonly sectionCode: string;
  }[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(
      storage.sql
        .exec<{ readonly configuration: string }>(
          "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
        )
        .one().configuration,
    ) as unknown;
  } catch {
    raw = defaultRosterConfiguration;
  }
  const parsed = organizationRosterConfigurationRequestSchema.safeParse(raw);
  const configuration = parsed.success
    ? parsed.data
    : organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  const sections = configuration.sections
    .filter(({ trackOnly }) => !trackOnly)
    .map(({ code, name }) => ({ code, name }));
  const sectionCodes = new Set(sections.map(({ code }) => code));
  const voiceParts = configuration.voiceParts
    .filter(({ sectionCode }) => sectionCodes.has(sectionCode))
    .map(({ fullName, label, sectionCode }) => ({ fullName, label, sectionCode }));
  return { performerLabel: configuration.performerLabel, sections, voiceParts };
}

function readAuditionSystemCommunicationTemplate(
  storage: DurableObjectStorage,
  templateId: string,
): AuditionSystemCommunicationTemplate {
  const stored = storage.sql
    .exec<AuditionSystemCommunicationTemplate>(
      `SELECT content_markdown AS contentMarkdown, subject
       FROM communication_templates
       WHERE id = ? AND is_system = 1 AND channel = 'Email'
       LIMIT 1`,
      templateId,
    )
    .toArray()
    .at(0);
  if (stored) return stored;
  const fallback = auditionSystemCommunicationTemplates.find(({ id }) => id === templateId);
  return fallback ?? auditionSystemCommunicationTemplates[0];
}

function auditionTemplateValues(
  storage: DurableObjectStorage,
  scheduledAt: string,
): Readonly<Record<string, string>> {
  const organization = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .toArray()
    .at(0);
  const settings = storedAuditionSettings(storage);
  const venue = settings.venueId
    ? storage.sql
        .exec<{ readonly address: string; readonly name: string }>(
          "SELECT address, name FROM venues WHERE id = ? LIMIT 1",
          settings.venueId,
        )
        .toArray()
        .at(0)
    : undefined;
  const date = new Date(scheduledAt);
  const validDate = !Number.isNaN(date.getTime());
  let timezone = "UTC";
  if (organization?.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: organization.timezone }).format(date);
      timezone = organization.timezone;
    } catch {
      // Fall back to UTC if an older Organization contains an invalid timezone value.
    }
  }
  const auditionDate = validDate
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: timezone }).format(date)
    : scheduledAt;
  const auditionTime = validDate
    ? new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: timezone }).format(date)
    : scheduledAt;
  const auditionLocation = venue
    ? [venue.name, venue.address].filter((value) => value.trim().length > 0).join(", ")
    : "the audition venue";
  return {
    auditionDate,
    auditionDateTime: `${auditionDate} at ${auditionTime}`,
    auditionLocation,
    auditionTime,
  };
}

function renderAuditionSystemCommunication(
  storage: DurableObjectStorage,
  templateId: string,
  recipientName: string,
  values: Readonly<Record<string, string>> = {},
): AuditionSystemCommunicationTemplate {
  const template = readAuditionSystemCommunicationTemplate(storage, templateId);
  return {
    contentMarkdown: renderCommunicationTemplate(template.contentMarkdown, recipientName, values),
    subject: renderCommunicationTemplate(template.subject, recipientName, values),
  };
}

function auditionReminderDueAt(scheduledAt: string, now: string): string {
  const scheduledAtMs = new Date(scheduledAt).getTime();
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(scheduledAtMs) || Number.isNaN(nowMs)) return now;
  return new Date(Math.max(nowMs, scheduledAtMs - AUDITION_REMINDER_LEAD_MS)).toISOString();
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
    readonly kind:
      "inquiry_confirmation" | "scheduled_confirmation" | "audition_reminder" | "admin_alert";
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
  const message = renderAuditionSystemCommunication(
    storage,
    auditionSystemCommunicationTemplateIds.submission,
    name,
  );
  queueAuditionNotification(storage, {
    auditionId,
    contentMarkdown: message.contentMarkdown,
    dedupeKey: `audition-confirmation:${auditionId}`,
    destination: email,
    kind: "inquiry_confirmation",
    recipientName: name,
    scheduledFor: now,
    subject: message.subject,
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

function publicResponseForRow(storage: DurableObjectStorage, row: AuditionRow): Response {
  const rosterOptions = publicAuditionRosterOptions(storage);
  return Response.json({
    availabilityNotes: row.availabilityNotes || undefined,
    createdAt: row.createdAt,
    id: row.id,
    name: row.name,
    performerLabel: rosterOptions.performerLabel,
    requestedSlots: parseRequestedSlots(row.requestedSlotsJson),
    scheduledTimeSlot: row.scheduledTimeSlot,
    slots: readSlotsForAudition(storage, row.id),
    status: row.status,
    updatedAt: row.updatedAt,
    voicePart: row.voicePart || undefined,
  });
}

export function readPublicAuditionFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  auditionId: string,
): Response {
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  const row = readAuditionRow(storage, auditionId);
  return !organizationId || identity !== organizationId || !row
    ? Response.json({ code: "audition_not_found" }, { status: 404 })
    : publicResponseForRow(storage, row);
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
  return updateAuditionResponseInStore(storage, auditionId, input, actor, "admin");
}

export function updatePublicAuditionInStore(
  storage: DurableObjectStorage,
  auditionId: string,
  input: Pick<AuditionUpdateInput, "availabilityNotes" | "voicePart">,
): Response {
  return updateAuditionResponseInStore(storage, auditionId, input, undefined, "public");
}

function updateAuditionResponseInStore(
  storage: DurableObjectStorage,
  auditionId: string,
  input: AuditionUpdateInput,
  actor: AuditionActor | undefined,
  responseMode: "admin" | "public",
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
    ? responseMode === "public"
      ? publicResponseForRow(storage, row)
      : responseForRow(storage, row)
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
        "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0 LIMIT 1",
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
  const values = auditionTemplateValues(storage, scheduledFor);
  const confirmation = renderAuditionSystemCommunication(
    storage,
    auditionSystemCommunicationTemplateIds.confirmation,
    input.name ?? previous.name,
    values,
  );
  queueAuditionNotification(storage, {
    auditionId,
    contentMarkdown: confirmation.contentMarkdown,
    dedupeKey: `audition-scheduled:${auditionId}:${scheduledFor}`,
    destination: input.email ?? previous.email,
    kind: "scheduled_confirmation",
    recipientName: input.name ?? previous.name,
    scheduledFor: now,
    subject: confirmation.subject,
  });
  const reminder = renderAuditionSystemCommunication(
    storage,
    auditionSystemCommunicationTemplateIds.reminder,
    input.name ?? previous.name,
    values,
  );
  queueAuditionNotification(storage, {
    auditionId,
    contentMarkdown: reminder.contentMarkdown,
    dedupeKey: `audition-reminder:${auditionId}:${scheduledFor}`,
    destination: input.email ?? previous.email,
    kind: "audition_reminder",
    recipientName: input.name ?? previous.name,
    scheduledFor: auditionReminderDueAt(scheduledFor, now),
    subject: reminder.subject,
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
  const venue = settings.venueId
    ? storage.sql
        .exec<{ readonly address: string; readonly name: string }>(
          "SELECT address, name FROM venues WHERE id = ? LIMIT 1",
          settings.venueId,
        )
        .toArray()
        .at(0)
    : undefined;
  const rosterOptions = publicAuditionRosterOptions(storage);
  const publicSettings = publicAuditionSettingsSchema.parse({
    confirmationMessage: settings.confirmationMessage,
    defaultPerformanceId: settings.defaultPerformanceId,
    enabled: settings.enabled,
    performerLabel: rosterOptions.performerLabel,
    performance: performance ?? null,
    sections: rosterOptions.sections,
    slots: settings.slots,
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
  if (!settings.venueId) {
    return Response.json({ code: "venue_required" }, { status: 400 });
  }
  const venueExists =
    storage.sql.exec("SELECT 1 FROM venues WHERE id = ? LIMIT 1", settings.venueId).toArray()
      .length > 0;
  if (!venueExists) {
    return Response.json({ code: "venue_not_found" }, { status: 400 });
  }
  if (settings.defaultPerformanceId) {
    const performanceExists =
      storage.sql
        .exec(
          "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0 LIMIT 1",
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
        venueId: settings.venueId,
      },
      now,
    );
  });
  return Response.json(settings);
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
        audition_id AS auditionId, kind, content_markdown AS contentMarkdown, status,
        provider_event_at AS providerEventAt, provider_message_id AS providerMessageId,
        provider_reason AS providerReason, provider_status AS providerStatus
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
