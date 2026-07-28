import { z } from "zod";

export const organizationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export type OrganizationId = z.infer<typeof organizationIdSchema>;

export const requestIdSchema = z.uuid();

export const healthResponseSchema = z.object({
  environment: z.enum(["local", "preview", "staging", "production"]),
  requestId: requestIdSchema,
  service: z.literal("choir-management-cloudflare"),
  status: z.literal("ok"),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const organizationContextResponseSchema = z.object({
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  role: z.enum(["owner", "administrator", "member"]),
  userId: z.string().min(1),
});

export type OrganizationContextResponse = z.infer<typeof organizationContextResponseSchema>;

export const organizationProfileRequestSchema = z.object({
  doNotEmail: z.boolean().default(false),
  displayName: z.string().trim().min(1).max(200),
  globalStatus: z.enum(["Active", "Idle", "Inactive"]).default("Active"),
  isSectionLeader: z.boolean().default(false),
  notes: z.string().trim().max(100_000).default(""),
  phone: z.string().trim().max(50).default(""),
  receiveAdminNotifications: z.boolean().default(true),
  receiveAttendanceReports: z.boolean().default(true),
  receiveFinancialAlerts: z.boolean().default(false),
  receiveRsvpDeclineNotices: z.boolean().default(false),
  showInDirectory: z.boolean().default(true),
  voicePart: z.string().trim().max(100).default(""),
});

export const organizationProfileSchema = organizationProfileRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  photoFileId: z.uuid().nullable().default(null),
  updatedAt: z.iso.datetime(),
});

export const organizationProfileResponseSchema = organizationProfileSchema.extend({
  requestId: requestIdSchema,
});

export const organizationProfilesResponseSchema = z.object({
  profiles: z.array(organizationProfileSchema).max(500),
  requestId: requestIdSchema,
});

export const organizationProfileImportResponseSchema = z.object({
  imported: z.number().int().min(0).max(500),
  invitationCandidates: z.number().int().min(0).max(500),
  requestId: requestIdSchema,
});

export type OrganizationProfileRequest = z.infer<typeof organizationProfileRequestSchema>;
export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;
export type OrganizationProfileResponse = z.infer<typeof organizationProfileResponseSchema>;
export type OrganizationProfilesResponse = z.infer<typeof organizationProfilesResponseSchema>;

export const memberProfileUpdateRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).default(""),
  showInDirectory: z.boolean().default(true),
});

export const memberProfileSchema = memberProfileUpdateRequestSchema.extend({
  email: z.email(),
  globalStatus: z.enum(["Active", "Idle", "Inactive"]),
  id: z.uuid(),
  photoFileId: z.uuid().nullable().default(null),
  voicePart: z.string().max(100),
});

export const memberProfileResponseSchema = memberProfileSchema.extend({
  requestId: requestIdSchema,
});

export const organizationDirectoryProfileSchema = z.object({
  displayName: z.string().min(1).max(200),
  email: z.union([z.literal(""), z.email()]),
  id: z.uuid(),
  photoFileId: z.uuid().nullable().default(null),
  phone: z.string().max(50),
  voicePart: z.string().max(100),
});

export const organizationDirectoryResponseSchema = z.object({
  profiles: z.array(organizationDirectoryProfileSchema).max(500),
  requestId: requestIdSchema,
});

export type MemberProfileUpdateRequest = z.infer<typeof memberProfileUpdateRequestSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type OrganizationDirectoryProfile = z.infer<typeof organizationDirectoryProfileSchema>;

export const organizationVenueRequestSchema = z.object({
  address: z.string().trim().max(2_000).default(""),
  name: z.string().trim().min(1).max(500),
});

export const organizationVenueSchema = organizationVenueRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const organizationVenuesResponseSchema = z.object({
  requestId: requestIdSchema,
  venues: z.array(organizationVenueSchema).max(500),
});

export const organizationVenueDeleteResponseSchema = z.object({
  requestId: requestIdSchema,
  status: z.literal("deleted"),
  venueId: z.uuid(),
});

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

export const organizationEventRequestSchema = z.object({
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
  setList: z.array(organizationSetListItemSchema).max(200).default([]),
  setListApproved: z.boolean().default(false),
  startsAt: z.iso.datetime(),
  ticketCapacity: z.number().int().positive().max(100_000).nullable().default(null),
  title: z.string().trim().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal"]),
  venueId: z.uuid().nullable().default(null),
});

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
  venueName: z.string().max(500),
});

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

export const organizationEventSchema = organizationEventRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const organizationEventsResponseSchema = z.object({
  events: z.array(organizationEventSchema).max(500),
  requestId: requestIdSchema,
});

export const organizationDashboardEventSchema = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal"]),
});

export const organizationDashboardSummaryResponseSchema = z.object({
  activeProfileCount: z.number().int().nonnegative(),
  nextEvents: z.array(organizationDashboardEventSchema).max(5),
  requestId: requestIdSchema,
  upcomingEventCount: z.number().int().nonnegative(),
});

export const organizationEventArchiveResponseSchema = z.object({
  eventId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("archived"),
});

export const organizationRsvpRequestSchema = z.object({
  profileId: z.uuid(),
  rsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string().trim().max(2_000).default(""),
});

export const organizationRsvpSchema = organizationRsvpRequestSchema.extend({
  eventId: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export const organizationAttendanceStatusSchema = z.enum(["Present", "Absent", "Pending"]);

export const organizationAttendanceUpdateSchema = z.object({
  attendance: organizationAttendanceStatusSchema,
  folderNumber: z.string().trim().max(50).optional(),
  folderReturned: z.boolean().optional(),
  profileId: z.uuid(),
});

export const organizationAttendanceBulkRequestSchema = z.object({
  updates: z.array(organizationAttendanceUpdateSchema).min(1).max(500),
});

export const organizationAttendanceRowSchema = z.object({
  attendance: organizationAttendanceStatusSchema,
  displayName: z.string().min(1).max(200),
  folderNumber: z.string().max(50),
  folderReturned: z.boolean(),
  profileId: z.uuid(),
  rsvp: z.enum(["Yes", "No", "Pending"]),
  updatedAt: z.iso.datetime().nullable(),
});

export const organizationAttendanceResponseSchema = z.object({
  eventId: z.uuid(),
  requestId: requestIdSchema,
  rows: z.array(organizationAttendanceRowSchema).max(500),
});

export const singerRsvpRequestSchema = z.object({
  rsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string().trim().max(2_000).default(""),
});

export const singerEventSchema = z.object({
  callTime: z.string().max(5),
  details: z.string().max(100_000),
  directRsvp: z.enum(["Yes", "No", "Pending"]),
  durationMinutes: z.number().int().positive().nullable(),
  id: z.uuid(),
  inheritedFromParent: z.boolean(),
  location: z.string().max(2_000),
  resolvedRsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string().max(2_000),
  setList: z.array(organizationSetListItemSchema).max(200).default([]),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal"]),
  venueAddress: z.string().max(2_000),
  venueName: z.string().max(500),
});

export const singerEventsResponseSchema = z.object({
  events: z.array(singerEventSchema).max(500),
  profileId: z.uuid(),
  requestId: requestIdSchema,
  timezone: z.string().min(1).max(100),
});

export const organizationCalendarSettingsRequestSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
});

