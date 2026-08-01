import { z } from "zod";
import { organizationIdSchema, requestIdSchema } from "./primitives";
import {
  publicWebsiteSettingsRequestSchema,
  publicWebsiteSettingsSchema,
  publicPerformanceSchema,
} from "./organization";
const ticketBuyerSchema = z.object({
  buyerEmail: z.email().max(320),
  buyerName: z.string().trim().min(1).max(200),
  checkoutRequestId: z.uuid(),
  marketingOptIn: z.boolean().default(false),
  quantity: z.number().int().min(1).max(10),
});

export const ticketCheckoutRequestSchema = z.union([
  ticketBuyerSchema.extend({ bundleId: z.never().optional(), eventId: z.uuid() }),
  ticketBuyerSchema.extend({ bundleId: z.uuid(), eventId: z.never().optional() }),
]);

export const ticketPurchaseStatusSchema = z.enum(["pending", "paid", "refunded", "expired"]);

export const publicTicketPurchaseSchema = z.object({
  amountPaidCents: z.number().int().nonnegative(),
  bundleId: z.uuid().nullable().default(null),
  bundleTitle: z.string().max(500).default(""),
  buyerName: z.string().min(1).max(200),
  checkoutMode: z.enum(["fake", "stripe"]),
  currency: z.literal("usd"),
  eventId: z.uuid(),
  eventStartsAt: z.iso.datetime(),
  eventTitle: z.string().min(1).max(500),
  feeCents: z.number().int().nonnegative(),
  id: z.uuid(),
  includedEvents: z
    .array(
      z.object({
        id: z.uuid(),
        startsAt: z.iso.datetime(),
        title: z.string().min(1).max(500),
      }),
    )
    .max(100)
    .default([]),
  quantity: z.number().int().positive(),
  status: ticketPurchaseStatusSchema,
  timezone: z.string().min(1).max(128),
  unitPriceCents: z.number().int().nonnegative(),
});

export const ticketCheckoutResponseSchema = z.object({
  checkoutMode: z.enum(["fake", "stripe"]),
  purchase: publicTicketPurchaseSchema,
  successToken: z.string().min(1).max(4096),
  url: z.url(),
});

export const publicTicketPurchaseResponseSchema = publicTicketPurchaseSchema.extend({
  requestId: requestIdSchema,
  scanToken: z.string().min(1).max(4096),
});

export const ticketScanRequestSchema = z.object({
  eventId: z.uuid(),
  token: z.string().min(1).max(4096),
});

export const ticketScanResultSchema = z.discriminatedUnion("valid", [
  z.object({
    buyerName: z.string().min(1).max(200),
    eventId: z.uuid(),
    eventStartsAt: z.iso.datetime(),
    eventTitle: z.string().min(1).max(500),
    purchaseId: z.uuid(),
    quantity: z.number().int().positive(),
    valid: z.literal(true),
  }),
  z.object({
    reason: z.enum(["not_found", "not_paid", "wrong_event"]),
    valid: z.literal(false),
  }),
]);

export const ticketScanResponseSchema = ticketScanResultSchema.and(
  z.object({ requestId: requestIdSchema }),
);

export const organizationTicketOrderSchema = publicTicketPurchaseSchema.extend({
  buyerEmail: z.email().max(320),
  createdAt: z.iso.datetime(),
  marketingOptIn: z.boolean(),
  providerPaymentId: z.string().max(256),
  providerSessionId: z.string().max(256),
  refundRequested: z.boolean().default(false),
  updatedAt: z.iso.datetime(),
});

export const organizationTicketOrdersResponseSchema = z.object({
  orders: z.array(organizationTicketOrderSchema).max(500),
  requestId: requestIdSchema,
});

export const ticketBundleRequestSchema = z.object({
  capacity: z.number().int().positive().max(100_000).nullable().default(null),
  eventIds: z.array(z.uuid()).min(1).max(100),
  isActive: z.boolean().default(true),
  priceCents: z.number().int().nonnegative().max(10_000_000),
  saleEndAt: z.iso.datetime(),
  title: z.string().trim().min(1).max(500),
});

export const ticketBundleSchema = ticketBundleRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const ticketBundlesResponseSchema = z.object({
  bundles: z.array(ticketBundleSchema).max(100),
  requestId: requestIdSchema,
});

export const publicTicketBundleSchema = z.object({
  capacity: z.number().int().positive().nullable(),
  eventIds: z.array(z.uuid()).min(1).max(100),
  id: z.uuid(),
  priceCents: z.number().int().nonnegative(),
  saleEndAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
});

export const publicWebsiteProjectionPayloadSchema = z.object({
  mediaFileIds: z.array(z.uuid()).max(102),
  organizationName: z.string().min(1).max(120),
  performances: z.array(publicPerformanceSchema).max(100),
  settings: publicWebsiteSettingsRequestSchema,
  ticketBundles: z.array(publicTicketBundleSchema).max(100).default([]),
  timezone: z.string().min(1).max(128),
});

export const publishedOrganizationProjectionSchema = z.object({
  generatedAt: z.iso.datetime(),
  organizationId: organizationIdSchema,
  payload: publicWebsiteProjectionPayloadSchema,
  version: z.number().int().positive().max(2_147_483_647),
});

export const publicWebsiteSettingsResponseSchema = publicWebsiteSettingsSchema.extend({
  requestId: requestIdSchema,
});

export const publicWebsitePublishResponseSchema = z.object({
  publishedAt: z.iso.datetime(),
  requestId: requestIdSchema,
  version: z.number().int().positive(),
});
