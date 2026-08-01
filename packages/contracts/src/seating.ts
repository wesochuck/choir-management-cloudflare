import { z } from "zod";
import { requestIdSchema } from "./primitives";
import type {
  organizationVenueRequestSchema,
  organizationVenueSchema,
  organizationVenueDeleteResponseSchema,
} from "./profiles";
import type {
  organizationEventRequestSchema,
  publicWebsiteSettingsRequestSchema,
  publicWebsiteSettingsSchema,
} from "./organization";
import type {
  ticketCheckoutRequestSchema,
  publicTicketPurchaseSchema,
  publicTicketPurchaseResponseSchema,
  ticketScanRequestSchema,
  ticketScanResultSchema,
  organizationTicketOrderSchema,
  ticketBundleRequestSchema,
  ticketBundleSchema,
  publicWebsiteProjectionPayloadSchema,
  publishedOrganizationProjectionSchema,
} from "./ticketing";
import type {
  organizationEventSchema,
  organizationDashboardEventSchema,
  organizationDashboardSummaryResponseSchema,
  organizationEventArchiveResponseSchema,
  organizationEventCancelResponseSchema,
  organizationRsvpRequestSchema,
  organizationRsvpSchema,
  organizationEventRsvpHistoryEntrySchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationAttendanceStatusSchema,
  organizationAttendanceUpdateSchema,
  organizationAttendanceRowSchema,
  organizationProfileFolderNumberSchema,
  organizationProfileFolderNumberUpdateSchema,
  organizationProfilePerformanceSchema,
  organizationProfilePerformanceHistoryResponseSchema,
  organizationProfileStatusHistoryResponseSchema,
  singerEventSchema,
  singerEventsResponseSchema,
  organizationCalendarSettingsRequestSchema,
} from "./events";
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
export type OrganizationEventCancelResponse = z.infer<typeof organizationEventCancelResponseSchema>;
export type OrganizationRsvpRequest = z.infer<typeof organizationRsvpRequestSchema>;
export type OrganizationRsvp = z.infer<typeof organizationRsvpSchema>;
export type OrganizationEventRsvpHistoryEntry = z.infer<
  typeof organizationEventRsvpHistoryEntrySchema
>;
export type OrganizationEventRsvpHistoryResponse = z.infer<
  typeof organizationEventRsvpHistoryResponseSchema
>;
export type OrganizationAttendanceStatus = z.infer<typeof organizationAttendanceStatusSchema>;
export type OrganizationAttendanceUpdate = z.infer<typeof organizationAttendanceUpdateSchema>;
export type OrganizationAttendanceRow = z.infer<typeof organizationAttendanceRowSchema>;
export type OrganizationProfileFolderNumber = z.infer<typeof organizationProfileFolderNumberSchema>;
export type OrganizationProfileFolderNumberUpdate = z.infer<
  typeof organizationProfileFolderNumberUpdateSchema
>;
export type OrganizationProfilePerformance = z.infer<typeof organizationProfilePerformanceSchema>;
export type OrganizationProfilePerformanceHistoryResponse = z.infer<
  typeof organizationProfilePerformanceHistoryResponseSchema
>;
export type OrganizationProfileStatusHistoryResponse = z.infer<
  typeof organizationProfileStatusHistoryResponseSchema
>;
export type SingerEvent = z.infer<typeof singerEventSchema>;
export type SingerEventsResponse = z.infer<typeof singerEventsResponseSchema>;
export type OrganizationCalendarSettings = z.infer<
  typeof organizationCalendarSettingsRequestSchema
>;
