import { z } from "zod";
import { requestIdSchema } from "./primitives";
import type { singerLearningTrackPieceSchema } from "./music";
export const communicationChannelSchema = z.enum(["Email", "SMS", "Both"]);
export const communicationMessageStatusSchema = z.enum(["Draft", "Queued", "Sent", "Failed"]);
export const communicationDeliveryStatusSchema = z.enum([
  "queued",
  "processing",
  "sent",
  "failed",
  "suppressed",
]);
const communicationProviderStatusSchema = z.enum([
  "accepted",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "rejected",
  "complained",
]);
const communicationProviderStatusCountsSchema = z.object({
  accepted: z.number().int().nonnegative(),
  bounced: z.number().int().nonnegative(),
  complained: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export const communicationFailureCategorySchema = z.enum([
  "authentication",
  "invalid-destination",
  "provider-rejected",
  "rate-limit",
  "timeout",
  "unknown",
]);

export const communicationAudienceRequestSchema = z.object({
  eventId: z.uuid().nullable().default(null),
  globalStatuses: z
    .array(z.enum(["Active", "Idle", "Inactive"]))
    .max(3)
    .default(["Active"]),
  profileIds: z.array(z.uuid()).max(500).default([]),
  rsvp: z.enum(["All", "Yes", "No", "Pending"]).default("All"),
  targetAudiences: z
    .array(z.enum(["Members", "Ticket Buyers", "Donors"]))
    .min(1)
    .max(3)
    .default(["Members"]),
  voiceParts: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
});

const communicationComposeBaseSchema = z.object({
  audience: communicationAudienceRequestSchema,
  channel: communicationChannelSchema,
  contentMarkdown: z.string().max(100_000),
  subject: z.string().trim().max(300),
});

export const communicationDraftRequestSchema = communicationComposeBaseSchema.superRefine(
  (value, context) => {
    if (value.channel !== "SMS" && value.subject.length === 0) {
      context.addIssue({ code: "custom", message: "Email messages require a subject." });
    }
  },
);

export const communicationSendRequestSchema = communicationDraftRequestSchema.superRefine(
  (value, context) => {
    if (value.contentMarkdown.trim().length === 0) {
      context.addIssue({ code: "custom", message: "A message is required." });
    }
  },
);

export const communicationTestEmailRequestSchema = z.object({
  contentMarkdown: z.string().trim().min(1).max(100_000),
  email: z.email().max(320),
  subject: z.string().trim().min(1).max(300),
});

export const communicationTemplateRequestSchema = z
  .object({
    channel: communicationChannelSchema,
    contentMarkdown: z.string().max(100_000),
    subject: z.string().trim().max(300),
    title: z.string().trim().min(1).max(200),
  })
  .superRefine((value, context) => {
    if (value.channel !== "SMS" && value.subject.length === 0) {
      context.addIssue({ code: "custom", message: "Email templates require a subject." });
    }
  });

export const communicationTemplateSchema = communicationTemplateRequestSchema.and(
  z.object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    isSystem: z.boolean(),
    updatedAt: z.iso.datetime(),
  }),
);

export const communicationReachSchema = z.object({
  both: z.number().int().nonnegative(),
  email: z.number().int().nonnegative(),
  sms: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  unreachable: z.number().int().nonnegative(),
});

export const communicationMessageSchema = z.object({
  audience: communicationAudienceRequestSchema,
  channel: communicationChannelSchema,
  contentMarkdown: z.string().max(100_000),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  reach: communicationReachSchema,
  sentAt: z.iso.datetime().nullable(),
  status: communicationMessageStatusSchema,
  subject: z.string().max(300),
  updatedAt: z.iso.datetime(),
});

