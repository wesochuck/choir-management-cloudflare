import { z } from "zod";
export const organizationSetListItemSchema = z.object({
  composer: z.string().trim().max(300).optional(),
  duration: z.string().trim().max(20).optional(),
  id: z.string().trim().min(1).max(128).optional(),
  isFeaturedNumber: z.boolean().optional(),
  notes: z.string().trim().max(10_000).optional(),
  performerCredits: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          displayName: z.string().trim().min(1).max(200),
          kind: z.literal("guest"),
        }),
        z.object({
          displayName: z.string().trim().min(1).max(200),
          kind: z.literal("profile"),
          profileId: z.uuid(),
        }),
      ]),
    )
    .max(100)
    .optional(),
  pieceId: z.uuid().optional(),
  soloSmallGroup: z.boolean().optional(),
  title: z.string().trim().min(1).max(300),
  type: z.enum(["intermission", "song"]).optional(),
});

export const organizationEventFieldsSchema = z.object({
  advancePriceCents: z.number().int().nonnegative().max(10_000_000).default(0),
  callTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).default(""),
  dayOfPriceCents: z.number().int().nonnegative().max(10_000_000).default(0),
  details: z.string().max(100_000).default(""),
  doorsOpenTime: z
    .union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)])
    .default(""),
  durationMinutes: z.number().int().positive().max(1_440).nullable().default(null),
  isTicketingEnabled: z.boolean().default(false),
  location: z.string().trim().max(2_000).default(""),
  parentPerformanceId: z.uuid().nullable().default(null),
  publicDetails: z.string().max(100_000).default(""),
  publicGraphicFileId: z.uuid().nullable().default(null),
  publishOnWebsite: z.boolean().default(false),
  rsvpFollowUpLeadHours: z.number().int().min(1).max(720).nullable().default(null),
  rsvpFollowUpMode: z.enum(["inherit", "enabled", "disabled"]).default("inherit"),
  setList: z.array(organizationSetListItemSchema).max(200).default([]),
  setListApproved: z.boolean().default(false),
  setListDefaultTransitionSeconds: z.number().int().min(0).max(3_600).default(0),
  startsAt: z.iso.datetime(),
  ticketCapacity: z.number().int().positive().max(100_000).nullable().default(null),
  title: z.string().trim().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal"]),
  venueId: z.uuid().nullable().default(null),
  rsvpDeadlineDate: z.iso.date().nullable().default(null),
});

export const organizationEventRequestSchema = organizationEventFieldsSchema.superRefine(
  (event, context) => {
    if (event.type !== "Rehearsal" && event.parentPerformanceId !== null) {
      context.addIssue({
        code: "custom",
        message: "A parent performance can only be selected for a rehearsal.",
        path: ["parentPerformanceId"],
      });
    }
    if (event.type === "Rehearsal" && event.rsvpFollowUpMode !== "inherit") {
      context.addIssue({
        code: "custom",
        message: "Rehearsals inherit RSVP follow-up settings from their parent Performance.",
        path: ["rsvpFollowUpMode"],
      });
    }
    if (event.rsvpFollowUpMode === "enabled" && event.rsvpFollowUpLeadHours === null) {
      context.addIssue({
        code: "custom",
        message: "An RSVP follow-up lead time is required when the event override is enabled.",
        path: ["rsvpFollowUpLeadHours"],
      });
    }
    if (event.rsvpFollowUpMode !== "enabled" && event.rsvpFollowUpLeadHours !== null) {
      context.addIssue({
        code: "custom",
        message: "A custom RSVP follow-up lead time requires an enabled event override.",
        path: ["rsvpFollowUpLeadHours"],
      });
    }
    if (event.type === "Performance" && event.rsvpDeadlineDate === null) {
      context.addIssue({
        code: "custom",
        message: "A member RSVP deadline is required for a Performance.",
        path: ["rsvpDeadlineDate"],
      });
    }
    if (event.type === "Rehearsal" && event.rsvpDeadlineDate !== null) {
      context.addIssue({
        code: "custom",
        message: "Rehearsals do not use an RSVP deadline.",
        path: ["rsvpDeadlineDate"],
      });
    }
  },
);

export const publicWebsiteFontSchema = z.enum([
  "system",
  "serif",
  "modern-serif",
  "friendly-sans",
  "formal-sans",
  "casual-handwritten",
  "formal-script",
]);

export const publicWebsiteSettingsRequestSchema = z.object({
  aboutUsText: z.string().max(100_000).default(""),
  bodyFont: publicWebsiteFontSchema.default("system"),
  contactEmail: z.union([z.literal(""), z.email()]).default(""),
  enabledNavigation: z
    .array(z.enum(["auditions", "donations", "tickets"]))
    .max(3)
    .default([]),
  headerFont: publicWebsiteFontSchema.default("system"),
  heroFileId: z.uuid().nullable().default(null),
  heroHeadline: z.string().trim().min(1).max(300).default("Welcome to Our Choir"),
  heroSubtitle: z.string().trim().max(1_000).default("Voices united in harmony."),
  historyText: z.string().max(100_000).default(""),
  logoFileId: z.uuid().nullable().default(null),
  showBrandingHeaderFooter: z.boolean().default(false),
});

export const publicWebsiteSettingsSchema = publicWebsiteSettingsRequestSchema.extend({
  organizationName: z.string().min(1).max(120),
  publicationVersion: z.number().int().nonnegative(),
  publishedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

export const publicPerformanceSchema = z.object({
  advancePriceCents: z.number().int().nonnegative(),
  dayOfPriceCents: z.number().int().nonnegative(),
  doorsOpenTime: z.string().max(5),
  graphicFileId: z.uuid().nullable(),
  id: z.uuid(),
  isTicketingEnabled: z.boolean(),
  location: z.string().max(2_000),
  publicDetails: z.string().max(100_000),
  startsAt: z.iso.datetime(),
  ticketCapacity: z.number().int().positive().nullable(),
  title: z.string().min(1).max(500),
  venueAddress: z.string().max(2_000).default(""),
  venueName: z.string().max(500),
});

export const organizationBrandingRequestSchema = z.object({
  logoFileId: z.uuid().nullable().default(null),
  physicalAddress: z.string().max(2_000).nullable().default(null),
});

export const organizationBrandingSchema = organizationBrandingRequestSchema.extend({
  organizationId: z.string().min(1).max(128),
  organizationName: z.string().min(1).max(120),
});

export type OrganizationBrandingRequest = z.infer<typeof organizationBrandingRequestSchema>;
export type OrganizationBranding = z.infer<typeof organizationBrandingSchema>;
