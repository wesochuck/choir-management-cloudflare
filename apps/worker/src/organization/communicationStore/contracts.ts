import {
  communicationAudienceRequestSchema,
  communicationDraftRequestSchema,
  communicationSendRequestSchema,
  communicationTemplateRequestSchema,
} from "@choir/contracts";
import { z } from "zod";

export const MAX_COMMUNICATION_DELIVERIES = 1_000;

const contextSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});
export const audienceOperationSchema = contextSchema.pick({ organizationId: true }).extend({
  audience: communicationAudienceRequestSchema,
});
export const recipientSchema = z.object({
  email: z.string().max(320),
  name: z.string().min(1).max(200),
  phone: z.string().max(40),
  profileId: z.uuid(),
  unsubscribeUrl: z.url().max(4_096).nullable(),
});
export const unsubscribeOperationSchema = z.object({
  organizationId: z.string().min(1).max(128),
  profileId: z.uuid(),
  requestId: z.uuid(),
});
export const saveOperationSchema = contextSchema.extend({
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
export const sendOperationSchema = contextSchema
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
export const retryOperationSchema = contextSchema.extend({
  action: z.literal("retry"),
  jobId: z.uuid(),
  messageId: z.uuid(),
});
export const saveTemplateOperationSchema = contextSchema.extend({
  action: z.literal("save-template"),
  template: communicationTemplateRequestSchema,
  templateId: z.uuid(),
});
export const updateTemplateOperationSchema = contextSchema.extend({
  action: z.literal("update-template"),
  template: communicationTemplateRequestSchema,
  templateId: z.uuid(),
});
export const deleteTemplateOperationSchema = contextSchema.extend({
  action: z.literal("delete-template"),
  templateId: z.uuid(),
});
export const deleteDraftOperationSchema = contextSchema.extend({
  action: z.literal("delete-draft"),
  messageId: z.uuid(),
});
export const cancelOperationSchema = contextSchema.extend({
  action: z.literal("cancel"),
  messageId: z.uuid(),
});
export const deliveryResultOperationSchema = z.object({
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
export const operationSchema = z.discriminatedUnion("action", [
  saveOperationSchema,
  sendOperationSchema,
  retryOperationSchema,
  saveTemplateOperationSchema,
  updateTemplateOperationSchema,
  deleteTemplateOperationSchema,
  deleteDraftOperationSchema,
  cancelOperationSchema,
  deliveryResultOperationSchema,
]);

export interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}
export interface CandidateRow {
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
export interface ConfigurationRow {
  readonly [column: string]: SqlStorageValue;
  readonly rosterConfigurationJson: string;
}
export interface MessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly audienceJson: string;
  readonly canceledAt: string | null;
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

export interface DeliveryRow {
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
export interface TemplateRow {
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

export const messageColumns = `id, channel, status, subject, content_markdown AS contentMarkdown,
  audience_json AS audienceJson, reach_json AS reachJson, created_at AS createdAt,
  updated_at AS updatedAt, sent_at AS sentAt, canceled_at AS canceledAt`;