const communicationChannelCountsSchema = z.object({
  failed: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  suppressed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const communicationDeliveryFailureSchema = z.object({
  attempts: z.number().int().nonnegative(),
  category: communicationFailureCategorySchema,
  channel: z.enum(["email", "sms"]),
  lastSeen: z.iso.datetime(),
  maskedDestination: z.string().min(1).max(320),
});

export const communicationDeliverySummarySchema = z.object({
  email: communicationChannelCountsSchema,
  failures: z.array(communicationDeliveryFailureSchema).max(20),
  hasMoreFailures: z.boolean(),
  lastActivity: z.iso.datetime().nullable(),
  messageId: z.uuid(),
  provider: communicationProviderStatusCountsSchema,
  sms: communicationChannelCountsSchema,
  state: z.enum(["failed", "partial", "queued", "sending", "sent", "tracking-unavailable"]),
  total: communicationChannelCountsSchema,
});

export const communicationScheduledMessageSchema = z.object({
  eventId: z.uuid().nullable(),
  eventTitle: z.string().max(500),
  id: z.uuid(),
  kind: z.enum([
    "attendance_report",
    "event_reminder",
    "rsvp_follow_up",
    "audition_confirmation",
    "audition_reminder",
    "ticket_confirmation",
    "ticket_reminder",
  ]),
  recipientCount: z.number().int().nonnegative(),
  scheduledAt: z.iso.datetime(),
  status: z.enum(["Failed", "Queued", "Scheduled", "Sent"]),
  subject: z.string().max(500),
});

export const communicationScheduledMessagesResponseSchema = z.object({
  messages: z.array(communicationScheduledMessageSchema).max(200),
  requestId: requestIdSchema,
});

export const communicationMessageResponseSchema = communicationMessageSchema.and(
  z.object({ requestId: requestIdSchema }),
);
export const communicationMessagesResponseSchema = z.object({
  messages: z.array(communicationMessageSchema).max(100),
  requestId: requestIdSchema,
});
export const communicationReachResponseSchema = communicationReachSchema.and(
  z.object({ requestId: requestIdSchema }),
);
export const communicationTestEmailResponseSchema = z.object({
  requestId: requestIdSchema,
  sent: z.literal(true),
});
export const communicationDeliverySummaryResponseSchema = communicationDeliverySummarySchema.and(
  z.object({ requestId: requestIdSchema }),
);
export const communicationRetryResponseSchema = z.object({
  messageId: z.uuid(),
  requestId: requestIdSchema,
  retried: z.number().int().nonnegative(),
});
export const communicationTemplateResponseSchema = communicationTemplateSchema.and(
  z.object({ requestId: requestIdSchema }),
);
export const communicationTemplatesResponseSchema = z.object({
  requestId: requestIdSchema,
  templates: z.array(communicationTemplateSchema).max(200),
});
export const communicationDeleteResponseSchema = z.object({
  id: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("deleted"),
});
export const communicationUnsubscribeRequestSchema = z.object({
  token: z.string().min(1).max(4_096),
});
export const communicationUnsubscribeResponseSchema = z.object({
  requestId: requestIdSchema,
  success: z.literal(true),
});

export type CommunicationAudienceRequest = z.infer<typeof communicationAudienceRequestSchema>;
export type CommunicationChannel = z.infer<typeof communicationChannelSchema>;
export type CommunicationDeliverySummary = z.infer<typeof communicationDeliverySummarySchema>;
export type CommunicationDraftRequest = z.infer<typeof communicationDraftRequestSchema>;
export type CommunicationMessage = z.infer<typeof communicationMessageSchema>;
export type CommunicationReach = z.infer<typeof communicationReachSchema>;
export type CommunicationScheduledMessage = z.infer<typeof communicationScheduledMessageSchema>;
export type CommunicationSendRequest = z.infer<typeof communicationSendRequestSchema>;
export type CommunicationTestEmailRequest = z.infer<typeof communicationTestEmailRequestSchema>;
export type CommunicationTemplate = z.infer<typeof communicationTemplateSchema>;
export type CommunicationTemplateRequest = z.infer<typeof communicationTemplateRequestSchema>;
export type SingerLearningTrackPiece = z.infer<typeof singerLearningTrackPieceSchema>;

export const organizationProfileDeliverySchema = z.object({
  attempts: z.number().int().nonnegative(),
  // Delivery rows store the lowercase provider channel; the display casing
  // is applied by the client.
  channel: z.enum(["email", "sms"]),
  destination: z.string().min(1).max(320),
  failureDetail: z.string().max(2_000),
  lastAttemptAt: z.string().min(1).max(100),
  messageId: z.uuid(),
  providerEventAt: z.string().max(100).nullable(),
  providerReason: z.string().max(500),
  providerStatus: communicationProviderStatusSchema.nullable(),
  recipientName: z.string().min(1).max(200),
  status: z.enum(["failed", "processing", "queued", "sent", "suppressed"]),
  subject: z.string().min(1).max(300),
  updatedAt: z.string().min(1).max(100),
});

export const organizationProfileDeliveriesResponseSchema = z.object({
  deliveries: z.array(organizationProfileDeliverySchema).max(25),
  requestId: requestIdSchema,
});

export type OrganizationProfileDelivery = z.infer<typeof organizationProfileDeliverySchema>;
export type OrganizationProfileDeliveriesResponse = z.infer<
  typeof organizationProfileDeliveriesResponseSchema
>;