export const organizationCalendarSettingsResponseSchema =
  organizationCalendarSettingsRequestSchema.extend({ requestId: requestIdSchema });

export const organizationSectionSchema = z.object({
  code: z.string().trim().min(1).max(20),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/),
  name: z.string().trim().min(1).max(100),
  trackOnly: z.boolean().default(false),
});

export const organizationVoicePartSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(50),
  sectionCode: z.string().trim().min(1).max(20),
});

export const organizationRosterConfigurationRequestSchema = z
  .object({
    sections: z.array(organizationSectionSchema).min(1).max(50),
    voiceParts: z.array(organizationVoicePartSchema).min(1).max(100),
  })
  .superRefine((configuration, context) => {
    const sectionCodes = new Set(configuration.sections.map(({ code }) => code));
    const voicePartLabels = new Set(configuration.voiceParts.map(({ label }) => label));
    if (sectionCodes.size !== configuration.sections.length) {
      context.addIssue({ code: "custom", message: "Section codes must be unique." });
    }
    if (voicePartLabels.size !== configuration.voiceParts.length) {
      context.addIssue({ code: "custom", message: "Voice-part labels must be unique." });
    }
    if (configuration.voiceParts.some(({ sectionCode }) => !sectionCodes.has(sectionCode))) {
      context.addIssue({
        code: "custom",
        message: "Every voice part must reference an existing section.",
      });
    }
  });

export const organizationRosterConfigurationResponseSchema =
  organizationRosterConfigurationRequestSchema.and(z.object({ requestId: requestIdSchema }));

export const organizationEventRsvpExportDataSchema = z.object({
  sections: z.array(organizationSectionSchema).min(1).max(50),
  voiceParts: z.array(organizationVoicePartSchema).min(1).max(100),
  eventTitle: z.string().max(500),
  eventType: z.enum(["Performance", "Rehearsal"]),
  singers: z.array(
    z.object({
      displayName: z.string().min(1).max(200),
      isSectionLeader: z.boolean(),
      rsvp: z.enum(["Yes", "No", "Pending"]),
      voicePart: z.string().max(100),
    }),
  ),
});

export const seatingFormationSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    isVoicePartLayout: z.boolean().default(false),
    name: z.string().trim().min(1).max(200),
    sectionOrder: z.array(z.string().trim().min(1).max(50)).min(1).max(100),
    strategy: z.enum(["vertical_column", "horizontal_row"]),
  })
  .superRefine((formation, context) => {
    if (new Set(formation.sectionOrder).size !== formation.sectionOrder.length) {
      context.addIssue({ code: "custom", message: "Seating formation sections must be unique." });
    }
  });

export const seatingConfigurationRequestSchema = z
  .object({
    defaultFormationId: z.string().trim().min(1).max(64),
    formations: z.array(seatingFormationSchema).min(1).max(50),
  })
  .superRefine((configuration, context) => {
    const ids = new Set(configuration.formations.map(({ id }) => id));
    if (ids.size !== configuration.formations.length) {
      context.addIssue({ code: "custom", message: "Seating formation IDs must be unique." });
    }
    if (!ids.has(configuration.defaultFormationId)) {
      context.addIssue({ code: "custom", message: "The default seating formation must exist." });
    }
  });

export const seatingConfigurationResponseSchema = z.object({
  configuration: seatingConfigurationRequestSchema,
  requestId: requestIdSchema,
});

const seatingSeatKeySchema = z.string().regex(/^(0|[1-9]\d{0,2})-(0|[1-9]\d{0,2})$/);
const seatingChartFieldsSchema = z.object({
  assignments: z.record(seatingSeatKeySchema, z.uuid()).default({}),
  formationId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  rowCounts: z.array(z.number().int().min(1).max(200)).min(1).max(50),
  sectionSuggestions: z.record(seatingSeatKeySchema, z.string().trim().min(1).max(50)).default({}),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  venueId: z.uuid().nullable().default(null),
});

function validateSeatingChart(
  chart: z.infer<typeof seatingChartFieldsSchema>,
  context: z.core.$RefinementCtx<z.infer<typeof seatingChartFieldsSchema>>,
): void {
  const entries = [
    ...Object.entries(chart.assignments),
    ...Object.entries(chart.sectionSuggestions),
  ];
  if (entries.length > 4_000) {
    context.addIssue({ code: "custom", message: "The seating chart is too large." });
  }
  const assignedProfiles = Object.values(chart.assignments);
  if (new Set(assignedProfiles).size !== assignedProfiles.length) {
    context.addIssue({ code: "custom", message: "A Profile may occupy only one seat per chart." });
  }
  if (
    entries.some(([seatKey]) => {
      const [rowText, seatText] = seatKey.split("-");
      const row = Number(rowText);
      const seat = Number(seatText);
      return row >= chart.rowCounts.length || seat >= (chart.rowCounts[row] ?? 0);
    })
  ) {
    context.addIssue({ code: "custom", message: "Every seat must exist in the chart layout." });
  }
}

export const organizationSeatingChartRequestSchema =
  seatingChartFieldsSchema.superRefine(validateSeatingChart);
