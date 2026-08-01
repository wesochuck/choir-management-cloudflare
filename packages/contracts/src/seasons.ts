import { z } from "zod";
import { requestIdSchema } from "./primitives";
import { transactionFeeSettingsSchema } from "./donations";
export const seasonSchema = z.object({
  createdAt: z.iso.datetime(),
  duesAmountCents: z.number().int().nonnegative(),
  endsAt: z.iso.datetime(),
  id: z.uuid(),
  isActive: z.boolean(),
  name: z.string().min(1).max(200),
  startsAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const seasonCreateRequestSchema = z.object({
  duesAmountCents: z.number().int().nonnegative(),
  endsAt: z.iso.datetime(),
  name: z.string().trim().min(1).max(200),
  startsAt: z.iso.datetime(),
});

export const seasonUpdateRequestSchema = seasonCreateRequestSchema;

export const seasonsResponseSchema = z.object({
  requestId: requestIdSchema,
  seasons: z.array(seasonSchema).max(500),
});

export const duesStatusSchema = z.enum(["pending", "paid", "refunded", "expired"]);
export const duesPaymentMethodSchema = z.enum(["cash", "online"]);

export const duesRecordSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  feeCents: z.number().int().nonnegative().default(0),
  id: z.uuid(),
  paidAt: z.iso.datetime().nullable(),
  paymentMethod: duesPaymentMethodSchema.default("online"),
  profileId: z.uuid(),
  refundRequested: z.boolean().default(false),
  seasonId: z.uuid(),
  status: duesStatusSchema,
  updatedAt: z.iso.datetime(),
});

export const duesRecordsResponseSchema = z.object({
  dues: z.array(duesRecordSchema).max(500),
  requestId: requestIdSchema,
});

export const duesCheckoutRequestSchema = z.object({
  checkoutRequestId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(500),
  seasonId: z.uuid(),
});

export const duesCashPaymentRequestSchema = z.object({
  profileId: z.uuid(),
  seasonId: z.uuid(),
});

export const memberDuesCheckoutRequestSchema = z.object({
  checkoutRequestId: z.uuid(),
  seasonId: z.uuid(),
});

export const duesCheckoutResponseSchema = z.object({
  checkoutMode: z.enum(["fake", "stripe"]),
  sessionId: z.string().min(1).max(256),
  url: z.url(),
});

export const memberDuesResponseSchema = z.object({
  dues: z.array(duesRecordSchema).max(500),
  requestId: requestIdSchema,
  seasons: z.array(seasonSchema).max(500),
  transactionFeeSettings: transactionFeeSettingsSchema,
});

export type Season = z.infer<typeof seasonSchema>;
export type SeasonCreateRequest = z.infer<typeof seasonCreateRequestSchema>;
export type SeasonUpdateRequest = z.infer<typeof seasonUpdateRequestSchema>;
export type SeasonsResponse = z.infer<typeof seasonsResponseSchema>;
export type DuesStatus = z.infer<typeof duesStatusSchema>;
export type DuesRecord = z.infer<typeof duesRecordSchema>;
export type DuesRecordsResponse = z.infer<typeof duesRecordsResponseSchema>;
export type DuesCheckoutRequest = z.infer<typeof duesCheckoutRequestSchema>;
export type DuesCashPaymentRequest = z.infer<typeof duesCashPaymentRequestSchema>;
export type DuesCheckoutResponse = z.infer<typeof duesCheckoutResponseSchema>;
export type MemberDuesCheckoutRequest = z.infer<typeof memberDuesCheckoutRequestSchema>;
export type MemberDuesResponse = z.infer<typeof memberDuesResponseSchema>;
