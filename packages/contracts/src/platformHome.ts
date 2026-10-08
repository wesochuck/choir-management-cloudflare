import { z } from "zod";

import { requestIdSchema } from "./primitives";

/** Upper bound for ticket listings shown on the platform home page. */
export const MAX_PLATFORM_HOME_TICKET_LISTINGS = 24;

function singleLineText(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !/[\r\n]/.test(value), "Use a single line of plain text.");
}

/**
 * A published, upcoming, ticketed performance from one Organization, linking to that
 * Organization's own ticket page. Derived only from already-public published projections.
 */
export const platformHomeTicketListingSchema = z.object({
  eventId: z.uuid(),
  organizationName: z.string().min(1).max(120),
  startsAt: z.iso.datetime(),
  ticketsUrl: z.url({ protocol: /^https?$/ }).max(2_048),
  timezone: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  venueName: z.string().max(500),
});

export const platformHomeTicketListingsResponseSchema = z.object({
  listings: z.array(platformHomeTicketListingSchema).max(MAX_PLATFORM_HOME_TICKET_LISTINGS),
  requestId: requestIdSchema,
});

/**
 * A short inquiry from a prospective nonprofit, emailed to Platform Administrators.
 * `website` is a honeypot: people never see it, so a non-empty value marks automated input.
 */
export const platformInquiryRequestSchema = z.object({
  contactName: singleLineText(120),
  email: z.email().max(320),
  location: z
    .string()
    .trim()
    .max(120)
    .refine((value) => !/[\r\n]/.test(value), "Use a single line of plain text.")
    .default(""),
  message: z.string().trim().max(4_000).default(""),
  organizationName: singleLineText(200),
  turnstileToken: z.string().optional(),
  website: z.string().max(500).default(""),
});

export const platformInquiryResponseSchema = z.object({
  accepted: z.literal(true),
  requestId: requestIdSchema,
});

export type PlatformHomeTicketListing = z.infer<typeof platformHomeTicketListingSchema>;
export type PlatformHomeTicketListingsResponse = z.infer<
  typeof platformHomeTicketListingsResponseSchema
>;
export type PlatformInquiryRequest = z.input<typeof platformInquiryRequestSchema>;
export type PlatformInquiryResponse = z.infer<typeof platformInquiryResponseSchema>;