export const organizationSeatingChartSchema = seatingChartFieldsSchema
  .extend({
    createdAt: z.iso.datetime(),
    eventId: z.uuid(),
    id: z.uuid(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine(validateSeatingChart);

export const organizationSeatingChartsResponseSchema = z.object({
  charts: z.array(organizationSeatingChartSchema).max(100),
  requestId: requestIdSchema,
});

export const organizationSeatingChartOrderRequestSchema = z.object({
  chartIds: z.array(z.uuid()).min(1).max(100),
});

export const organizationSeatingChartOrderResponseSchema = z.object({
  charts: z.array(organizationSeatingChartSchema).max(100),
  requestId: requestIdSchema,
});

export const singerSeatingProfileSchema = z.object({
  displayName: z.string().min(1).max(200),
  id: z.uuid(),
  voicePart: z.string().max(100),
});

export const singerSeatingResponseSchema = z.object({
  charts: z.array(organizationSeatingChartSchema).max(100),
  profiles: z.array(singerSeatingProfileSchema).max(500),
  requestId: requestIdSchema,
  selfProfileId: z.uuid(),
});

export type OrganizationVenueRequest = z.infer<typeof organizationVenueRequestSchema>;
export type OrganizationVenue = z.infer<typeof organizationVenueSchema>;
export type OrganizationVenueDeleteResponse = z.infer<typeof organizationVenueDeleteResponseSchema>;
export type OrganizationEventRequest = z.infer<typeof organizationEventRequestSchema>;
export type OrganizationEvent = z.infer<typeof organizationEventSchema>;
export type OrganizationDashboardEvent = z.infer<typeof organizationDashboardEventSchema>;
export type OrganizationDashboardSummaryResponse = z.infer<
  typeof organizationDashboardSummaryResponseSchema
>;
export type TicketCheckoutRequest = z.infer<typeof ticketCheckoutRequestSchema>;
export type PublicTicketPurchase = z.infer<typeof publicTicketPurchaseSchema>;
export type PublicTicketReceipt = z.infer<typeof publicTicketPurchaseResponseSchema>;
export type OrganizationTicketOrder = z.infer<typeof organizationTicketOrderSchema>;
export type TicketScanRequest = z.infer<typeof ticketScanRequestSchema>;
export type TicketScanResult = z.infer<typeof ticketScanResultSchema>;
export type TicketBundleRequest = z.infer<typeof ticketBundleRequestSchema>;
export type TicketBundle = z.infer<typeof ticketBundleSchema>;
export type PublicWebsiteSettingsRequest = z.infer<typeof publicWebsiteSettingsRequestSchema>;
export type PublicWebsiteSettings = z.infer<typeof publicWebsiteSettingsSchema>;
export type PublicWebsiteProjectionPayload = z.infer<typeof publicWebsiteProjectionPayloadSchema>;
export type PublishedOrganizationProjection = z.infer<typeof publishedOrganizationProjectionSchema>;
export type OrganizationEventArchiveResponse = z.infer<
  typeof organizationEventArchiveResponseSchema
>;
export type OrganizationRsvpRequest = z.infer<typeof organizationRsvpRequestSchema>;
export type OrganizationRsvp = z.infer<typeof organizationRsvpSchema>;
export type OrganizationAttendanceStatus = z.infer<typeof organizationAttendanceStatusSchema>;
export type OrganizationAttendanceUpdate = z.infer<typeof organizationAttendanceUpdateSchema>;
export type OrganizationAttendanceRow = z.infer<typeof organizationAttendanceRowSchema>;
export type SingerEvent = z.infer<typeof singerEventSchema>;
export type SingerEventsResponse = z.infer<typeof singerEventsResponseSchema>;
export type OrganizationCalendarSettings = z.infer<
  typeof organizationCalendarSettingsRequestSchema
>;
export type OrganizationRosterConfiguration = z.infer<
  typeof organizationRosterConfigurationRequestSchema
>;
export type OrganizationEventRsvpExportData = z.infer<typeof organizationEventRsvpExportDataSchema>;
export type SeatingFormation = z.infer<typeof seatingFormationSchema>;
export type SeatingConfiguration = z.infer<typeof seatingConfigurationRequestSchema>;
export type OrganizationSeatingChartRequest = z.infer<typeof organizationSeatingChartRequestSchema>;
export type OrganizationSeatingChart = z.infer<typeof organizationSeatingChartSchema>;
export type OrganizationSeatingChartOrderRequest = z.infer<
  typeof organizationSeatingChartOrderRequestSchema
>;
export type SingerSeatingProfile = z.infer<typeof singerSeatingProfileSchema>;
export type SingerSeatingResponse = z.infer<typeof singerSeatingResponseSchema>;

const uniqueMusicLabelsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .superRefine((labels, context) => {
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "Music labels must be unique." });
    }
  });

export const organizationMusicPieceRequestSchema = z.object({
  arranger: z.string().trim().max(300).default(""),
  catalogId: z.string().trim().max(200).default(""),
  composer: z.string().trim().max(300).default(""),
  copies: z.number().int().min(0).max(1_000_000).nullable().default(null),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().default(null),
  genres: uniqueMusicLabelsSchema.default([]),
  notes: z.string().trim().max(100_000).default(""),
  parentId: z.uuid().nullable().default(null),
  purchaseDate: z.iso.date().nullable().default(null),
  sectionBuckets: uniqueMusicLabelsSchema.default([]),
  title: z.string().trim().min(1).max(500),
  trackFileIds: z
    .record(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), z.uuid())
    .refine((mapping) => new Set(Object.values(mapping)).size === Object.keys(mapping).length, {
      message: "Each private audio file may be assigned to only one track.",
    })
    .default({}),
});

export const organizationMusicPieceSchema = organizationMusicPieceRequestSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  lastPerformedAt: z.iso.datetime().nullable().default(null),
  performanceCount: z.number().int().nonnegative().default(0),
  updatedAt: z.iso.datetime(),
});

export const organizationMusicPieceResponseSchema = organizationMusicPieceSchema.extend({
  requestId: requestIdSchema,
});

export const organizationMusicPiecesResponseSchema = z.object({
  pieces: z.array(organizationMusicPieceSchema).max(2_000),
  requestId: requestIdSchema,
});

export const singerLearningTrackPieceSchema = organizationMusicPieceSchema.pick({
  arranger: true,
  composer: true,
  durationSeconds: true,
  id: true,
  parentId: true,
  title: true,
  trackFileIds: true,
});

export const singerLearningTrackPiecesResponseSchema = z.object({
  pieces: z.array(singerLearningTrackPieceSchema).max(2_000),
  requestId: requestIdSchema,
});

export const organizationMusicPieceDeleteResponseSchema = z.object({
  pieceId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("deleted"),
});

export const organizationMusicImportResponseSchema = z.object({
  imported: z.number().int().min(0).max(500),
  requestId: requestIdSchema,
});

