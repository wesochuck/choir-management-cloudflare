import {
  communicationAudienceRequestSchema,
  communicationDeliverySummarySchema,
  communicationDraftRequestSchema,
  communicationMessageSchema,
  communicationSendRequestSchema,
  communicationTemplateRequestSchema,
  communicationTemplateSchema,
  organizationRosterConfigurationRequestSchema,
} from "@choir/contracts";
import {
  communicationReach,
  summarizeCommunicationDeliveries,
  type DeliveryRecord,
} from "@choir/domain";
import { z } from "zod";

const contextSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});
const audienceOperationSchema = contextSchema.pick({ organizationId: true }).extend({
  audience: communicationAudienceRequestSchema,
});
const recipientSchema = z.object({
  email: z.string().max(320),
  name: z.string().min(1).max(200),
  phone: z.string().max(40),
  profileId: z.uuid(),
});
const saveOperationSchema = contextSchema.extend({
  action: z.literal("save-draft"),
  message: communicationDraftRequestSchema,
  messageId: z.uuid(),
  reach: z.object({
    both: z.number().int().nonnegative(),
    email: z.number().int().nonnegative(),
    sms: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    unreachable: z.number().int().nonnegative(),
  }),
});
const sendOperationSchema = contextSchema.extend({
  action: z.literal("send"),
  jobId: z.uuid(),
  message: communicationSendRequestSchema,
  messageId: z.uuid(),
  recipients: z.array(recipientSchema).max(500),
});
const retryOperationSchema = contextSchema.extend({
  action: z.literal("retry"),
  jobId: z.uuid(),
  messageId: z.uuid(),
});
const saveTemplateOperationSchema = contextSchema.extend({
  action: z.literal("save-template"),
  template: communicationTemplateRequestSchema,
  templateId: z.uuid(),
});
const deleteTemplateOperationSchema = contextSchema.extend({
  action: z.literal("delete-template"),
  templateId: z.uuid(),
});
const deleteDraftOperationSchema = contextSchema.extend({
  action: z.literal("delete-draft"),
  messageId: z.uuid(),
});
const deliveryResultOperationSchema = z.object({
  action: z.literal("delivery-result"),
  jobId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  results: z
    .array(
      z.object({
        deliveryId: z.uuid(),
        failureDetail: z.string().max(4_000),
        providerMessageId: z.string().max(500).nullable(),
        status: z.enum(["failed", "sent", "suppressed"]),
      }),
    )
    .max(1_000),
});
const operationSchema = z.discriminatedUnion("action", [
  saveOperationSchema,
  sendOperationSchema,
  retryOperationSchema,
  saveTemplateOperationSchema,
  deleteTemplateOperationSchema,
  deleteDraftOperationSchema,
  deliveryResultOperationSchema,
]);

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}
interface CandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string;
  readonly doNotEmail: number;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly id: string;
  readonly phone: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly voicePart: string;
}
interface ConfigurationRow {
  readonly [column: string]: SqlStorageValue;
  readonly rosterConfigurationJson: string;
}
interface MessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly audienceJson: string;
  readonly channel: "Both" | "Email" | "SMS";
  readonly contentMarkdown: string;
  readonly createdAt: string;
  readonly id: string;
  readonly reachJson: string;
  readonly sentAt: string | null;
  readonly status: "Draft" | "Failed" | "Queued" | "Sent";
  readonly subject: string;
  readonly updatedAt: string;
}
interface DeliveryRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempts: number;
  readonly channel: "email" | "sms";
  readonly destination: string;
  readonly failureDetail: string;
  readonly id: string;
  readonly messageId: string;
  readonly recipientName: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly updatedAt: string;
}
interface TemplateRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: "Both" | "Email" | "SMS";
  readonly contentMarkdown: string;
  readonly createdAt: string;
  readonly id: string;
  readonly isSystem: number;
  readonly subject: string;
  readonly title: string;
  readonly updatedAt: string;
}

const messageColumns = `id, channel, status, subject, content_markdown AS contentMarkdown,
  audience_json AS audienceJson, reach_json AS reachJson, created_at AS createdAt,
  updated_at AS updatedAt, sent_at AS sentAt`;

function identityMatches(storage: DurableObjectStorage, organizationId: string): boolean {
  return (
    storage.sql
      .exec<IdentityRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId === organizationId
  );
}

function parseMessage(row: MessageRow) {
  return communicationMessageSchema.parse({
    ...row,
    audience: JSON.parse(row.audienceJson) as unknown,
    reach: JSON.parse(row.reachJson) as unknown,
  });
}

