import type { DurableObjectStorage } from "@cloudflare/workers-types";

import { auditionSystemCommunicationTemplateIds } from "../schema";
import type {
  AuditionActor,
  AuditionCreateInput,
  AuditionRow,
  AuditionUpdateInput,
} from "./contracts";
import {
  auditionReminderDueAt,
  auditionSlotsAreConfigured,
  auditionTemplateValues,
  parseRequestedSlots,
  publicAuditionRosterOptions,
  renderAuditionSystemCommunication,
} from "./helpers";
import { queueAuditionNotification, queueCreateNotifications } from "./notifications";

export function readSlotsForAudition(
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

export function readAuditionRow(
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

export function responseForRow(storage: DurableObjectStorage, row: AuditionRow): Response {
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

export function publicResponseForRow(storage: DurableObjectStorage, row: AuditionRow): Response {
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

export function insertAudit(
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

export function updateAuditionResponseInStore(
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

export function hasActivePerformance(
  storage: DurableObjectStorage,
  performanceId: string,
): boolean {
  return (
    storage.sql
      .exec(
        "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0 LIMIT 1",
        performanceId,
      )
      .toArray().length > 0
  );
}

export function auditionUpdateFields(input: AuditionUpdateInput): {
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

export function recordAuditionUpdateSideEffects(
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