export type OrganizationMusicPieceRequest = z.infer<typeof organizationMusicPieceRequestSchema>;
export type OrganizationMusicPiece = z.infer<typeof organizationMusicPieceSchema>;
export type OrganizationMusicImportResponse = z.infer<typeof organizationMusicImportResponseSchema>;

const organizationResourceBaseSchema = z.object({
  fileId: z.uuid().nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  title: z.string().trim().min(1).max(300),
  url: z
    .url()
    .max(2_000)
    .refine((value) => new URL(value).protocol === "https:", "Resource links must use HTTPS.")
    .nullable()
    .default(null),
});

export const organizationResourceRequestSchema = organizationResourceBaseSchema.superRefine(
  ({ fileId, url }, context) => {
    if ((fileId === null) === (url === null)) {
      context.addIssue({
        code: "custom",
        message: "A resource must contain exactly one private file or HTTPS link.",
      });
    }
  },
);

export const organizationResourceSchema = organizationResourceBaseSchema
  .extend({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine(({ fileId, url }, context) => {
    if ((fileId === null) === (url === null)) {
      context.addIssue({ code: "custom", message: "Invalid resource target." });
    }
  });

export const organizationResourcesResponseSchema = z.object({
  requestId: requestIdSchema,
  resources: z.array(organizationResourceSchema).max(500),
});

export const organizationResourceResponseSchema = organizationResourceSchema.and(
  z.object({ requestId: requestIdSchema }),
);

export const organizationResourceOrderRequestSchema = z.object({
  resourceIds: z.array(z.uuid()).max(500),
});

export const organizationResourceDeleteResponseSchema = z.object({
  requestId: requestIdSchema,
  resourceId: z.uuid(),
  status: z.literal("deleted"),
});

export type OrganizationResourceRequest = z.infer<typeof organizationResourceRequestSchema>;
export type OrganizationResource = z.infer<typeof organizationResourceSchema>;

export const communicationChannelSchema = z.enum(["Email", "SMS", "Both"]);
export const communicationMessageStatusSchema = z.enum(["Draft", "Queued", "Sent", "Failed"]);
export const communicationDeliveryStatusSchema = z.enum([
  "queued",
  "processing",
  "sent",
  "failed",
  "suppressed",
]);
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
  sms: communicationChannelCountsSchema,
  state: z.enum(["failed", "partial", "queued", "sending", "sent", "tracking-unavailable"]),
  total: communicationChannelCountsSchema,
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
export type CommunicationSendRequest = z.infer<typeof communicationSendRequestSchema>;
export type CommunicationTemplate = z.infer<typeof communicationTemplateSchema>;
export type CommunicationTemplateRequest = z.infer<typeof communicationTemplateRequestSchema>;
export type SingerLearningTrackPiece = z.infer<typeof singerLearningTrackPieceSchema>;

export const donationStatusSchema = z.enum(["pending", "paid", "refunded", "expired"]);

export const donationTributeTypeSchema = z.enum(["honor", "memory", "anonymous", "none"]);

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
  id: z.uuid(),
  marketingConsent: z.boolean(),
  patronId: z.uuid().nullable(),
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
export type DonationCheckoutRequest = z.infer<typeof donationCheckoutRequestSchema>;
export type DonationRecord = z.infer<typeof donationRecordSchema>;
export type DonationRefundRequest = z.infer<typeof donationRefundRequestSchema>;
export type DonationCheckoutResponse = z.infer<typeof donationCheckoutResponseSchema>;
export type PatronRecord = z.infer<typeof patronRecordSchema>;

export const accountOrganizationSchema = z.object({
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "disabled", "pending"]),
  lifecycleState: z.enum(["active", "provisioning", "suspended"]),
  name: z.string().min(1).max(120),
  organizationId: organizationIdSchema,
  profileId: z.uuid().nullable(),
  role: z.enum(["owner", "administrator", "member"]),
  slug: z.string().min(1).max(63),
});

export const accountOrganizationsResponseSchema = z.object({
  organizations: z.array(accountOrganizationSchema),
});

export type AccountOrganization = z.infer<typeof accountOrganizationSchema>;
export type AccountOrganizationsResponse = z.infer<typeof accountOrganizationsResponseSchema>;

const userManagedPasswordSchema = z.string().min(12).max(128);

export const accountPasswordRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("set"), newPassword: userManagedPasswordSchema }),
  z.object({
    currentPassword: z.string().min(1).max(128),
    mode: z.literal("change"),
    newPassword: userManagedPasswordSchema,
  }),
]);

export const accountSecurityResponseSchema = z.object({
  passwordSet: z.boolean(),
  requestId: requestIdSchema,
});

export type AccountPasswordRequest = z.infer<typeof accountPasswordRequestSchema>;
export type AccountSecurityResponse = z.infer<typeof accountSecurityResponseSchema>;

const authDateSchema = z.union([z.string().min(1), z.number()]);

export const authUserSchema = z.object({
  createdAt: authDateSchema,
  email: z.email(),
  emailVerified: z.boolean(),
  id: z.string().min(1),
  image: z.string().nullable().optional(),
  name: z.string(),
  twoFactorEnabled: z.boolean().optional(),
  updatedAt: authDateSchema,
});

export const authSessionSchema = z.object({
  activeOrganizationId: z.string().nullable().optional(),
  createdAt: authDateSchema,
  expiresAt: authDateSchema,
  id: z.string().min(1),
  ipAddress: z.string().nullable().optional(),
  token: z.string().min(1),
  updatedAt: authDateSchema,
  userAgent: z.string().nullable().optional(),
  userId: z.string().min(1),
});

export const currentAuthSessionSchema = z
  .object({ session: authSessionSchema, user: authUserSchema })
  .nullable();

export const authSessionListSchema = z.array(authSessionSchema);

export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type CurrentAuthSession = z.infer<typeof currentAuthSessionSchema>;

export const organizationMfaPolicyRequestSchema = z.object({
  mfaRequired: z.boolean(),
});

export const organizationMfaVerificationRequestSchema = z.discriminatedUnion("method", [
  z.object({ code: z.string().regex(/^\d{6}$/), method: z.literal("totp") }),
  z.object({ code: z.string().min(8).max(128), method: z.literal("recovery_code") }),
]);

export const organizationAuthStatusResponseSchema = z.object({
  mfaRequired: z.boolean(),
  mfaVerifiedUntil: z.iso.datetime().nullable(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  role: z.enum(["owner", "administrator", "member"]),
  twoFactorEnabled: z.boolean(),
  twoFactorVerified: z.boolean(),
});

export const organizationMfaPolicyResponseSchema = z.object({
  mfaRequired: z.boolean(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
});

export const organizationMfaVerificationResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  status: z.literal("verified"),
});

