import { z } from "zod";
import { requestIdSchema } from "./primitives";
export const donationStatusSchema = z.enum(["pending", "paid", "refunded", "expired"]);

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
  percentage: z.number().min(0).max(100),
});

export const transactionFeeSettingsResponseSchema = transactionFeeSettingsSchema.extend({
  requestId: requestIdSchema,
});

export const ticketConfirmationSettingsSchema = z.object({
  pendingMessage: z.string().trim().max(5_000),
  qrCodeInstructions: z.string().trim().max(5_000),
  successMessage: z.string().trim().max(5_000),
  willCallInstructions: z.string().trim().max(5_000),
});

export const ticketConfirmationSettingsResponseSchema = ticketConfirmationSettingsSchema.extend({
  requestId: requestIdSchema,
});

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

export const donationRefundRequestSchema = z.object({
  donationId: z.uuid(),
});

export const donationRecordSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  anonymous: z.boolean(),
  buyerEmail: z.email().max(320),
  buyerName: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  expiredAt: z.iso.datetime().nullable(),
  feeCents: z.number().int().nonnegative().default(0),
  id: z.uuid(),
  marketingConsent: z.boolean(),
  patronId: z.uuid().nullable(),
  refundRequested: z.boolean().default(false),
  status: donationStatusSchema,
  tributeName: z.string().max(500),
  tributeNotifyEmail: z.string().max(320),
  tributeType: donationTributeTypeSchema,
  updatedAt: z.iso.datetime(),
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
export type DonationTributeType = z.infer<typeof donationTributeTypeSchema>;
export type DonationLevel = z.infer<typeof donationLevelSchema>;
export type DonationSettings = z.infer<typeof donationSettingsSchema>;
export type TransactionFeeSettings = z.infer<typeof transactionFeeSettingsSchema>;
export type TicketConfirmationSettings = z.infer<typeof ticketConfirmationSettingsSchema>;
export type DonationCheckoutRequest = z.infer<typeof donationCheckoutRequestSchema>;
export type DonationRecord = z.infer<typeof donationRecordSchema>;
export type DonationRefundRequest = z.infer<typeof donationRefundRequestSchema>;
export type DonationCheckoutResponse = z.infer<typeof donationCheckoutResponseSchema>;
export type PublicDonationReceiptResponse = z.infer<typeof publicDonationReceiptResponseSchema>;
export type PatronRecord = z.infer<typeof patronRecordSchema>;
