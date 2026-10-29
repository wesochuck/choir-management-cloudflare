import { z } from "zod";
import { requestIdSchema } from "./primitives";
import type { singerLearningTrackPieceSchema } from "./music";
export const communicationChannelSchema = z.enum(["Email", "SMS", "Both"]);
export const communicationMessageStatusSchema = z.enum([
  "Canceled",
  "Draft",
  "Queued",
  "Sent",
  "Failed",
]);
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

export const communicationAudienceTargetSchema = z.enum([
  "Members",
  "Contacts",
  "Ticket Buyers",
  "Donors",
]);

export const communicationTicketBuyerModeSchema = z.enum(["marketing", "ticket_service"]);

export type CommunicationAudienceTarget = z.infer<typeof communicationAudienceTargetSchema>;

/**
 * Phase 6 recipient identity (expand/contract).
 *
 * Historical communication rows predate this subject and carry only a single
 * identifier in the delivery `profile_id` carrier column. New sends populate
 * both the carrier (for rollback-compatible reads) and this typed subject.
 * `communicationRecipientSubjectFromLegacy` adapts old rows. Phase 9 resolves
 * Ticket Buyer and Donor audiences through Contacts and never mints
 * `ticket_purchase`/`donation` subjects for new sends; those kinds remain
 * parseable so historical deliveries stay readable.
 */
export const communicationRecipientSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), profileId: z.uuid() }),
  z.object({ kind: z.literal("contact"), contactId: z.uuid() }),
  z.object({ kind: z.literal("ticket_purchase"), purchaseId: z.uuid() }),
  z.object({ kind: z.literal("donation"), donationId: z.uuid() }),
]);

export type CommunicationRecipientSubject = z.infer<typeof communicationRecipientSubjectSchema>;

/** Adapts a pre-subject delivery carrier ID to the legacy profile subject. */
export function communicationRecipientSubjectFromLegacy(profileId: string): {
  readonly kind: "profile";
  readonly profileId: string;
} {
  return { kind: "profile", profileId };
}

/** Returns the underlying identifier carried by a recipient subject. */
export function communicationRecipientSubjectId(subject: CommunicationRecipientSubject): string {
  switch (subject.kind) {
    case "profile":
      return subject.profileId;
    case "contact":
      return subject.contactId;
    case "ticket_purchase":
      return subject.purchaseId;
    case "donation":
      return subject.donationId;
  }
}

/** Maximum Contact IDs accepted by one communication audience request. */
export const COMMUNICATION_AUDIENCE_CONTACT_IDS_MAX = 500;

/** Maximum Contact Lists accepted by one communication audience request. */
export const COMMUNICATION_AUDIENCE_CONTACT_LISTS_MAX = 50;

const communicationContactEmailStatusSchema = z.enum(["unknown", "subscribed", "unsubscribed"]);
const communicationContactSmsStatusSchema = z.enum(["unknown", "subscribed", "unsubscribed"]);

const communicationAudienceRequestBaseSchema = z.object({
  contactEmailStatus: communicationContactEmailStatusSchema.nullable().default(null),
  contactIds: z.array(z.uuid()).max(COMMUNICATION_AUDIENCE_CONTACT_IDS_MAX).default([]),
  contactListIds: z.array(z.uuid()).max(COMMUNICATION_AUDIENCE_CONTACT_LISTS_MAX).default([]),
  contactSmsStatus: communicationContactSmsStatusSchema.nullable().default(null),
  contactSource: z.string().trim().max(200).nullable().default(null),
  eventId: z.uuid().nullable().default(null),
  globalStatuses: z
    .array(z.enum(["Active", "Idle", "Inactive"]))
    .max(3)
    .default(["Active"]),
  profileIds: z.array(z.uuid()).max(500).default([]),
  rsvp: z.enum(["All", "Yes", "No", "Pending"]).default("All"),
  targetAudiences: z.array(communicationAudienceTargetSchema).min(1).max(4).default(["Members"]),
  ticketBuyerMode: communicationTicketBuyerModeSchema.default("marketing"),
  ticketBuyerPastEventsOnly: z.boolean().optional(),
  ticketBuyerSourceEventIds: z.array(z.uuid()).max(50).optional(),
  excludeTicketBuyersForEventId: z.uuid().nullable().optional(),
  voiceParts: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
});