export type OrganizationAuthStatusResponse = z.infer<typeof organizationAuthStatusResponseSchema>;
export type OrganizationMfaPolicyResponse = z.infer<typeof organizationMfaPolicyResponseSchema>;
export type OrganizationMfaVerificationResponse = z.infer<
  typeof organizationMfaVerificationResponseSchema
>;

export const organizationInvitationRoleSchema = z.enum(["owner", "administrator", "member"]);

export const organizationInvitationRequestSchema = z.object({
  email: z.email().max(320),
  role: organizationInvitationRoleSchema,
});

export const organizationInvitationResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  requestId: requestIdSchema,
  status: z.literal("pending"),
});

export const organizationInvitationDetailsSchema = z.object({
  email: z.email(),
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  inviterEmail: z.email(),
  organizationId: organizationIdSchema,
  organizationName: z.string().min(1).max(120),
  organizationSlug: z.string().min(1).max(63),
  role: organizationInvitationRoleSchema,
  status: z.literal("pending"),
});

export const organizationInvitationSummarySchema = z.object({
  createdAt: z.iso.datetime(),
  email: z.email(),
  expiresAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
  role: organizationInvitationRoleSchema,
  status: z.literal("pending"),
});

export const organizationInvitationsResponseSchema = z.object({
  invitations: z.array(organizationInvitationSummarySchema).max(50),
  requestId: requestIdSchema,
  truncated: z.boolean(),
});

export const organizationInvitationActionResponseSchema = z.object({
  id: z.string().min(1).max(128),
  requestId: requestIdSchema,
  status: z.enum(["accepted", "canceled", "rejected"]),
});

export type OrganizationInvitationRequest = z.infer<typeof organizationInvitationRequestSchema>;
export type OrganizationInvitationResponse = z.infer<typeof organizationInvitationResponseSchema>;
export type OrganizationInvitationDetails = z.infer<typeof organizationInvitationDetailsSchema>;
export type OrganizationInvitationSummary = z.infer<typeof organizationInvitationSummarySchema>;
export type OrganizationInvitationsResponse = z.infer<typeof organizationInvitationsResponseSchema>;
export type OrganizationInvitationActionResponse = z.infer<
  typeof organizationInvitationActionResponseSchema
>;

export const organizationProfileLinkRequestSchema = z.object({
  profileId: z.uuid(),
});

export const organizationProfileLinkResponseSchema = z.object({
  membershipId: z.string().min(1).max(128),
  organizationId: organizationIdSchema,
  profileId: z.uuid(),
  requestId: requestIdSchema,
});

export const organizationMembershipSummarySchema = z.object({
  email: z.email(),
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  profileId: z.uuid().nullable(),
  role: organizationInvitationRoleSchema,
});

export const organizationMembershipsResponseSchema = z.object({
  memberships: z.array(organizationMembershipSummarySchema).max(500),
  requestId: requestIdSchema,
  truncated: z.boolean(),
});

export type OrganizationMembershipSummary = z.infer<typeof organizationMembershipSummarySchema>;
export type OrganizationMembershipsResponse = z.infer<typeof organizationMembershipsResponseSchema>;

export const publicWebsiteHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((hostname) => hostname.replace(/\.$/, ""))
  .refine(
    (hostname) =>
      hostname.length <= 253 &&
      hostname.includes(".") &&
      !/^\d+(?:\.\d+){3}$/.test(hostname) &&
      !/^\d+$/.test(hostname.split(".").at(-1) ?? "") &&
      hostname
        .split(".")
        .every(
          (label) =>
            label.length >= 1 &&
            label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
        ),
    "A valid DNS hostname is required.",
  );

export const publicDomainRegistrationRequestSchema = z.object({
  hostname: publicWebsiteHostnameSchema,
});

export const publicDomainResponseSchema = z.object({
  domainId: z.uuid(),
  hostname: publicWebsiteHostnameSchema,
  organizationId: organizationIdSchema,
  routingVersion: z.number().int().positive(),
  status: z.enum(["active", "disabled", "pending"]),
});

export type PublicDomainResponse = z.infer<typeof publicDomainResponseSchema>;

export const privateFileResponseSchema = z.object({
  contentType: z.string().min(1).max(128),
  fileName: z.string().min(1).max(255),
  id: z.uuid(),
  requestId: requestIdSchema,
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(20 * 1024 * 1024),
  uploadedAt: z.iso.datetime(),
});

export type PrivateFileResponse = z.infer<typeof privateFileResponseSchema>;

export const organizationExportRequestSchema = z.object({
  format: z.literal("json").default("json"),
});

export const organizationExportStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const organizationExportStartResponseSchema = z.object({
  exportId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("queued"),
});

export const organizationExportStatusResponseSchema = z.object({
  byteCount: z.number().int().nonnegative().nullable(),
  checksumSha256: z.string().max(128).nullable(),
  downloadUrl: z.string().nullable(),
  errorCode: z.string().max(128).nullable(),
  exportId: z.uuid(),
  requestId: requestIdSchema,
  status: organizationExportStatusSchema,
});

export const organizationExportManifestSchema = z.object({
  byteCount: z.number().int().nonnegative(),
  checksumSha256: z.string().min(1).max(128),
  exportedAt: z.iso.datetime(),
  exportVersion: z.literal(1),
  fileCount: z.number().int().nonnegative(),
  organizationId: organizationIdSchema,
  recordCounts: z.record(z.string().min(1).max(128), z.number().int().nonnegative()),
});

export const organizationExportResponseSchema = z.object({
  downloadName: z.string().min(1).max(255),
  manifest: organizationExportManifestSchema,
  requestId: requestIdSchema,
});

export type OrganizationExportRequest = z.infer<typeof organizationExportRequestSchema>;
export type OrganizationExportStatus = z.infer<typeof organizationExportStatusSchema>;
export type OrganizationExportStartResponse = z.infer<typeof organizationExportStartResponseSchema>;
export type OrganizationExportStatusResponse = z.infer<
  typeof organizationExportStatusResponseSchema
>;
export type OrganizationExportManifest = z.infer<typeof organizationExportManifestSchema>;
export type OrganizationExportResponse = z.infer<typeof organizationExportResponseSchema>;