function readMessage(storage: DurableObjectStorage, messageId: string) {
  const row = storage.sql
    .exec<MessageRow>(
      `SELECT ${messageColumns} FROM communication_messages WHERE id = ? LIMIT 1`,
      messageId,
    )
    .toArray()
    .at(0);
  return row ? parseMessage(row) : null;
}

function audit(
  storage: DurableObjectStorage,
  actorUserId: string,
  requestId: string,
  action: string,
  targetId: string,
  summary: unknown,
  occurredAt: string,
  targetType = "communication_message",
): void {
  storage.sql.exec(
    `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
      request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, ?, ?, ?, ?, ?)`,
    `communication:${action}:${requestId}`,
    actorUserId,
    action,
    targetType,
    targetId,
    requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

function allowedVoiceParts(
  storage: DurableObjectStorage,
  requested: readonly string[],
): Set<string> | null {
  if (requested.length === 0) return null;
  const row = storage.sql
    .exec<ConfigurationRow>(
      "SELECT roster_configuration_json AS rosterConfigurationJson FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  const configuration = organizationRosterConfigurationRequestSchema.parse(
    JSON.parse(row?.rosterConfigurationJson ?? "null") as unknown,
  );
  const sections = new Map(configuration.sections.map((section) => [section.code, section]));
  const result = new Set<string>();
  for (const token of requested) {
    if (sections.has(token)) {
      for (const part of configuration.voiceParts) {
        if (part.sectionCode === token) result.add(part.label);
      }
    } else {
      result.add(token);
    }
  }
  return result;
}

function trackOnlyVoiceParts(storage: DurableObjectStorage): Set<string> {
  const row = storage.sql
    .exec<ConfigurationRow>(
      "SELECT roster_configuration_json AS rosterConfigurationJson FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  const configuration = organizationRosterConfigurationRequestSchema.parse(
    JSON.parse(row?.rosterConfigurationJson ?? "null") as unknown,
  );
  const trackOnlySections = new Set(
    configuration.sections.filter(({ trackOnly }) => trackOnly).map(({ code }) => code),
  );
  return new Set(
    configuration.voiceParts
      .filter(({ sectionCode }) => trackOnlySections.has(sectionCode))
      .map(({ label }) => label),
  );
}

export async function resolveCommunicationAudienceFromStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = audienceOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_communication_audience" }, { status: 400 });
  const { audience, organizationId } = parsed.data;
  if (!identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const rows = storage.sql
    .exec<CandidateRow>(
      `SELECT p.id, p.display_name AS displayName, p.phone, p.voice_part AS voicePart,
        p.global_status AS globalStatus, p.do_not_email AS doNotEmail,
        COALESCE(r.rsvp, 'Pending') AS rsvp
       FROM profiles p
       LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
       ORDER BY p.display_name COLLATE NOCASE, p.id LIMIT 500`,
      audience.eventId ?? "",
    )
    .toArray();
  const requestedProfiles = audience.profileIds.length > 0 ? new Set(audience.profileIds) : null;
  const requestedVoiceParts = allowedVoiceParts(storage, audience.voiceParts);
  const excludedVoiceParts = trackOnlyVoiceParts(storage);
  const statuses = new Set(audience.globalStatuses);
  const recipients = rows
    .filter(({ id }) => !requestedProfiles || requestedProfiles.has(id))
    .filter(({ globalStatus }) => statuses.has(globalStatus))
    .filter(({ voicePart }) => voicePart.length > 0 && !excludedVoiceParts.has(voicePart))
    .filter(({ voicePart }) => !requestedVoiceParts || requestedVoiceParts.has(voicePart))
    .filter(({ rsvp }) => !audience.eventId || audience.rsvp === "All" || audience.rsvp === rsvp)
    .map(({ displayName, doNotEmail, id, phone, voicePart }) => ({
      displayName,
      doNotEmail: doNotEmail === 1,
      phone,
      profileId: id,
      voicePart,
    }));
  return Response.json({ recipients });
}

function deliveryRows(
  message: z.infer<typeof communicationSendRequestSchema>,
  recipients: readonly z.infer<typeof recipientSchema>[],
  messageId: string,
  now: string,
) {
  return recipients.flatMap((recipient) => {
    const values: { channel: "email" | "sms"; destination: string }[] = [];
    if (message.channel !== "SMS" && recipient.email) {
      values.push({ channel: "email", destination: recipient.email });
    }
    if (message.channel !== "Email" && recipient.phone) {
      values.push({ channel: "sms", destination: recipient.phone });
    }
    return values.map((value) => ({
      ...value,
      id: crypto.randomUUID(),
      messageId,
      now,
      recipient,
    }));
  });
}

async function sendMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
  now: string,
): Promise<Response> {
  const reach = communicationReach(operation.recipients, operation.message.channel);
  if (reach.total === 0)
    return Response.json({ code: "communication_has_no_recipients" }, { status: 409 });
  const deliveries = deliveryRows(
    operation.message,
    operation.recipients,
    operation.messageId,
    now,
  );
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO communication_messages
        (id, channel, status, subject, content_markdown, audience_json, reach_json,
         created_by, created_at, updated_at, queued_at)
       VALUES (?, ?, 'Queued', ?, ?, ?, ?, ?, ?, ?, ?)`,
      operation.messageId,
      operation.message.channel,
      operation.message.subject,
      operation.message.contentMarkdown,
      JSON.stringify(operation.message.audience),
      JSON.stringify(reach),
      operation.actorUserId,
      now,
      now,
      now,
    );
    for (const delivery of deliveries) {
      storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        delivery.id,
        delivery.messageId,
        delivery.recipient.profileId,
        delivery.recipient.name,
        delivery.channel,
        delivery.destination,
        delivery.now,
        delivery.now,
      );
    }
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'communication_delivery', ?, ?, ?)`,
      operation.jobId,
      `communication:${operation.messageId}:initial`,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.queued",
      operation.messageId,
      { channel: operation.message.channel, deliveryCount: deliveries.length, reach },
      now,
    );
  });
  await storage.setAlarm(Date.now() + 1);
  return Response.json(readMessage(storage, operation.messageId));
}