export const communicationAudienceRequestSchema =
  communicationAudienceRequestBaseSchema.superRefine((audience, context) => {
    if (audience.ticketBuyerMode !== "ticket_service") return;
    if (audience.eventId === null) {
      context.addIssue({
        code: "custom",
        message: "Select the affected performance to contact its ticket holders.",
        path: ["eventId"],
      });
    }
    if (audience.targetAudiences.length !== 1 || audience.targetAudiences[0] !== "Ticket Buyers") {
      context.addIssue({
        code: "custom",
        message: "Important ticket-holder notices can only target Ticket Buyers.",
        path: ["targetAudiences"],
      });
    }
  });

function validateTicketBuyerDeliveryChannel(
  value: {
    readonly audience: CommunicationAudienceRequest;
    readonly channel: CommunicationChannel;
  },
  context: z.RefinementCtx,
): void {
  if (value.audience.ticketBuyerMode === "ticket_service" && value.channel !== "Email") {
    context.addIssue({
      code: "custom",
      message:
        "Important ticket-holder notices can only be sent by email. Switch to Email delivery.",
      path: ["channel"],
    });
  }
}

interface PromotionComposeValue {
  readonly audience: z.infer<typeof communicationAudienceRequestSchema>;
  readonly channel: z.infer<typeof communicationChannelSchema>;
  readonly eventPromotion?: { readonly eventId: string } | null | undefined;
}

function validatePromotionAudienceBase(
  value: PromotionComposeValue,
  context: z.RefinementCtx,
): void {
  if (!value.eventPromotion) return;
  const allowedAudience = value.audience.targetAudiences.every(
    (target) => target === "Ticket Buyers" || target === "Contacts",
  );
  if (
    value.channel !== "Email" ||
    value.audience.ticketBuyerMode !== "marketing" ||
    value.audience.eventId !== null ||
    !allowedAudience ||
    value.audience.targetAudiences.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Event promotions require Email and only marketing Ticket Buyers or Contacts.",
      path: ["audience"],
    });
  }
}

function validatePromotionBuyerSource(
  value: PromotionComposeValue,
  context: z.RefinementCtx,
): void {
  if (
    value.eventPromotion &&
    value.audience.targetAudiences.includes("Ticket Buyers") &&
    value.audience.ticketBuyerPastEventsOnly !== true &&
    (value.audience.ticketBuyerSourceEventIds?.length ?? 0) === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Choose previous performances as the Ticket Buyer source.",
      path: ["audience", "ticketBuyerPastEventsOnly"],
    });
  }
}

function validatePromotionBuyerExclusion(
  value: PromotionComposeValue,
  context: z.RefinementCtx,
): void {
  const exclusionId = value.audience.excludeTicketBuyersForEventId;
  if (
    value.eventPromotion &&
    exclusionId !== null &&
    exclusionId !== undefined &&
    exclusionId !== value.eventPromotion.eventId
  ) {
    context.addIssue({
      code: "custom",
      message: "Event promotions may only exclude buyers for their target event.",
      path: ["audience", "excludeTicketBuyersForEventId"],
    });
  }
}

