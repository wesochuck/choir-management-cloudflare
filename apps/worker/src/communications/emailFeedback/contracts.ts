import { z } from "zod";

export const CLOUDFLARE_EVENT_PREFIX = "cf.email.sending.message.";
export const MAX_ATTEMPTS = 20;
export const MAX_REASON_LENGTH = 500;
export const MAX_SMTP_RESPONSE_LENGTH = 500;
export const MAX_BACKFILL_ORGANIZATIONS = 100;

export const emailProviderStatusSchema = z.enum([
  "accepted",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "rejected",
  "complained",
]);

export const emailProviderSourceKindSchema = z.enum([
  "communication_delivery",
  "ticket_notification",
  "audition_notification",
  "payment_notification",
  "platform_auth",
  "test_email",
]);

export type EmailProviderSourceKind = z.infer<typeof emailProviderSourceKindSchema>;
export type EmailProviderStatus = z.infer<typeof emailProviderStatusSchema>;

export const organizationEmailProviderSourceKindSchema = z.enum([
  "communication_delivery",
  "ticket_notification",
  "audition_notification",
  "payment_notification",
]);

export const cloudflareEventTypeSchema = z.enum([
  "cf.email.sending.message.delivered",
  "cf.email.sending.message.deferred",
  "cf.email.sending.message.bounced",
  "cf.email.sending.message.failed",
  "cf.email.sending.message.rejected",
  "cf.email.sending.message.complained",
]);

export const deliverySchema = z
  .looseObject({
    smtpEnhancedStatusCode: z.string().trim().max(32).optional(),
    smtpResponse: z.string().trim().max(MAX_SMTP_RESPONSE_LENGTH).optional(),
    smtpStatusCode: z.string().trim().max(32).optional(),
    status: emailProviderStatusSchema.optional(),
  })
  .optional();

export const cloudflareEmailEventSchema = z.looseObject({
  metadata: z.looseObject({
    eventTimestamp: z.string().trim().min(1).max(100),
  }),
  payload: z.looseObject({
    bounce: z
      .looseObject({
        reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
        type: z.enum(["hard", "soft"]).optional(),
      })
      .optional(),
    complaint: z
      .looseObject({ type: z.string().trim().max(MAX_REASON_LENGTH).optional() })
      .optional(),
    delivery: deliverySchema,
    eventId: z.string().trim().min(1).max(128),
    failure: z
      .looseObject({ reason: z.string().trim().max(MAX_REASON_LENGTH).optional() })
      .optional(),
    messageId: z.string().trim().min(1).max(512),
    recipient: z.email(),
    rejection: z
      .looseObject({
        detail: z.string().trim().max(MAX_REASON_LENGTH).optional(),
        party: z.string().trim().max(64).optional(),
        reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
      })
      .optional(),
    sender: z.email(),
    subject: z.string().max(500).optional(),
    terminal: z.boolean(),
  }),
  source: z.looseObject({
    domain: z.string().trim().min(1).max(253),
    type: z.literal("email.sending"),
  }),
  type: cloudflareEventTypeSchema,
});

export const providerRouteBackfillRowSchema = z.object({
  destination: z.email(),
  providerMessageId: z.string().trim().min(1).max(512),
  sourceId: z.string().trim().min(1).max(256),
  sourceKind: organizationEmailProviderSourceKindSchema,
});

export const providerRouteBackfillResponseSchema = z.object({
  nextOffset: z.number().int().nonnegative().nullable(),
  routes: z.array(providerRouteBackfillRowSchema).max(500),
});

export interface NormalizedEmailProviderEvent {
  readonly bounceType: "hard" | "soft" | null;
  readonly eventId: string;
  readonly eventTimestamp: string;
  readonly eventType: EmailProviderStatus;
  readonly messageId: string;
  readonly reason: string;
  readonly rejectionParty: "sender" | "recipient" | "other" | null;
  readonly recipient: string;
  readonly smtpEnhancedStatusCode: string | null;
  readonly smtpResponse: string;
  readonly smtpStatusCode: string | null;
  readonly sourceDomain: string;
  readonly terminal: boolean;
}

export interface EmailProviderRouteRow {
  readonly destination: string;
  readonly id: string;
  readonly organizationId: string | null;
  readonly providerMessageId: string | null;
  readonly sourceId: string;
  readonly sourceKind: EmailProviderSourceKind;
  readonly state: "pending" | "accepted" | "unknown";
}

export interface EmailProviderEventRow {
  readonly attempts: number;
  readonly bounceType: "hard" | "soft" | null;
  readonly eventId: string;
  readonly eventTimestamp: string;
  readonly eventType: EmailProviderStatus;
  readonly lastError: string;
  readonly messageId: string;
  readonly reason: string;
  readonly rejectionParty: "sender" | "recipient" | "other" | null;
  readonly recipient: string;
  readonly smtpEnhancedStatusCode: string | null;
  readonly smtpResponse: string;
  readonly smtpStatusCode: string | null;
  readonly sourceDomain: string;
  readonly state: "pending" | "processing" | "processed" | "dead_letter";
  readonly terminal: number;
  readonly operatorStatus: "open" | "acknowledged";
  readonly operatorReason: string;
  readonly operatorActorUserId: string | null;
  readonly operatorAt: string | null;
  readonly manualRetryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EmailProviderRouteInput {
  readonly destination: string;
  readonly organizationId?: string | null;
  readonly sourceId: string;
  readonly sourceKind: EmailProviderSourceKind;
}