export const calendarFeedUrlsResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  httpsUrl: z.url(),
  requestId: requestIdSchema,
  webcalUrl: z.string().startsWith("webcal://"),
});

export type CalendarFeedUrlsResponse = z.infer<typeof calendarFeedUrlsResponseSchema>;

export const organizationProvisionRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
});

export type OrganizationProvisionRequest = z.infer<typeof organizationProvisionRequestSchema>;

export const organizationProvisionResponseSchema = z.object({
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "pending"]),
  lifecycleState: z.literal("provisioning"),
  organizationId: z.uuid(),
  requestId: requestIdSchema,
  workflowId: z.string().min(1).max(128),
});

export type OrganizationProvisionResponse = z.infer<typeof organizationProvisionResponseSchema>;

export const platformOrganizationSummarySchema = z.object({
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "disabled", "pending"]),
  lifecycleState: z.enum(["active", "provisioning", "suspended"]),
  name: z.string().min(1).max(120),
  operationalSchemaVersion: z.number().int().nonnegative(),
  organizationId: organizationIdSchema,
  provisionedAt: z.iso.datetime().nullable(),
  slug: z.string().min(2).max(63),
});

export const platformOrganizationsResponseSchema = z.object({
  nextCursor: z.string().min(1).max(128).nullable(),
  organizations: z.array(platformOrganizationSummarySchema).max(25),
  requestId: requestIdSchema,
});

export type PlatformOrganizationSummary = z.infer<typeof platformOrganizationSummarySchema>;
export type PlatformOrganizationsResponse = z.infer<typeof platformOrganizationsResponseSchema>;

export const platformJobDeadLetterSummarySchema = z.object({
  firstSeenAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256).nullable(),
  jobId: z.uuid().nullable(),
  jobKind: z
    .enum([
      "attendance_report",
      "communication_delivery",
      "organization_export",
      "projection_publish",
      "stale_checkout_cleanup",
      "ticket_notification",
    ])
    .nullable(),
  lastSeenAt: z.iso.datetime(),
  messageId: z.string().min(1).max(256),
  messageValid: z.boolean(),
  observationCount: z.number().int().positive(),
  observedAttempt: z.number().int().nonnegative(),
  organizationId: organizationIdSchema.nullable(),
  queueName: z.string().min(1).max(128),
});

export const platformJobDeadLettersResponseSchema = z.object({
  deadLetters: z.array(platformJobDeadLetterSummarySchema).max(25),
  nextCursor: z.string().min(1).max(512).nullable(),
  requestId: requestIdSchema,
});

export type PlatformJobDeadLetterSummary = z.infer<typeof platformJobDeadLetterSummarySchema>;
export type PlatformJobDeadLettersResponse = z.infer<typeof platformJobDeadLettersResponseSchema>;

export const platformFleetSchemaPreparationSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  processedCount: z.number().int().nonnegative(),
  runId: z.uuid(),
  startedAt: z.iso.datetime(),
  status: z.enum(["running", "completed", "failed"]),
  targetVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  workflowId: z.string().min(1).max(100).optional(),
});

export const platformFleetSchemaStatusResponseSchema = z.object({
  currentVersion: z.number().int().positive(),
  preparation: platformFleetSchemaPreparationSchema.nullable(),
  requestId: requestIdSchema,
});

export type PlatformFleetSchemaPreparation = z.infer<typeof platformFleetSchemaPreparationSchema>;
export type PlatformFleetSchemaStatusResponse = z.infer<
  typeof platformFleetSchemaStatusResponseSchema
>;

export const platformElevationRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type PlatformElevationRequest = z.infer<typeof platformElevationRequestSchema>;

export const platformOrganizationContextResponseSchema = z.object({
  canEdit: z.boolean(),
  elevationExpiresAt: z.iso.datetime().nullable(),
  elevationId: z.uuid().nullable(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  userId: z.string().min(1),
});

export type PlatformOrganizationContextResponse = z.infer<
  typeof platformOrganizationContextResponseSchema
>;

export const platformElevationRevocationResponseSchema = z.object({
  elevationId: z.uuid(),
  status: z.literal("revoked"),
});

export type PlatformElevationRevocationResponse = z.infer<
  typeof platformElevationRevocationResponseSchema
>;

export const platformMfaStatusResponseSchema = z.object({
  activePlatformAdministrator: z.boolean(),
  enrollmentComplete: z.boolean(),
  requestId: requestIdSchema,
  twoFactorEnabled: z.boolean(),
});

export const platformMfaEnrollmentResponseSchema = z.object({
  backupCodes: z.array(z.string().min(8)).min(1),
  totpURI: z.url(),
});

export const platformRecoveryCodesResponseSchema = z.object({
  backupCodes: z.array(z.string().min(8)).min(1),
  status: z.literal(true),
});

export const platformContextResponseSchema = z.object({
  mfaMethod: z.enum(["recovery_code", "totp"]),
  mfaVerifiedUntil: z.iso.datetime(),
  requestId: requestIdSchema,
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("product_base") }),
    z.object({ kind: z.literal("organization"), organizationId: organizationIdSchema }),
  ]),
  userId: z.string().min(1),
});

export type PlatformMfaStatusResponse = z.infer<typeof platformMfaStatusResponseSchema>;
export type PlatformMfaEnrollmentResponse = z.infer<typeof platformMfaEnrollmentResponseSchema>;
export type PlatformRecoveryCodesResponse = z.infer<typeof platformRecoveryCodesResponseSchema>;
export type PlatformContextResponse = z.infer<typeof platformContextResponseSchema>;

export const publicRsvpDetailsResponseSchema = z.object({
  canSubmit: z.boolean(),
  event: z.object({
    callTime: z.string(),
    details: z.string(),
    durationMinutes: z.number().int().positive().nullable(),
    id: z.uuid(),
    location: z.string(),
    startsAt: z.iso.datetime(),
    title: z.string(),
    type: z.enum(["Performance", "Rehearsal"]),
    venueAddress: z.string(),
    venueName: z.string(),
  }),
  profileId: z.uuid(),
  profileName: z.string(),
  rsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string(),
});

export type PublicRsvpDetailsResponse = z.infer<typeof publicRsvpDetailsResponseSchema>;

export const publicQuickRsvpRequestSchema = z.object({
  rsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string().trim().max(2_000).default(""),
  token: z.string().min(1).max(4_096),
});

export type PublicQuickRsvpRequest = z.infer<typeof publicQuickRsvpRequestSchema>;

export const generateRsvpTokensRequestSchema = z.object({
  eventId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(500),
});

