import {
  communicationAudienceRequestSchema,
  communicationDeliverySummarySchema,
  communicationDraftRequestSchema,
  communicationMessageSchema,
  communicationScheduledMessageSchema,
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

const MAX_COMMUNICATION_DELIVERIES = 1_000;

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
  unsubscribeUrl: z.url().max(4_096).nullable(),
});
const unsubscribeOperationSchema = z.object({
  organizationId: z.string().min(1).max(128),
  profileId: z.uuid(),
  requestId: z.uuid(),
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
const sendOperationSchema = contextSchema
  .extend({
    action: z.literal("send"),
    actorType: z
      .enum(["organization_member", "organization_system"])
      .default("organization_member"),
    jobId: z.uuid(),
    dedupeKey: z.string().trim().min(1).max(256).optional(),
    message: communicationSendRequestSchema,
    messageId: z.uuid(),
    recipients: z.array(recipientSchema).max(500),
  })
  .superRefine((value, refinementContext) => {
    const deliveryCount = value.recipients.reduce(
      (count, recipient) =>
        count +
        (value.message.channel !== "SMS" && recipient.email ? 1 : 0) +
        (value.message.channel !== "Email" && recipient.phone ? 1 : 0),
      0,
    );
    if (deliveryCount > MAX_COMMUNICATION_DELIVERIES) {
      refinementContext.addIssue({
        code: "too_big",
        maximum: MAX_COMMUNICATION_DELIVERIES,
        origin: "number",
        path: ["recipients"],
        type: "number",
        inclusive: true,
        message: "A communication cannot contain more than 1,000 deliveries.",
      });
    }
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
const updateTemplateOperationSchema = contextSchema.extend({
  action: z.literal("update-template"),
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
  updateTemplateOperationSchema,
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
  readonly email: string;
  readonly emailSuppressed: number;
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

interface MemberBulletinRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentMarkdown: string;
  readonly id: string;
  readonly sentAt: string;
  readonly subject: string;
}
interface DeliveryRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempts: number;
  readonly channel: "email" | "sms";
  readonly destination: string;
  readonly failureDetail: string;
  readonly id: string;
  readonly messageId: string;
  readonly profileId: string;
  readonly providerEventAt: string | null;
  readonly providerReason: string;
  readonly providerStatus:
    "accepted" | "bounced" | "complained" | "deferred" | "delivered" | "failed" | "rejected" | null;
  readonly recipientName: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly unsubscribeUrl: string | null;
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

function setListTitles(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return "";
    return parsed
      .map((item: unknown) => {
        if (typeof item !== "object" || item === null) return "";
        const title = (item as { readonly title?: unknown }).title;
        return typeof title === "string" ? title.trim() : "";
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function eventCommunicationContext(storage: DurableObjectStorage, eventId: string | null) {
  if (!eventId) return null;
  const event = storage.sql
    .exec<{
      readonly callTime: string;
      readonly details: string;
      readonly eventDate: string;
      readonly eventLocation: string;
      readonly eventTitle: string;
      readonly eventType: string;
      readonly setListJson: string;
    }>(
      `SELECT e.title AS eventTitle, e.type AS eventType, e.starts_at AS eventDate,
        e.call_time AS callTime, e.details, COALESCE(v.name, e.location) AS eventLocation,
        e.set_list_json AS setListJson
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? AND e.is_archived = 0 AND e.is_canceled = 0 LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
  if (!event) return null;
  return {
    eventId,
    eventCallTime: event.callTime,
    eventDate: new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(event.eventDate)),
    eventDetails: event.details,
    eventLocation: event.eventLocation,
    eventTitle: event.eventTitle,
    eventType: event.eventType,
    setlist: setListTitles(event.setListJson),
  };
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
  actorType: "organization_member" | "organization_system" = "organization_member",
): void {
  storage.sql.exec(
    `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
      request_id, change_summary, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `communication:${action}:${requestId}`,
    actorType,
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

interface CommerceCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly id: string;
  readonly phone: string;
}

function commerceRecipients(
  storage: DurableObjectStorage,
  audience: z.infer<typeof communicationAudienceRequestSchema>,
): readonly {
  readonly displayName: string;
  readonly doNotEmail: boolean;
  readonly email: string;
  readonly emailSuppressed: boolean;
  readonly phone: string;
  readonly profileId: string;
  readonly voicePart: string;
}[] {
  const recipients: {
    readonly displayName: string;
    readonly doNotEmail: boolean;
    readonly email: string;
    readonly emailSuppressed: boolean;
    readonly phone: string;
    readonly profileId: string;
    readonly voicePart: string;
  }[] = [];
  const seenEmails = new Set<string>();
  const add = (row: CommerceCandidateRow, voicePart: "Donor" | "Ticket Buyer") => {
    const email = row.buyerEmail.trim().toLowerCase();
    if (!email || seenEmails.has(email)) return;
    seenEmails.add(email);
    recipients.push({
      displayName: row.buyerName,
      doNotEmail: false,
      email: row.buyerEmail,
      emailSuppressed: false,
      phone: row.phone,
      profileId: row.id,
      voicePart,
    });
  };

  if (audience.targetAudiences.includes("Ticket Buyers")) {
    const ticketRows = storage.sql
      .exec<CommerceCandidateRow>(
        `SELECT p.id, p.buyer_name AS buyerName, p.buyer_email AS buyerEmail, '' AS phone
         FROM ticket_purchases p
         WHERE p.status = 'paid'
           AND (
             (? <> '' AND (p.event_id = ? OR p.id IN (
               SELECT purchase_id FROM ticket_bundle_allocations WHERE event_id = ?
             )))
             OR (? = '' AND p.marketing_opt_in = 1)
           )
         ORDER BY p.buyer_name COLLATE NOCASE, p.id LIMIT 500`,
        audience.eventId ?? "",
        audience.eventId ?? "",
        audience.eventId ?? "",
        audience.eventId ?? "",
      )
      .toArray();
    ticketRows.forEach((row) => {
      add(row, "Ticket Buyer");
    });
  }

  if (audience.targetAudiences.includes("Donors")) {
    const donorRows = storage.sql
      .exec<CommerceCandidateRow>(
        `SELECT d.id, d.buyer_name AS buyerName, d.buyer_email AS buyerEmail, '' AS phone
         FROM donations d
         WHERE d.status = 'paid' AND d.marketing_consent = 1
         ORDER BY d.buyer_name COLLATE NOCASE, d.id LIMIT 500`,
      )
      .toArray();
    donorRows.forEach((row) => {
      add(row, "Donor");
    });
  }

  return recipients;
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
  const rows = audience.targetAudiences.includes("Members")
    ? storage.sql
        .exec<CandidateRow>(
          `SELECT p.id, p.display_name AS displayName, NULL AS email, p.phone,
              p.voice_part AS voicePart, p.global_status AS globalStatus, p.do_not_email AS doNotEmail,
              EXISTS (
                SELECT 1 FROM communication_suppressions s
                WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
              ) AS emailSuppressed,
              COALESCE(r.rsvp, 'Pending') AS rsvp
             FROM profiles p
             LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
             ORDER BY p.display_name COLLATE NOCASE, p.id LIMIT 500`,
          audience.eventId ?? "",
        )
        .toArray()
    : [];
  const requestedProfiles = audience.profileIds.length > 0 ? new Set(audience.profileIds) : null;
  const requestedVoiceParts = allowedVoiceParts(storage, audience.voiceParts);
  const excludedVoiceParts = trackOnlyVoiceParts(storage);
  const statuses = new Set(audience.globalStatuses);
  const recipients: {
    readonly displayName: string;
    readonly doNotEmail: boolean;
    readonly email: string;
    readonly emailSuppressed: boolean;
    readonly phone: string;
    readonly profileId: string;
    readonly voicePart: string;
  }[] = rows
    .filter(({ id }) => !requestedProfiles || requestedProfiles.has(id))
    .filter(({ globalStatus }) => statuses.has(globalStatus))
    .filter(({ voicePart }) => voicePart.length > 0 && !excludedVoiceParts.has(voicePart))
    .filter(({ voicePart }) => !requestedVoiceParts || requestedVoiceParts.has(voicePart))
    .filter(({ rsvp }) => !audience.eventId || audience.rsvp === "All" || audience.rsvp === rsvp)
    .map(({ displayName, doNotEmail, email, emailSuppressed, id, phone, voicePart }) => ({
      displayName,
      doNotEmail: doNotEmail === 1,
      email,
      emailSuppressed: emailSuppressed === 1,
      phone,
      profileId: id,
      voicePart,
    }));
  recipients.push(...commerceRecipients(storage, audience));
  return Response.json({ recipients });
}

function deliveryRows(
  message: z.infer<typeof communicationSendRequestSchema>,
  recipients: readonly z.infer<typeof recipientSchema>[],
  messageId: string,
  now: string,
) {
  const seen = new Set<string>();
  return recipients.flatMap((recipient) => {
    const values: { channel: "email" | "sms"; destination: string }[] = [];
    if (message.channel !== "SMS" && recipient.email) {
      values.push({ channel: "email", destination: recipient.email });
    }
    if (message.channel !== "Email" && recipient.phone) {
      values.push({ channel: "sms", destination: recipient.phone });
    }
    return values.flatMap((value) => {
      const key = `${recipient.profileId}:${value.channel}:${value.destination.trim().toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          ...value,
          id: crypto.randomUUID(),
          messageId,
          now,
          recipient,
        },
      ];
    });
  });
}

async function sendMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
  now: string,
): Promise<Response> {
  if (operation.dedupeKey) {
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1",
        operation.dedupeKey,
      )
      .toArray()
      .at(0);
    if (existing) {
      const message = readMessage(storage, existing.id);
      if (!message) throw new Error("The deduplicated communication message could not be read.");
      return Response.json(message);
    }
  }
  const reach = communicationReach(operation.recipients, operation.message.channel);
  if (reach.total === 0)
    return Response.json({ code: "communication_has_no_recipients" }, { status: 409 });
  const deliveries = deliveryRows(
    operation.message,
    operation.recipients,
    operation.messageId,
    now,
  );
  if (deliveries.length > MAX_COMMUNICATION_DELIVERIES) {
    return Response.json({ code: "communication_delivery_limit_exceeded" }, { status: 413 });
  }
  const inserted = storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT${operation.dedupeKey ? " OR IGNORE" : ""} INTO communication_messages
        (id, channel, status, subject, content_markdown, audience_json, reach_json,
         created_by, created_at, updated_at, queued_at, dedupe_key)
       VALUES (?, ?, 'Queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      operation.dedupeKey ?? null,
    );
    const persisted = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        operation.dedupeKey
          ? "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1"
          : "SELECT id FROM communication_messages WHERE id = ? LIMIT 1",
        operation.dedupeKey ?? operation.messageId,
      )
      .toArray()
      .at(0);
    if (!persisted) throw new Error("The communication message was not persisted.");
    if (persisted.id !== operation.messageId) {
      return false;
    }
    for (const delivery of deliveries) {
      storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status,
           created_at, updated_at, unsubscribe_url)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
        delivery.id,
        delivery.messageId,
        delivery.recipient.profileId,
        delivery.recipient.name,
        delivery.channel,
        delivery.destination,
        delivery.now,
        delivery.now,
        delivery.channel === "email" ? delivery.recipient.unsubscribeUrl : null,
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
      "communication_message",
      operation.actorType,
    );
    return true;
  });
  if (!inserted) {
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1",
        operation.dedupeKey,
      )
      .toArray()
      .at(0);
    if (!existing) throw new Error("The deduplicated communication message could not be read.");
    const message = readMessage(storage, existing.id);
    if (!message) throw new Error("The deduplicated communication message could not be read.");
    return Response.json(message);
  }
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

function updateTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof updateTemplateOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ?`,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      operation.templateId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.updated",
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
         SET status = ?, attempts = attempts + 1, provider_message_id = ?,
           provider_status = CASE
             WHEN ? = 'sent' AND ? IS NOT NULL AND provider_status IS NULL THEN 'accepted'
             ELSE provider_status END,
           failure_detail = ?,
           last_attempt_at = ?, updated_at = ?
         WHERE id = ? AND message_id = ? AND status IN ('queued', 'processing')`,
        result.status,
        result.providerMessageId,
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
  if (operation.action === "update-template") return updateTemplate(storage, operation, now);
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

function bulletinPreview(value: string): string {
  return value
    .replace(/[`*_#>()!-]/g, " ")
    .replace(/[[]/g, " ")
    .replace(/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export function listMemberBulletinsFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  if (!input.organizationId || !identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profileId = z.uuid().safeParse(input.profileId);
  if (!profileId.success) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const bulletins = storage.sql
    .exec<MemberBulletinRow>(
      `SELECT m.id, m.subject, m.content_markdown AS contentMarkdown,
         COALESCE(m.sent_at, MAX(d.updated_at)) AS sentAt
       FROM communication_messages m
       JOIN communication_deliveries d ON d.message_id = m.id
       WHERE m.status = 'Sent' AND d.profile_id = ? AND d.status = 'sent'
       GROUP BY m.id
       ORDER BY sentAt DESC, m.id DESC LIMIT 5`,
      profileId.data,
    )
    .toArray()
    .map((bulletin) => ({ ...bulletin, preview: bulletinPreview(bulletin.contentMarkdown) }));
  return Response.json({ bulletins });
}

interface ProfileDeliveryRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempts: number;
  readonly channel: "email" | "sms";
  readonly destination: string;
  readonly failureDetail: string;
  readonly lastAttemptAt: string | null;
  readonly messageId: string;
  readonly providerEventAt: string | null;
  readonly providerReason: string;
  readonly providerStatus:
    "accepted" | "bounced" | "complained" | "deferred" | "delivered" | "failed" | "rejected" | null;
  readonly recipientName: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly subject: string | null;
  readonly updatedAt: string;
}

export function listProfileDeliveriesFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  if (!input.organizationId || !identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profileId = z.uuid().safeParse(input.profileId);
  if (!profileId.success) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const rows = storage.sql
    .exec<ProfileDeliveryRow>(
      `SELECT d.id, d.message_id AS messageId, m.subject, d.recipient_name AS recipientName,
         d.channel, d.destination, d.status, d.attempts,
         d.failure_detail AS failureDetail, d.last_attempt_at AS lastAttemptAt,
         d.provider_status AS providerStatus, d.provider_event_at AS providerEventAt,
         d.provider_reason AS providerReason, d.updated_at AS updatedAt
       FROM communication_deliveries d
       LEFT JOIN communication_messages m ON m.id = d.message_id
       WHERE d.profile_id = ?
       ORDER BY COALESCE(d.last_attempt_at, d.updated_at) DESC, d.id DESC
       LIMIT 25`,
      profileId.data,
    )
    .toArray()
    .map((row) => ({
      attempts: row.attempts,
      channel: row.channel,
      destination: row.destination,
      failureDetail: row.failureDetail,
      lastAttemptAt: row.lastAttemptAt ?? row.updatedAt,
      messageId: row.messageId,
      providerEventAt: row.providerEventAt,
      providerReason: row.providerReason,
      providerStatus: row.providerStatus,
      recipientName: row.recipientName,
      status: row.status,
      subject: row.subject ?? "(no subject)",
      updatedAt: row.updatedAt,
    }));
  return Response.json({ deliveries: rows });
}

interface ScheduledTicketMessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string | null;
  readonly eventTitle: string;
  readonly id: string;
  readonly kind: "confirmation" | "reminder";
  readonly scheduledAt: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly subject: string;
}

interface ScheduledAuditionMessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly auditionName: string;
  readonly id: string;
  readonly kind:
    "admin_alert" | "audition_reminder" | "inquiry_confirmation" | "scheduled_confirmation";
  readonly scheduledAt: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly subject: string;
}

interface ScheduledOutboxMessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly dueAt: string;
  readonly enqueuedAt: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly jobStatus: "claimed" | "completed" | "failed" | null;
  readonly kind: "attendance_report" | "event_reminder" | "rsvp_follow_up";
}

function scheduledJobStatus(
  enqueuedAt: string | null,
  jobStatus: ScheduledOutboxMessageRow["jobStatus"],
): "Failed" | "Queued" | "Scheduled" | "Sent" {
  if (jobStatus === "completed") return "Sent";
  if (jobStatus === "failed") return "Failed";
  return enqueuedAt ? "Queued" : "Scheduled";
}

export function listCommunicationScheduledMessagesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const messages: z.infer<typeof communicationScheduledMessageSchema>[] = storage.sql
    .exec<ScheduledTicketMessageRow>(
      `SELECT n.id, n.kind, n.subject, n.status,
        n.scheduled_for AS scheduledAt, n.event_id AS eventId,
        COALESCE(e.title, p.event_title) AS eventTitle
       FROM ticket_notifications n
       JOIN ticket_purchases p ON p.id = n.purchase_id
       LEFT JOIN events e ON e.id = n.event_id
       ORDER BY n.scheduled_for DESC, n.id DESC LIMIT 100`,
    )
    .toArray()
    .map((row) =>
      communicationScheduledMessageSchema.parse({
        eventId: row.eventId,
        eventTitle: row.eventTitle,
        id: row.id,
        kind: row.kind === "reminder" ? "ticket_reminder" : "ticket_confirmation",
        recipientCount: 1,
        scheduledAt: row.scheduledAt,
        status:
          row.status === "failed"
            ? "Failed"
            : row.status === "sent" || row.status === "suppressed"
              ? "Sent"
              : "Queued",
        subject: row.subject,
      }),
    );

  const auditionMessages = storage.sql
    .exec<ScheduledAuditionMessageRow>(
      `SELECT n.id, n.kind, n.subject, n.status,
        n.scheduled_for AS scheduledAt, a.name AS auditionName
       FROM audition_notifications n
       JOIN auditions a ON a.id = n.audition_id
       WHERE n.kind IN ('scheduled_confirmation', 'audition_reminder')
       ORDER BY n.scheduled_for DESC, n.id DESC LIMIT 100`,
    )
    .toArray();
  for (const message of auditionMessages) {
    messages.push(
      communicationScheduledMessageSchema.parse({
        eventId: null,
        eventTitle: `Audition: ${message.auditionName}`,
        id: message.id,
        kind: message.kind === "audition_reminder" ? "audition_reminder" : "audition_confirmation",
        recipientCount: 1,
        scheduledAt: message.scheduledAt,
        status:
          message.status === "failed"
            ? "Failed"
            : message.status === "sent" || message.status === "suppressed"
              ? "Sent"
              : "Queued",
        subject: message.subject,
      }),
    );
  }

  const scheduledJobs = storage.sql
    .exec<ScheduledOutboxMessageRow>(
      `SELECT o.job_id AS jobId, o.kind, o.idempotency_key AS idempotencyKey,
        o.due_at AS dueAt, o.enqueued_at AS enqueuedAt, l.status AS jobStatus
       FROM scheduled_job_outbox o
       LEFT JOIN job_ledger l ON l.job_id = o.job_id
       WHERE o.kind IN ('event_reminder', 'rsvp_follow_up', 'attendance_report')
       ORDER BY o.due_at DESC, o.job_id DESC LIMIT 100`,
    )
    .toArray();
  for (const job of scheduledJobs) {
    const eventId = job.idempotencyKey.split(":").at(-1) ?? "";
    const event = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly title: string }>(
        "SELECT title FROM events WHERE id = ? LIMIT 1",
        eventId,
      )
      .toArray()
      .at(0);
    if (!event) continue;
    messages.push(
      communicationScheduledMessageSchema.parse({
        eventId,
        eventTitle: event.title,
        id: job.jobId,
        kind: job.kind,
        recipientCount: 0,
        scheduledAt: job.dueAt,
        status: scheduledJobStatus(job.enqueuedAt, job.jobStatus),
        subject:
          job.kind === "event_reminder"
            ? "Event reminder: " + event.title
            : job.kind === "rsvp_follow_up"
              ? "RSVP follow-up: " + event.title
              : "Attendance report: " + event.title,
      }),
    );
  }
  messages.sort(
    (left, right) => new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime(),
  );
  return Response.json({ messages: messages.slice(0, 200) });
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

export function readCommunicationTemplateFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  templateId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedId = z.uuid().safeParse(templateId);
  if (!parsedId.success) {
    return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
         is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      parsedId.data,
    )
    .toArray()
    .at(0);
  return row
    ? Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }))
    : Response.json({ code: "communication_template_not_found" }, { status: 404 });
}

export async function unsubscribeCommunicationProfileInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = unsubscribeOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_unsubscribe_request" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const profile = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM profiles WHERE id = ? LIMIT 1",
      operation.profileId,
    )
    .toArray()
    .at(0);
  if (!profile) return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE profiles SET do_not_email = 1, updated_at = ? WHERE id = ?",
      now,
      operation.profileId,
    );
    storage.sql.exec(
      `INSERT INTO communication_suppressions
        (id, profile_id, channel, reason, active, created_at, updated_at)
       VALUES (?, ?, 'email', 'user_unsubscribe', 1, ?, ?)
       ON CONFLICT(profile_id, channel) DO UPDATE SET
         reason = 'user_unsubscribe', active = 1, updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      operation.profileId,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
        request_id, change_summary, occurred_at)
       VALUES (?, 'public_link', ?, 'organization.communication.unsubscribed',
        'profile', ?, ?, ?, ?)`,
      `communication-unsubscribe:${operation.requestId}`,
      operation.profileId,
      operation.profileId,
      operation.requestId,
      JSON.stringify({ channel: "email" }),
      now,
    );
  });
  return Response.json({ success: true });
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
        status, attempts, failure_detail AS failureDetail, provider_status AS providerStatus,
        updated_at AS updatedAt
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
  storage.sql.exec(
    `UPDATE communication_deliveries
     SET status = 'suppressed', failure_detail = '', updated_at = ?
     WHERE message_id = ? AND channel = 'email' AND status = 'queued'
       AND EXISTS (
         SELECT 1 FROM profiles p
         WHERE p.id = communication_deliveries.profile_id
           AND (
             p.do_not_email = 1 OR EXISTS (
               SELECT 1 FROM communication_suppressions s
               WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
             )
           )
       )`,
    new Date().toISOString(),
    messageId,
  );
  const deliveries = storage.sql
    .exec<DeliveryRow>(
      `SELECT id, message_id AS messageId, profile_id AS profileId, recipient_name AS recipientName, channel, destination,
        status, attempts, failure_detail AS failureDetail, updated_at AS updatedAt,
        unsubscribe_url AS unsubscribeUrl
       FROM communication_deliveries WHERE message_id = ? AND status = 'queued'
       ORDER BY id LIMIT 1000`,
      messageId,
    )
    .toArray()
    .map(({ channel, destination, id, profileId, recipientName, unsubscribeUrl }) => ({
      channel,
      destination,
      id,
      profileId,
      recipientName,
      unsubscribeUrl,
    }));
  const eventId = message?.audience.eventId ?? null;
  const context = eventCommunicationContext(storage, eventId);
  return message
    ? Response.json({
        contentMarkdown: message.contentMarkdown,
        context,
        deliveries,
        messageId,
        subject: message.subject,
      })
    : Response.json({ code: "communication_message_not_found" }, { status: 404 });
}