function saveDraft(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveOperationSchema>,
  now: string,
): Response {
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO communication_messages
        (id, channel, status, subject, content_markdown, audience_json, reach_json,
         created_by, created_at, updated_at)
       VALUES (?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?)`,
      operation.messageId,
      operation.message.channel,
      operation.message.subject,
      operation.message.contentMarkdown,
      JSON.stringify(operation.message.audience),
      JSON.stringify(operation.reach),
      operation.actorUserId,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.draft.saved",
      operation.messageId,
      { channel: operation.message.channel },
      now,
    );
  });
  return Response.json(readMessage(storage, operation.messageId));
}

function saveTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveTemplateOperationSchema>,
  now: string,
): Response {
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      operation.templateId,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.saved",
      operation.templateId,
      { channel: operation.template.channel, title: operation.template.title },
      now,
      "communication_template",
    );
  });
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      operation.templateId,
    )
    .one();
  return Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
}

function deleteTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteTemplateOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly isSystem: number }>(
      "SELECT is_system AS isSystem FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  if (found.isSystem === 1)
    return Response.json({ code: "communication_system_template_protected" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM communication_templates WHERE id = ?", operation.templateId);
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.deleted",
      operation.templateId,
      {},
      now,
      "communication_template",
    );
  });
  return Response.json({ id: operation.templateId, status: "deleted" });
}

function deleteDraft(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteDraftOperationSchema>,
  now: string,
): Response {
  const message = readMessage(storage, operation.messageId);
  if (message?.status !== "Draft")
    return Response.json({ code: "communication_draft_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM communication_messages WHERE id = ?", operation.messageId);
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.draft.deleted",
      operation.messageId,
      {},
      now,
    );
  });
  return Response.json({ id: operation.messageId, status: "deleted" });
}

async function retryMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof retryOperationSchema>,
  now: string,
): Promise<Response> {
  const message = readMessage(storage, operation.messageId);
  if (!message || message.status === "Draft")
    return Response.json({ code: "communication_message_not_found" }, { status: 404 });
  const failed = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM communication_deliveries WHERE message_id = ? AND status = 'failed'",
      operation.messageId,
    )
    .one().count;
  if (failed === 0)
    return Response.json({ code: "communication_has_no_failed_deliveries" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_deliveries SET status = 'queued', failure_detail = '', updated_at = ?
       WHERE message_id = ? AND status = 'failed'`,
      now,
      operation.messageId,
    );
    storage.sql.exec(
      "UPDATE communication_messages SET status = 'Queued', updated_at = ? WHERE id = ?",
      now,
      operation.messageId,
    );
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'communication_delivery', ?, ?, ?)`,
      operation.jobId,
      `communication:${operation.messageId}:retry:${operation.requestId}`,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.retry.queued",
      operation.messageId,
      { deliveryCount: failed },
      now,
    );
  });
  await storage.setAlarm(Date.now() + 1);
  return Response.json({ messageId: operation.messageId, retried: failed });
}

function recordDeliveryResults(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deliveryResultOperationSchema>,
  now: string,
): Response {
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'communication_delivery' LIMIT 1`,
      operation.jobId,
    )
    .toArray()
    .at(0);
  if (!job) return Response.json({ code: "communication_job_not_found" }, { status: 404 });
  const messageId = job.idempotencyKey.split(":")[1];
  if (!messageId) return Response.json({ code: "communication_job_invalid" }, { status: 409 });
  storage.transactionSync(() => {
    for (const result of operation.results) {
      storage.sql.exec(
        `UPDATE communication_deliveries
         SET status = ?, attempts = attempts + 1, provider_message_id = ?, failure_detail = ?,
           last_attempt_at = ?, updated_at = ?
         WHERE id = ? AND message_id = ? AND status IN ('queued', 'processing')`,
        result.status,
        result.providerMessageId,
        result.failureDetail,
        now,
        now,
        result.deliveryId,
        messageId,
      );
    }
    const counts = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly failed: number;
        readonly remaining: number;
        readonly sent: number;
      }>(
        `SELECT SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS remaining,
          SUM(CASE WHEN status IN ('sent', 'suppressed') THEN 1 ELSE 0 END) AS sent
         FROM communication_deliveries WHERE message_id = ?`,
        messageId,
      )
      .one();
    const status = counts.remaining > 0 ? "Queued" : counts.sent > 0 ? "Sent" : "Failed";
    storage.sql.exec(
      `UPDATE communication_messages SET status = ?, sent_at = CASE WHEN ? = 'Sent' THEN ? ELSE sent_at END,
        updated_at = ? WHERE id = ?`,
      status,
      status,
      now,
      now,
      messageId,
    );
  });
  return Response.json({ recorded: true });
}