export type GenerateRsvpTokensRequest = z.infer<typeof generateRsvpTokensRequestSchema>;

export const generateRsvpTokensResponseSchema = z.object({
  tokens: z.record(z.uuid(), z.string().min(1).max(4_096)),
});

export type GenerateRsvpTokensResponse = z.infer<typeof generateRsvpTokensResponseSchema>;

export const organizationPollOptionSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().nonnegative().default(0),
});

export type OrganizationPollOption = z.infer<typeof organizationPollOptionSchema>;

export const organizationPollRequestSchema = z.object({
  archivedAt: z.string().max(100).default(""),
  description: z.string().trim().max(10_000).default(""),
  expiresAt: z.string().max(100).default(""),
  multipleChoice: z.boolean().default(false),
  options: z.array(organizationPollOptionSchema).min(2).max(100),
  title: z.string().trim().min(1).max(500),
});

export type OrganizationPollRequest = z.infer<typeof organizationPollRequestSchema>;

export const organizationPollSchema = organizationPollRequestSchema.extend({
  createdAt: z.iso.datetime(),
  createdBy: z.string().min(1),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export type OrganizationPoll = z.infer<typeof organizationPollSchema>;

export const organizationPollSummarySchema = z.object({
  archivedAt: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.string(),
  id: z.uuid(),
  responseCount: z.number().int().nonnegative(),
  title: z.string(),
});

export const organizationPollSummariesResponseSchema = z.object({
  polls: z.array(organizationPollSummarySchema).max(500),
  requestId: requestIdSchema,
});

export type OrganizationPollSummary = z.infer<typeof organizationPollSummarySchema>;
export type OrganizationPollSummariesResponse = z.infer<
  typeof organizationPollSummariesResponseSchema
>;

export const organizationPollResponseSchema = z.object({
  optionIds: z.array(z.uuid()).min(1).max(100),
  profileId: z.uuid(),
  profileName: z.string(),
});

export type OrganizationPollResponse = z.infer<typeof organizationPollResponseSchema>;

export const publicPollDetailsResponseSchema = z.object({
  canSubmit: z.boolean(),
  description: z.string(),
  expiresAt: z.string(),
  multipleChoice: z.boolean(),
  options: z.array(organizationPollOptionSchema),
  pollId: z.uuid(),
  profileId: z.string(),
  profileName: z.string(),
  responseOptionIds: z.array(z.uuid()),
  title: z.string(),
});

export type PublicPollDetailsResponse = z.infer<typeof publicPollDetailsResponseSchema>;

export const publicPollSubmitRequestSchema = z.object({
  optionIds: z.array(z.uuid()).min(1).max(100),
  token: z.string().min(1).max(4_096),
});

export type PublicPollSubmitRequest = z.infer<typeof publicPollSubmitRequestSchema>;

export const generatePollTokensRequestSchema = z.object({
  pollId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(500),
});

export type GeneratePollTokensRequest = z.infer<typeof generatePollTokensRequestSchema>;

export const generatePollTokensResponseSchema = z.object({
  tokens: z.record(z.uuid(), z.string().min(1).max(4_096)),
});

export type GeneratePollTokensResponse = z.infer<typeof generatePollTokensResponseSchema>;

export const playerPlaylistItemSchema = z.object({
  arranger: z.string().optional(),
  composer: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  isFeaturedNumber: z.boolean().optional(),
  notes: z.string().optional(),
  pieceId: z.uuid().optional(),
  title: z.string().min(1).max(300),
  trackFileIds: z.record(z.string(), z.string()),
});

export type PlayerPlaylistItem = z.infer<typeof playerPlaylistItemSchema>;

export const publicPlayerDetailsResponseSchema = z.object({
  eventId: z.uuid(),
  eventTitle: z.string(),
  eventStartsAt: z.string(),
  items: z.array(playerPlaylistItemSchema),
  profileId: z.string(),
  profileName: z.string(),
});

export type PublicPlayerDetailsResponse = z.infer<typeof publicPlayerDetailsResponseSchema>;

export const generatePlayerTokensRequestSchema = z.object({
  eventId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(500),
});

export type GeneratePlayerTokensRequest = z.infer<typeof generatePlayerTokensRequestSchema>;

export const generatePlayerTokensResponseSchema = z.object({
  tokens: z.record(z.uuid(), z.string().min(1).max(4_096)),
});

export type GeneratePlayerTokensResponse = z.infer<typeof generatePlayerTokensResponseSchema>;

export const auditionStatusSchema = z.enum([
  "pending",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);

export type AuditionStatus = z.infer<typeof auditionStatusSchema>;

export const auditionInquirySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email().max(320),
  phone: z.string().max(50).optional(),
  voicePart: z.string().max(100).optional(),
  experience: z.string().max(5_000).optional(),
  availabilityNotes: z.string().max(5_000).optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).default([]),
});

export type AuditionInquiry = z.infer<typeof auditionInquirySchema>;

export const auditionSlotSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});

export type AuditionSlot = z.infer<typeof auditionSlotSchema>;

export const auditionDetailsSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().optional(),
  voicePart: z.string().optional(),
  experience: z.string().optional(),
  availabilityNotes: z.string().optional(),
  performanceId: z.uuid().nullable().optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).default([]),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema,
  slots: z.array(auditionSlotSchema),
});

export type AuditionDetails = z.infer<typeof auditionDetailsSchema>;

export const publicAuditionDetailsResponseSchema = auditionDetailsSchema;

export type PublicAuditionDetailsResponse = z.infer<typeof publicAuditionDetailsResponseSchema>;

export const publicAuditionSubmitRequestSchema = z.object({
  availabilityNotes: z.string().max(5_000).optional(),
  voicePart: z.string().max(100).optional(),
  token: z.string().min(1).max(4_096),
});

export type PublicAuditionSubmitRequest = z.infer<typeof publicAuditionSubmitRequestSchema>;

export const publicAuditionInquiryRequestSchema = z.object({
  ...auditionInquirySchema.shape,
  turnstileToken: z.string().optional(),
});

export type PublicAuditionInquiryRequest = z.infer<typeof publicAuditionInquiryRequestSchema>;

export const publicAuditionInquiryResponseSchema = z.object({
  id: z.string(),
  message: z.string(),
});

export type PublicAuditionInquiryResponse = z.infer<typeof publicAuditionInquiryResponseSchema>;

export const generateAuditionTokensRequestSchema = z.object({
  auditionIds: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Audition IDs must be unique."),
});