export const communicationAudienceChannelRequestSchema = z
  .object({
    audience: communicationAudienceRequestSchema,
    channel: communicationChannelSchema,
    contentMarkdown: z.string().max(100_000).optional(),
    draftRevision: z.number().int().positive().optional(),
    eventPromotion: z
      .object({
        announcementKind: z.enum(["initial", "follow_up"]),
        eventId: z.uuid(),
        parentMessageId: z.uuid().nullable(),
      })
      .optional(),
    messageId: z.uuid().optional(),
    subject: z.string().trim().max(300).optional(),
  })
  .superRefine((value, context) => {
    validateTicketBuyerDeliveryChannel(value, context);
    if (
      value.eventPromotion &&
      (!value.messageId ||
        !value.draftRevision ||
        value.audience.eventId !== null ||
        value.contentMarkdown === undefined ||
        value.subject === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "A promotion reach review requires the saved draft identity and revision.",
        path: ["messageId"],
      });
    }
  });

const communicationComposeBaseSchema = z
  .object({
    audience: communicationAudienceRequestSchema,
    channel: communicationChannelSchema,
    contentMarkdown: z.string().max(100_000),
    eventPromotion: z
      .object({
        announcementKind: z.enum(["initial", "follow_up"]),
        eventId: z.uuid(),
        parentMessageId: z.uuid().nullable().default(null),
      })
      .superRefine((value, context) => {
        if (value.announcementKind === "initial" && value.parentMessageId !== null) {
          context.addIssue({
            code: "custom",
            message: "An initial announcement cannot have a parent.",
          });
        }
        if (value.announcementKind === "follow_up" && value.parentMessageId === null) {
          context.addIssue({
            code: "custom",
            message: "A follow-up must reference its parent message.",
          });
        }
      })
      .nullable()
      .optional(),
    subject: z.string().trim().max(300),
  })
  .superRefine((value, context) => {
    validatePromotionAudienceBase(value, context);
    validatePromotionBuyerSource(value, context);
    validatePromotionBuyerExclusion(value, context);
  });

export const communicationDraftRequestSchema = communicationComposeBaseSchema
  .extend({
    expectedRevision: z.number().int().positive().nullable().optional(),
    messageId: z.uuid().nullable().optional(),
  })
  .superRefine((value, context) => {
    validateTicketBuyerDeliveryChannel(value, context);
    if (value.channel !== "SMS" && value.subject.length === 0) {
      context.addIssue({ code: "custom", message: "Email messages require a subject." });
    }
    const hasMessageId = (value.messageId ?? null) !== null;
    const hasExpectedRevision = (value.expectedRevision ?? null) !== null;
    const isPromotionDraftCreation = hasMessageId && !hasExpectedRevision && value.eventPromotion;
    if (hasMessageId !== hasExpectedRevision && !isPromotionDraftCreation) {
      context.addIssue({
        code: "custom",
        message:
          "An expected draft revision requires a message ID; a new event promotion may provide a stable ID.",
        path: ["messageId"],
      });
    }
  });

export const communicationSendRequestSchema = communicationDraftRequestSchema
  .superRefine((value, context) => {
    if (value.contentMarkdown.trim().length === 0) {
      context.addIssue({ code: "custom", message: "A message is required." });
    }
    if (value.eventPromotion && (!value.messageId || !value.expectedRevision)) {
      context.addIssue({
        code: "custom",
        message: "Event promotions must send the saved draft revision.",
        path: ["expectedRevision"],
      });
    }
  })
  .and(z.object({ reviewSnapshot: z.string().min(1).max(4_096).optional() }));

export const communicationTestEmailRequestSchema = z.object({
  audience: communicationAudienceRequestSchema.optional(),
  contentMarkdown: z.string().trim().min(1).max(100_000),
  eventId: z.uuid().nullable().optional(),
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
  audienceOverLimit: z.boolean().default(false),
  both: z.number().int().nonnegative(),
  email: z.number().int().nonnegative(),
  sms: z.number().int().nonnegative(),
  ticketBuyerPurchasesOverLimit: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative(),
  undeliverableTicketBuyerPurchases: z.number().int().nonnegative().default(0),
  unreachable: z.number().int().nonnegative(),
});