export async function manageCommunicationInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = operationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_communication_operation" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  if (operation.action === "send") return sendMessage(storage, operation, now);
  if (operation.action === "save-draft") return saveDraft(storage, operation, now);
  if (operation.action === "retry") return retryMessage(storage, operation, now);
  if (operation.action === "save-template") return saveTemplate(storage, operation, now);
  if (operation.action === "delete-template") return deleteTemplate(storage, operation, now);
  if (operation.action === "delete-draft") return deleteDraft(storage, operation, now);
  return recordDeliveryResults(storage, operation, now);
}

export function listCommunicationMessagesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const messages = storage.sql
    .exec<MessageRow>(
      `SELECT ${messageColumns} FROM communication_messages
       ORDER BY created_at DESC, id DESC LIMIT 100`,
    )
    .toArray()
    .map(parseMessage);
  return Response.json({ messages });
}

export function listCommunicationTemplatesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const templates = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates ORDER BY is_system DESC, title COLLATE NOCASE, id LIMIT 200`,
    )
    .toArray()
    .map((row) => communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
  return Response.json({ templates });
}

export function readCommunicationSummaryFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  messageId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const parsedMessageId = z.uuid().safeParse(messageId);
  if (!parsedMessageId.success || !readMessage(storage, parsedMessageId.data))
    return Response.json({ code: "communication_message_not_found" }, { status: 404 });
  const records: DeliveryRecord[] = storage.sql
    .exec<DeliveryRow>(
      `SELECT id, message_id AS messageId, recipient_name AS recipientName, channel, destination,
        status, attempts, failure_detail AS failureDetail, updated_at AS updatedAt
       FROM communication_deliveries WHERE message_id = ? ORDER BY id LIMIT 10000`,
      parsedMessageId.data,
    )
    .toArray();
  return Response.json(
    communicationDeliverySummarySchema.parse(
      summarizeCommunicationDeliveries(parsedMessageId.data, records),
    ),
  );
}

export function readCommunicationJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const parsedJobId = z.uuid().safeParse(jobId);
  if (!parsedJobId.success)
    return Response.json({ code: "communication_job_not_found" }, { status: 404 });
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'communication_delivery' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const messageId = job?.idempotencyKey.split(":")[1];
  if (!messageId) return Response.json({ code: "communication_job_not_found" }, { status: 404 });
  const message = readMessage(storage, messageId);
  const deliveries = storage.sql
    .exec<DeliveryRow>(
      `SELECT id, message_id AS messageId, recipient_name AS recipientName, channel, destination,
        status, attempts, failure_detail AS failureDetail, updated_at AS updatedAt
       FROM communication_deliveries WHERE message_id = ? AND status = 'queued'
       ORDER BY id LIMIT 1000`,
      messageId,
    )
    .toArray()
    .map(({ channel, destination, id, recipientName }) => ({
      channel,
      destination,
      id,
      recipientName,
    }));
  return message
    ? Response.json({
        contentMarkdown: message.contentMarkdown,
        deliveries,
        messageId,
        subject: message.subject,
      })
    : Response.json({ code: "communication_message_not_found" }, { status: 404 });
}
