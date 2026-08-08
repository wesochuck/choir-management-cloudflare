import { z } from "zod";
import { organizationIdSchema, requestIdSchema } from "./primitives";
import {
  publicWebsiteSettingsRequestSchema,
  publicWebsiteSettingsSchema,
  publicPerformanceSchema,
} from "./organization";

export const discountCodeTypeSchema = z.enum(["fixed", "percentage"]);

const discountCodeTargetFieldsSchema = z.object({
  bundleId: z.uuid().nullable().default(null),
  eventId: z.uuid().nullable().default(null),
});

export const discountCodeTargetSchema = discountCodeTargetFieldsSchema.superRefine(
  (target, context) => {
    if ((target.eventId === null) === (target.bundleId === null)) {
      context.addIssue({
        code: "custom",
        message: "A discount code must target exactly one Performance or Ticket Bundle.",
        path: [target.eventId === null ? "bundleId" : "eventId"],
      });
    }
  },
);

const discountCodeRequestFieldsSchema = z.object({
  active: z.boolean().default(true),
  bundleId: z.uuid().nullable().default(null),
  code: z.string().trim().min(1).max(64),
  discountType: discountCodeTypeSchema,
  discountValue: z.number().int().nonnegative(),
  eventId: z.uuid().nullable().default(null),
  redemptionLimit: z.number().int().positive().nullable().default(null),
});

export const discountCodeRequestSchema = discountCodeRequestFieldsSchema.superRefine(
  (code, context) => {
    if ((code.eventId === null) === (code.bundleId === null)) {
      context.addIssue({
        code: "custom",
        message: "A discount code must target exactly one Performance or Ticket Bundle.",
        path: [code.eventId === null ? "bundleId" : "eventId"],
      });
    }
    if (code.discountType === "percentage" && code.discountValue > 100) {
      context.addIssue({
        code: "custom",
        message: "Percentage discounts must be between 1% and 100%.",
        path: ["discountValue"],
      });
    }
    if (code.discountType === "percentage" && code.discountValue < 1) {
      context.addIssue({
        code: "custom",
        message: "Percentage discounts must be between 1% and 100%.",
        path: ["discountValue"],
      });
    }
  },
);

export const discountCodeSchema = z.object({
  active: z.boolean(),
  bundleId: z.uuid().nullable(),
  code: z.string().min(1).max(64),
  createdAt: z.iso.datetime(),
  deactivatedAt: z.iso.datetime().nullable(),
  discountAmountCents: z.number().int().nonnegative(),
  discountType: discountCodeTypeSchema,
  discountValue: z.number().int().nonnegative(),
  editable: z.boolean(),
  eventId: z.uuid().nullable(),
  firstRedeemedAt: z.iso.datetime().nullable(),
  id: z.uuid(),
  itemTitle: z.string().min(1).max(500),
  itemType: z.enum(["performance", "bundle"]),
  originalRevenueCents: z.number().int().nonnegative(),
  pendingReservationCount: z.number().int().nonnegative(),
  redemptionCount: z.number().int().nonnegative(),
  redemptionLimit: z.number().int().positive().nullable(),
  revenueCents: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export const discountCodeListResponseSchema = z.object({
  codes: z.array(discountCodeSchema).max(500),
  requestId: requestIdSchema,
});

export const publicTicketDiscountAvailabilityRequestSchema =
  discountCodeTargetFieldsSchema.superRefine((target, context) => {
    if ((target.eventId === null) === (target.bundleId === null)) {
      context.addIssue({
        code: "custom",
        message: "A discount availability request must target exactly one item.",
        path: [target.eventId === null ? "bundleId" : "eventId"],
      });
    }
  });

export const publicTicketDiscountAvailabilityResponseSchema = z.object({
  hasRedeemableCode: z.boolean(),
});

const ticketCheckoutTargetFieldsSchema = z.object({
  bundleId: z.uuid().nullable().default(null),
  discountCode: z.string().trim().max(64).optional(),
  eventId: z.uuid().nullable().default(null),
  quantity: z.number().int().min(1).max(10),
});

export const ticketCheckoutQuoteRequestSchema = ticketCheckoutTargetFieldsSchema.superRefine(
  (target, context) => {
    if ((target.eventId === null) === (target.bundleId === null)) {
      context.addIssue({
        code: "custom",
        message: "A ticket quote must target exactly one Performance or Ticket Bundle.",
        path: [target.eventId === null ? "bundleId" : "eventId"],
      });
    }
  },
);

export const ticketCheckoutQuoteSchema = z.object({
  discountAmountCents: z.number().int().nonnegative(),
  discountCode: z.string().min(1).max(64).nullable(),
  discountType: discountCodeTypeSchema.nullable(),
  discountValue: z.number().int().nonnegative().nullable(),
  discountedSubtotalCents: z.number().int().nonnegative(),
  feeCents: z.number().int().nonnegative(),
  originalSubtotalCents: z.number().int().nonnegative(),
  originalUnitPriceCents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  totalCents: z.number().int().nonnegative(),
});
const ticketBuyerSchema = z.object({
  buyerEmail: z.email().max(320),
  buyerName: z.string().trim().min(1).max(200),
  checkoutRequestId: z.uuid(),
  marketingOptIn: z.boolean().default(false),
  quantity: z.number().int().min(1).max(10),
  discountCode: z.string().trim().max(64).optional(),
});

export const ticketCheckoutRequestSchema = z.union([
  ticketBuyerSchema.extend({ bundleId: z.never().optional(), eventId: z.uuid() }),
  ticketBuyerSchema.extend({ bundleId: z.uuid(), eventId: z.never().optional() }),
]);

export const ticketPurchaseStatusSchema = z.enum(["pending", "paid", "refunded", "expired"]);
export const ticketCheckoutModeSchema = z.enum(["fake", "free", "stripe"]);

export const publicTicketPurchaseSchema = z.object({
  amountPaidCents: z.number().int().nonnegative(),
  bundleId: z.uuid().nullable().default(null),
  bundleTitle: z.string().max(500).default(""),
  buyerName: z.string().min(1).max(200),
  checkoutMode: ticketCheckoutModeSchema,
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
  discountAmountCents: z.number().int().nonnegative().default(0),
  discountCode: z.string().min(1).max(64).nullable().default(null),
  discountType: discountCodeTypeSchema.nullable().default(null),
  discountValue: z.number().int().nonnegative().nullable().default(null),
  discountedSubtotalCents: z.number().int().nonnegative().default(0),
  originalSubtotalCents: z.number().int().nonnegative().default(0),
  originalUnitPriceCents: z.number().int().nonnegative().default(0),
  status: ticketPurchaseStatusSchema,
  timezone: z.string().min(1).max(128),
  unitPriceCents: z.number().int().nonnegative(),
});

export const ticketCheckoutResponseSchema = z.object({
  checkoutMode: ticketCheckoutModeSchema,
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

export type DiscountCode = z.infer<typeof discountCodeSchema>;
export type DiscountCodeRequest = z.infer<typeof discountCodeRequestSchema>;
export type TicketCheckoutQuote = z.infer<typeof ticketCheckoutQuoteSchema>;
export type TicketCheckoutQuoteRequest = z.infer<typeof ticketCheckoutQuoteRequestSchema>;