export const communicationMessageSchema = z.object({
  audience: communicationAudienceRequestSchema,
  channel: communicationChannelSchema,
  contentMarkdown: z.string().max(100_000),
  createdAt: z.iso.datetime(),
  draftRevision: z.number().int().positive().default(1),
  eventPromotion: z
    .object({
      announcementKind: z.enum(["initial", "follow_up"]),
      eventId: z.uuid(),
      parentMessageId: z.uuid().nullable().default(null),
    })
    .nullable()
    .default(null),
  id: z.uuid(),
  reach: communicationReachSchema,
  sentAt: z.iso.datetime().nullable(),
  queuedByUserId: z.string().max(128).nullable().default(null),
  queuedByName: z.string().max(200).nullable().default(null),
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

export const communicationDeliveryRecipientSchema = z.object({
  channel: z.enum(["email", "sms"]),
  providerStatus: communicationProviderStatusSchema.nullable(),
  recipientName: z.string().min(1).max(200),
  status: z.enum(["failed", "processing", "queued", "sent", "suppressed"]),
});

export const communicationDeliverySummarySchema = z.object({
  email: communicationChannelCountsSchema,
  failures: z.array(communicationDeliveryFailureSchema).max(20),
  hasMoreFailures: z.boolean(),
  lastActivity: z.iso.datetime().nullable(),
  messageId: z.uuid(),
  provider: communicationProviderStatusCountsSchema,
  recipients: z.array(communicationDeliveryRecipientSchema).max(1_000).default([]),
  sms: communicationChannelCountsSchema,
  state: z.enum(["failed", "partial", "queued", "sending", "sent", "tracking-unavailable"]),
  total: communicationChannelCountsSchema,
});

export const communicationScheduledMessageSchema = z.object({
  eventId: z.uuid().nullable(),
  eventTitle: z.string().max(500),
  id: z.union([
    z.uuid(),
    z
      .string()
      .max(200)
      .regex(
        /^planned:(?:event-reminder|rsvp-follow-up|post-event-report|ticket-reminder):[A-Za-z0-9:-]+$/,
      ),
  ]),
  projected: z.boolean().optional(),
  timezone: z.string().min(1).max(100).optional(),
  kind: z.enum([
    "attendance_report",
    "event_reminder",
    "rsvp_follow_up",
    "audition_confirmation",
    "audition_reminder",
    "ticket_confirmation",
    "ticket_reminder",
    "ticket_refund",
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
  z.object({
    requestId: requestIdSchema,
    reviewSnapshot: z.string().min(1).max(4_096).optional(),
  }),
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
  nextCursor: z.string().max(512).nullable().optional(),
  requestId: requestIdSchema,
  templates: z.array(communicationTemplateSchema).max(200),
});
export const communicationTemplatesPageResponseSchema = z.object({
  nextCursor: z.string().max(512).nullable(),
  requestId: requestIdSchema,
  templates: z.array(communicationTemplateSchema).max(100),
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

export const communicationHistoryItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
    message: communicationMessageSchema,
    sortTimestamp: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal("automated"),
    scheduledMessage: communicationScheduledMessageSchema,
    sortTimestamp: z.iso.datetime(),
  }),
]);

export const communicationHistoryStatusFilterSchema = z.enum([
  "all",
  "draft",
  "scheduled",
  "queued",
  "sent",
  "failed",
  "canceled",
]);

export const communicationHistoryOriginFilterSchema = z.enum(["all", "manual", "automated"]);

export const communicationHistoryPageResponseSchema = z.object({
  items: z.array(communicationHistoryItemSchema).max(100),
  nextCursor: z.string().max(256).nullable(),
  requestId: requestIdSchema,
});

export const communicationDeliveryRecipientsPageResponseSchema = z.object({
  nextCursor: z.string().max(256).nullable(),
  recipients: z.array(communicationDeliveryRecipientSchema).max(100),
  requestId: requestIdSchema,
});

export type CommunicationAudienceRequest = z.infer<typeof communicationAudienceRequestSchema>;
export type CommunicationAudienceChannelRequest = z.infer<
  typeof communicationAudienceChannelRequestSchema
>;
export type CommunicationChannel = z.infer<typeof communicationChannelSchema>;
export type CommunicationDeliveryRecipient = z.infer<typeof communicationDeliveryRecipientSchema>;
export type CommunicationDeliveryRecipientsPageResponse = z.infer<
  typeof communicationDeliveryRecipientsPageResponseSchema
>;
export type CommunicationDeliverySummary = z.infer<typeof communicationDeliverySummarySchema>;
export type CommunicationDraftRequest = z.infer<typeof communicationDraftRequestSchema>;
export type CommunicationHistoryItem = z.infer<typeof communicationHistoryItemSchema>;
export type CommunicationHistoryOriginFilter = z.infer<
  typeof communicationHistoryOriginFilterSchema
>;
export type CommunicationHistoryPageResponse = z.infer<
  typeof communicationHistoryPageResponseSchema
>;
export type CommunicationHistoryStatusFilter = z.infer<
  typeof communicationHistoryStatusFilterSchema
>;
export type CommunicationMessage = z.infer<typeof communicationMessageSchema>;
export type CommunicationReach = z.infer<typeof communicationReachSchema>;
export type CommunicationScheduledMessage = z.infer<typeof communicationScheduledMessageSchema>;
export type CommunicationSendRequest = z.infer<typeof communicationSendRequestSchema>;
export type CommunicationTestEmailRequest = z.infer<typeof communicationTestEmailRequestSchema>;
export type CommunicationTemplate = z.infer<typeof communicationTemplateSchema>;
export type CommunicationTemplateRequest = z.infer<typeof communicationTemplateRequestSchema>;
export type CommunicationTemplatesPageResponse = z.infer<
  typeof communicationTemplatesPageResponseSchema
>;
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

export const organizationEmailDomainDnsRecordSchema = z.object({
  name: z.string().min(1).max(253),
  priority: z.number().int().optional(),
  purpose: z.enum(["spf", "dkim", "return_path", "dmarc"]),
  status: z.enum(["pending", "valid", "invalid"]),
  type: z.enum(["TXT", "CNAME", "MX"]),
  value: z.string().min(1).max(2048),
});

export const organizationEmailSettingsSchema = z.object({
  customDomain: z.string().min(1).max(253).nullable(),
  customDomainStatus: z.enum(["none", "pending", "active", "degraded"]),
  dnsRecords: z.array(organizationEmailDomainDnsRecordSchema),
  fromName: z.string().max(100).nullable(),
  lastCheckedAt: z.string().nullable(),
  replyToEmail: z.email().max(320).nullable(),
  verifiedAt: z.string().nullable(),
});

export const organizationEmailSettingsUpdateRequestSchema = z.object({
  customDomain: z.string().trim().min(1).max(253).nullable().optional(),
  fromName: z.string().trim().max(100).nullable().optional(),
  replyToEmail: z.email().max(320).nullable().optional(),
});

export const organizationEmailSettingsResponseSchema = z.object({
  requestId: requestIdSchema,
  settings: organizationEmailSettingsSchema,
});

export const organizationEmailDomainVerifyResponseSchema = z.object({
  allValid: z.boolean(),
  dnsRecords: z.array(organizationEmailDomainDnsRecordSchema),
  requestId: requestIdSchema,
  status: z.enum(["none", "pending", "active", "degraded"]),
});

export type OrganizationEmailDomainDnsRecord = z.infer<
  typeof organizationEmailDomainDnsRecordSchema
>;
export type OrganizationEmailSettings = z.infer<typeof organizationEmailSettingsSchema>;
export type OrganizationEmailSettingsUpdateRequest = z.infer<
  typeof organizationEmailSettingsUpdateRequestSchema
>;
export type OrganizationEmailSettingsResponse = z.infer<
  typeof organizationEmailSettingsResponseSchema
>;
export type OrganizationEmailDomainVerifyResponse = z.infer<
  typeof organizationEmailDomainVerifyResponseSchema
>;
