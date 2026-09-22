import { z } from "zod";
import { requestIdSchema } from "./primitives";

export const donationStatusSchema = z.enum(["pending", "paid", "refunded", "expired"]);

export const donationPaymentMethodSchema = z.enum([
  "stripe",
  "check",
  "cash",
  "bank_transfer",
  "card_offline",
  "other",
]);

export const donationTributeTypeSchema = z.enum(["honor", "memory", "anonymous", "none"]);

export const donationLevelSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
  benefit: z.string().trim().max(1_000),
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(120),
});

export const donationSettingsSchema = z.object({
  buttonText: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  levels: z.array(donationLevelSchema).max(20),
});

export const donationSettingsResponseSchema = donationSettingsSchema.extend({
  requestId: requestIdSchema,
});

export const transactionFeeSettingsSchema = z.object({
  fixedCents: z.number().int().nonnegative().max(100_000),
  passFeeToDonor: z.boolean().default(false),
  percentage: z.number().min(0).max(99.99),
});

export const transactionFeeSettingsResponseSchema = transactionFeeSettingsSchema.extend({
  requestId: requestIdSchema,
});

const defaultAdmissionInstructions =
  "Keep this confirmation available on your phone. Present the QR code at the door if requested.";

const ticketConfirmationSettingsFields = {
  admissionInstructions: z.string().trim().max(5_000),
  pendingMessage: z.string().trim().max(5_000),
  qrCodeInstructions: z.string().trim().max(5_000),
  successMessage: z.string().trim().max(5_000),
  willCallInstructions: z.string().trim().max(5_000),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAdmissionInstructions(raw: Record<string, unknown>): Record<string, unknown> {
  const instructions =
    typeof raw.admissionInstructions === "string" && raw.admissionInstructions.trim().length > 0
      ? raw.admissionInstructions.trim()
      : typeof raw.willCallInstructions === "string" && raw.willCallInstructions.trim().length > 0
        ? raw.willCallInstructions.trim()
        : defaultAdmissionInstructions;
  return {
    ...raw,
    admissionInstructions: instructions,
    willCallInstructions: instructions,
  };
}

export const ticketConfirmationSettingsSchema = z.preprocess(
  (val) => (isRecord(val) ? normalizeAdmissionInstructions(val) : val),
  z.object(ticketConfirmationSettingsFields),
);

export const ticketConfirmationSettingsResponseSchema = z.preprocess(
  (val) => (isRecord(val) ? normalizeAdmissionInstructions(val) : val),
  z.object({
    ...ticketConfirmationSettingsFields,
    requestId: requestIdSchema,
  }),
);

export const donationCheckoutRequestSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
  anonymous: z.boolean().default(false),
  buyerEmail: z.email().max(320),
  buyerName: z.string().trim().min(1).max(200),
  checkoutRequestId: z.uuid(),
  marketingConsent: z.boolean().default(false),
  tributeName: z.string().trim().max(500).default(""),
  tributeNotifyEmail: z.union([z.literal(""), z.email().max(320)]).default(""),
  tributeType: donationTributeTypeSchema.default("none"),
});

export const manualDonationCreateRequestSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
  anonymous: z.boolean().default(false),
  buyerEmail: z.union([z.literal(""), z.email().max(320)]).default(""),
  buyerName: z.string().trim().min(1).max(200),
  marketingConsent: z.boolean().default(false),
  paymentMethod: donationPaymentMethodSchema.exclude(["stripe"]).default("check"),
  paymentReference: z.string().trim().max(500).default(""),
  receivedAt: z.iso.datetime().optional(),
  thankYouSent: z.boolean().default(false),
  tributeName: z.string().trim().max(500).default(""),
  tributeNotifyEmail: z.union([z.literal(""), z.email().max(320)]).default(""),
  tributeType: donationTributeTypeSchema.default("none"),
});

export const donationThankYouUpdateRequestSchema = z.object({
  donationId: z.uuid(),
  thankYouSent: z.boolean(),
});

export const donationRefundRequestSchema = z.object({
  donationId: z.uuid(),
});

export const donationRecordSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  anonymous: z.boolean(),
  buyerEmail: z.string().max(320),
  buyerName: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  expiredAt: z.iso.datetime().nullable(),
  feeCents: z.number().int().nonnegative().default(0),
  id: z.uuid(),
  marketingConsent: z.boolean(),
  patronId: z.uuid().nullable(),
  paymentMethod: donationPaymentMethodSchema.default("stripe"),
  paymentReference: z.string().max(500).default(""),
  refundRequested: z.boolean().default(false),
  status: donationStatusSchema,
  thankYouSentAt: z.iso.datetime().nullable().default(null),
  tributeName: z.string().max(500),
  tributeNotifyEmail: z.string().max(320),
  tributeType: donationTributeTypeSchema,
  updatedAt: z.iso.datetime(),
});

export const donationResponseSchema = z.object({
  donation: donationRecordSchema,
  requestId: requestIdSchema,
});

export const donationRecordsResponseSchema = z.object({
  donations: z.array(donationRecordSchema).max(500),
  requestId: requestIdSchema,
});

export const publicDonationReceiptResponseSchema = donationRecordSchema.extend({
  requestId: requestIdSchema,
});

export const donationCheckoutResponseSchema = z.object({
  checkoutMode: z.enum(["fake", "stripe"]),
  donation: donationRecordSchema,
  successToken: z.string().min(1).max(4096),
  url: z.url(),
});

export const patronRecordSchema = z.object({
  donationCount: z.number().int().nonnegative(),
  email: z.email().max(320),
  firstDonatedAt: z.iso.datetime(),
  id: z.uuid(),
  lastDonatedAt: z.iso.datetime(),
  name: z.string().min(1).max(200),
  totalDonatedCents: z.number().int().nonnegative(),
});

export const patronRecordsResponseSchema = z.object({
  patrons: z.array(patronRecordSchema).max(500),
  requestId: requestIdSchema,
});

export type DonationStatus = z.infer<typeof donationStatusSchema>;
export type DonationPaymentMethod = z.infer<typeof donationPaymentMethodSchema>;
export type DonationTributeType = z.infer<typeof donationTributeTypeSchema>;
export type DonationLevel = z.infer<typeof donationLevelSchema>;
export type DonationSettings = z.infer<typeof donationSettingsSchema>;
export type TransactionFeeSettings = z.infer<typeof transactionFeeSettingsSchema>;
export type TicketConfirmationSettings = z.infer<typeof ticketConfirmationSettingsSchema>;
export type DonationCheckoutRequest = z.infer<typeof donationCheckoutRequestSchema>;
export type ManualDonationCreateRequest = z.infer<typeof manualDonationCreateRequestSchema>;
export type DonationThankYouUpdateRequest = z.infer<typeof donationThankYouUpdateRequestSchema>;
export type DonationRecord = z.infer<typeof donationRecordSchema>;
export type DonationRefundRequest = z.infer<typeof donationRefundRequestSchema>;
export type DonationResponse = z.infer<typeof donationResponseSchema>;
export type DonationCheckoutResponse = z.infer<typeof donationCheckoutResponseSchema>;
export type PublicDonationReceiptResponse = z.infer<typeof publicDonationReceiptResponseSchema>;
export type PatronRecord = z.infer<typeof patronRecordSchema>;