export type GenerateAuditionTokensRequest = z.infer<typeof generateAuditionTokensRequestSchema>;

export const generateAuditionTokensResponseSchema = z.object({
  tokens: z.record(z.string(), z.string().min(1).max(4_096)),
});

export type GenerateAuditionTokensResponse = z.infer<typeof generateAuditionTokensResponseSchema>;

export const organizationAuditionSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().optional(),
  voicePart: z.string().optional(),
  experience: z.string().optional(),
  availabilityNotes: z.string().optional(),
  adminNotes: z.string().optional(),
  performanceId: z.uuid().nullable().optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).default([]),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  slots: z.array(auditionSlotSchema),
});

export type OrganizationAudition = z.infer<typeof organizationAuditionSchema>;

export const organizationAuditionResponseSchema = organizationAuditionSchema.extend({
  requestId: requestIdSchema,
});

export const organizationAuditionListResponseSchema = z.object({
  auditions: z.array(organizationAuditionSchema),
});

export type OrganizationAuditionListResponse = z.infer<
  typeof organizationAuditionListResponseSchema
>;

export const auditionSlotInputSchema = z.object({
  endsAt: z.iso.datetime(),
  id: z.string().min(1).max(128).optional(),
  startsAt: z.iso.datetime(),
});

export const organizationAuditionSettingsSchema = z
  .object({
    adminNotifyEnabled: z.boolean(),
    adminNotifyUsers: z.array(z.string().min(1).max(128)).max(100),
    confirmationMessage: z.string().max(5_000),
    defaultPerformanceId: z.uuid().nullable(),
    enabled: z.boolean(),
    slots: z.array(auditionSlotInputSchema).max(200),
  })
  .superRefine((settings, context) => {
    const starts = new Set<string>();
    const ids = new Set<string>();
    settings.slots.forEach((slot, index) => {
      if (new Date(slot.startsAt).getTime() >= new Date(slot.endsAt).getTime()) {
        context.addIssue({
          code: "custom",
          message: "An audition slot must end after it starts.",
          path: ["slots", index, "endsAt"],
        });
      }
      if (starts.has(slot.startsAt)) {
        context.addIssue({
          code: "custom",
          message: "Audition slots must have unique start times.",
          path: ["slots", index, "startsAt"],
        });
      }
      starts.add(slot.startsAt);
      if (slot.id !== undefined) {
        if (ids.has(slot.id)) {
          context.addIssue({
            code: "custom",
            message: "Audition slot IDs must be unique.",
            path: ["slots", index, "id"],
          });
        }
        ids.add(slot.id);
      }
    });
  });

export const organizationAuditionSettingsResponseSchema = organizationAuditionSettingsSchema.extend(
  {
    requestId: requestIdSchema,
  },
);

export type OrganizationAuditionSettings = z.infer<typeof organizationAuditionSettingsSchema>;

export const organizationAuditionCreateRequestSchema = auditionInquirySchema.extend({
  performanceId: z.uuid().nullable().optional(),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema.default("pending"),
});

export type OrganizationAuditionCreateRequest = z.infer<
  typeof organizationAuditionCreateRequestSchema
>;

export const organizationAuditionUpdateRequestSchema = z.object({
  adminNotes: z.string().max(10_000).optional(),
  availabilityNotes: z.string().max(5_000).optional(),
  email: z.email().max(320).optional(),
  experience: z.string().max(5_000).optional(),
  name: z.string().min(1).max(200).optional(),
  performanceId: z.uuid().nullable().optional(),
  phone: z.string().max(50).optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).optional(),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema.optional(),
  voicePart: z.string().max(100).optional(),
});

export type OrganizationAuditionUpdateRequest = z.infer<
  typeof organizationAuditionUpdateRequestSchema
>;

export const seasonSchema = z.object({
  createdAt: z.iso.datetime(),
  duesAmountCents: z.number().int().nonnegative(),
  endsAt: z.iso.datetime(),
  id: z.uuid(),
  name: z.string().min(1).max(200),
  startsAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const seasonsResponseSchema = z.object({
  requestId: requestIdSchema,
  seasons: z.array(seasonSchema).max(500),
});

export const duesStatusSchema = z.enum(["pending", "paid", "refunded"]);

export const duesRecordSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  paidAt: z.iso.datetime().nullable(),
  profileId: z.uuid(),
  seasonId: z.uuid(),
  status: duesStatusSchema,
  updatedAt: z.iso.datetime(),
});

export const duesRecordsResponseSchema = z.object({
  dues: z.array(duesRecordSchema).max(500),
  requestId: requestIdSchema,
});

export const duesCheckoutRequestSchema = z.object({
  profileIds: z.array(z.uuid()).min(1).max(500),
  seasonId: z.uuid(),
});

export const duesCheckoutResponseSchema = z.object({
  checkoutMode: z.enum(["fake", "stripe"]),
  sessionId: z.string().min(1).max(256),
  url: z.url(),
});

export type Season = z.infer<typeof seasonSchema>;
export type SeasonsResponse = z.infer<typeof seasonsResponseSchema>;
export type DuesStatus = z.infer<typeof duesStatusSchema>;
export type DuesRecord = z.infer<typeof duesRecordSchema>;
export type DuesRecordsResponse = z.infer<typeof duesRecordsResponseSchema>;
export type DuesCheckoutRequest = z.infer<typeof duesCheckoutRequestSchema>;
export type DuesCheckoutResponse = z.infer<typeof duesCheckoutResponseSchema>;

export const problemDetailsSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: requestIdSchema,
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const setupStatusSchema = z.object({
  organizationId: organizationIdSchema,
  organizationName: z.string().min(1).max(120),
  completedSteps: z.array(z.string()),
  currentStep: z.string().nullable(),
  allModulesConfigured: z.boolean(),
  launched: z.boolean(),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const moduleStateSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export const moduleStatesResponseSchema = z.object({
  modules: z.array(moduleStateSchema),
});

export type ModuleState = z.infer<typeof moduleStateSchema>;
export type ModuleStatesResponse = z.infer<typeof moduleStatesResponseSchema>;

export const setupProgressRequestSchema = z.object({
  step: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type SetupProgressRequest = z.infer<typeof setupProgressRequestSchema>;

export const setupClaimResponseSchema = z.object({
  claimed: z.boolean(),
  organizationId: organizationIdSchema,
});

export type SetupClaimResponse = z.infer<typeof setupClaimResponseSchema>;
