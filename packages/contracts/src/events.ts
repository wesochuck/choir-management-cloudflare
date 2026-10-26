import { z } from "zod";
import { requestIdSchema } from "./primitives";
import { organizationEventFieldsSchema, organizationSetListItemSchema } from "./organization";
export const organizationEventSchema = organizationEventFieldsSchema.and(
  z.object({
    createdAt: z.iso.datetime(),
    ticketSlug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .nullable()
      .optional(),
    id: z.uuid(),
    isCanceled: z.boolean().default(false),
    rsvpDeadlineAt: z.iso.datetime().nullable().default(null),
    rsvpDeadlineDate: z.string().nullable().default(null),
    rsvpDeadlinePassed: z.boolean().default(false),
    rsvpSelfServiceOpen: z.boolean().default(true),
    updatedAt: z.iso.datetime(),
  }),
);

export const organizationEventsResponseSchema = z.object({
  events: z.array(organizationEventSchema).max(500),
  requestId: requestIdSchema,
});

export const organizationDashboardEventSchema = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal", "Other"]),
});

export const organizationDashboardSummaryResponseSchema = z.object({
  activeProfileCount: z.number().int().nonnegative(),
  doNotEmailCount: z.number().int().nonnegative(),
  nextEvents: z.array(organizationDashboardEventSchema).max(5),
  recentBounceCount: z.number().int().nonnegative(),
  requestId: requestIdSchema,
  upcomingEventCount: z.number().int().nonnegative(),
});

export const organizationEventArchiveResponseSchema = z.object({
  eventId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("archived"),
});

export const organizationEventCancelResponseSchema = z.object({
  eventId: z.uuid(),
  requestId: requestIdSchema,
  status: z.literal("canceled"),
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

export const organizationEventRsvpHistoryEntrySchema = z.object({
  actorType: z.string().min(1).max(100),
  automatic: z.boolean(),
  displayName: z.string().min(1).max(200),
  eventId: z.uuid(),
  newRsvp: z.enum(["No", "Pending", "Yes"]),
  occurredAt: z.iso.datetime(),
  previousRsvp: z.enum(["No", "Pending", "Yes"]),
  profileId: z.uuid(),
  reason: z.string().max(500),
});

export const organizationEventRsvpHistoryResponseSchema = z.object({
  entries: z.array(organizationEventRsvpHistoryEntrySchema).max(500),
  eventId: z.uuid(),
});

export const organizationAttendanceStatusSchema = z.enum(["Present", "Absent", "Pending"]);

export const organizationAttendanceUpdateSchema = z.object({
  attendance: organizationAttendanceStatusSchema,
  profileId: z.uuid(),
});

export const organizationAttendanceBulkRequestSchema = z.object({
  updates: z.array(organizationAttendanceUpdateSchema).min(1).max(500),
});

export const organizationEventRsvpBulkRequestSchema = z.object({
  updates: z.array(organizationRsvpRequestSchema).min(1).max(500),
});

export type OrganizationEventRsvpBulkRequest = z.infer<
  typeof organizationEventRsvpBulkRequestSchema
>;

const attendanceWarningSchema = z.object({
  missedRehearsals: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
  totalRehearsals: z.number().int().nonnegative(),
  status: z.enum(["clear", "warning"]),
});

export const organizationAttendanceRowSchema = z.object({
  attendanceWarning: attendanceWarningSchema.nullable().optional(),
  attendance: organizationAttendanceStatusSchema,
  displayName: z.string().min(1).max(200),
  profileId: z.uuid(),
  rsvp: z.enum(["Yes", "No", "Pending"]),
  updatedAt: z.iso.datetime().nullable(),
  voicePart: z.string().max(100).default(""),
});

export const organizationAttendanceResponseSchema = z.object({
  eventId: z.uuid(),
  requestId: requestIdSchema,
  rows: z.array(organizationAttendanceRowSchema).max(500),
});

export const organizationAttendanceReportRowSchema = z.object({
  absences: z.number().int().nonnegative(),
  name: z.string().min(1).max(200),
  present: z.number().int().nonnegative(),
  profileId: z.uuid(),
  total: z.number().int().nonnegative(),
  voicePart: z.string().max(100).default(""),
});

export const organizationAttendanceReportResponseSchema = z.object({
  eventId: z.uuid(),
  requestId: requestIdSchema,
  rows: z.array(organizationAttendanceReportRowSchema).max(500),
  totalRehearsals: z.number().int().nonnegative(),
});

export type OrganizationAttendanceReportRow = z.infer<typeof organizationAttendanceReportRowSchema>;
export type OrganizationAttendanceReportResponse = z.infer<
  typeof organizationAttendanceReportResponseSchema
>;

export const organizationProfileFolderNumberSchema = z.object({
  eventId: z.uuid(),
  eventTitle: z.string().min(1).max(500),
  eventType: z.literal("Performance"),
  folderNumber: z.string().max(50),
  folderReturned: z.boolean(),
  profileId: z.uuid(),
  returnedAt: z.iso.datetime().nullable(),
  startsAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().nullable(),
});

export const organizationProfileFolderNumbersResponseSchema = z.object({
  folderNumbers: z.array(organizationProfileFolderNumberSchema).max(500),
  profileId: z.uuid(),
  requestId: requestIdSchema,
});

export const organizationProfileFolderNumberUpdateSchema = z.object({
  folderNumber: z.string().trim().max(50),
  folderReturned: z.boolean(),
});

export const organizationProfilePerformanceSchema = z.object({
  attendance: organizationAttendanceStatusSchema,
  id: z.uuid(),
  location: z.string().max(2_000),
  rsvp: z.enum(["Yes", "No", "Pending"]),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
  venueName: z.string().max(500),
});

export const organizationProfilePerformanceHistoryResponseSchema = z.object({
  past: z.array(organizationProfilePerformanceSchema).max(500),
  profileId: z.uuid(),
  requestId: requestIdSchema,
  upcoming: z.array(organizationProfilePerformanceSchema).max(500),
});

export const organizationProfileStatusHistoryEntrySchema = z.object({
  actorType: z.string().min(1).max(100),
  occurredAt: z.iso.datetime(),
  previousStatus: z.enum(["Active", "Idle", "Inactive"]),
  reason: z.string().max(500),
  triggerType: z.string().min(1).max(100),
  newStatus: z.enum(["Active", "Idle", "Inactive"]),
});

export const organizationProfileStatusHistoryResponseSchema = z.object({
  entries: z.array(organizationProfileStatusHistoryEntrySchema).max(500),
  profileId: z.uuid(),
});

export const singerRsvpRequestSchema = z.object({
  rsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string().trim().max(2_000).default(""),
});

export const singerEventSchema = z.object({
  attendanceWarning: attendanceWarningSchema.nullable().default(null),
  callTime: z.string().max(5),
  details: z.string().max(100_000),
  directRsvp: z.enum(["Yes", "No", "Pending"]),
  durationMinutes: z.number().int().positive().nullable(),
  id: z.uuid(),
  inheritedFromParent: z.boolean(),
  location: z.string().max(2_000),
  featuredAssignments: z
    .array(
      z.object({
        pieceId: z.uuid().nullable(),
        title: z.string().min(1).max(500),
      }),
    )
    .max(50)
    .default([]),
  practice: z
    .object({
      sourceEventId: z.uuid().nullable(),
      status: z.enum(["available", "not_published", "not_available"]),
      trackCount: z.number().int().nonnegative(),
    })
    .default({ sourceEventId: null, status: "not_published", trackCount: 0 }),
  publicGraphicFileId: z.string().max(200).nullable().default(null).optional(),
  resolvedRsvp: z.enum(["Yes", "No", "Pending"]),
  isInvited: z.boolean().default(false).optional(),
  otherEventRsvpMode: z
    .enum(["off", "optional", "response_requested"])
    .nullable()
    .default(null)
    .optional(),
  rsvpDeadlineAt: z.iso.datetime().nullable(),
  rsvpDeadlineDate: z.string().nullable(),
  rsvpDeadlinePassed: z.boolean(),
  rsvpNote: z.string().max(2_000),
  rsvpSelfServiceOpen: z.boolean(),
  seating: z
    .object({
      status: z.enum(["available", "not_published", "not_assigned", "declined"]),
    })
    .default({ status: "not_published" }),
  setList: z
    .array(
      organizationSetListItemSchema.extend({
        scoreAvailable: z.boolean().optional(),
      }),
    )
    .max(200)
    .default([]),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal", "Other"]),
  venueAddress: z.string().max(2_000),
  venueName: z.string().max(500),
  volunteerCount: z.number().int().nonnegative().default(0).optional(),
  volunteerGoal: z.number().int().positive().nullable().default(null).optional(),
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
    onBreakTimeoutDays: z.number().int().min(1).max(3_650).default(365),
    onBreakTimeoutEnabled: z.boolean().default(true),
    performerLabel: z.string().trim().min(1).max(50).default("Performer"),
    rosterStructure: z.enum(["sections_only", "sections_with_parts"]).optional(),
    rsvpFollowUpEnabled: z.boolean().default(true),
    rsvpFollowUpLeadHours: z.number().int().min(1).max(720).default(48),
    rsvpExpiryEnabled: z.boolean().default(true),
    sections: z.array(organizationSectionSchema).min(1).max(50),
    statusAutomationEnabled: z.boolean().default(true),
    statusAutomationMissThreshold: z.number().int().min(1).max(10).default(3),
    statusAutomationRecoveryEnabled: z.boolean().default(true),
    attendanceReportWarningThreshold: z.number().int().min(1).max(10).default(1),
    rehearsalAttendanceReportsEnabled: z.boolean().default(true),
    voiceParts: z.array(organizationVoicePartSchema).max(100).default([]),
  })
  .superRefine((configuration, context) => {
    const sectionCodes = new Set(configuration.sections.map(({ code }) => code));
    const voicePartLabels = new Set(configuration.voiceParts.map(({ label }) => label));
    if (sectionCodes.size !== configuration.sections.length) {
      context.addIssue({ code: "custom", message: "Section codes must be unique." });
    }
    if (configuration.rosterStructure === "sections_only") {
      if (!configuration.sections.some(({ trackOnly }) => !trackOnly)) {
        context.addIssue({
          code: "custom",
          message: "At least one section must allow member assignments.",
        });
      }
      return;
    }
    if (configuration.voiceParts.length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one part is required when using sections with parts.",
      });
    }
    if (voicePartLabels.size !== configuration.voiceParts.length) {
      context.addIssue({ code: "custom", message: "Performer labels must be unique." });
    }
    if (configuration.voiceParts.some(({ sectionCode }) => !sectionCodes.has(sectionCode))) {
      context.addIssue({
        code: "custom",
        message: "Every Performer assignment must reference an existing section.",
      });
    }
  })
  .transform((configuration) => ({
    ...configuration,
    voiceParts:
      configuration.rosterStructure === "sections_only"
        ? configuration.sections
            .filter(({ trackOnly }) => !trackOnly)
            .map(({ code, name }) => ({
              label: code,
              fullName: name,
              sectionCode: code,
            }))
        : configuration.voiceParts,
  }));

export const organizationRosterConfigurationResponseSchema =
  organizationRosterConfigurationRequestSchema.and(z.object({ requestId: requestIdSchema }));

export const organizationRosterAutomationPreviewRequestSchema = z.object({
  configuration: organizationRosterConfigurationRequestSchema,
  profileId: z.uuid().nullable().default(null),
});

export const organizationRosterAutomationPreviewProfileSchema = z.object({
  currentStatus: z.enum(["Active", "Idle", "Inactive"]),
  displayName: z.string().min(1).max(200),
  id: z.uuid(),
  nextStatus: z.enum(["Active", "Idle", "Inactive"]),
  nextStatusReason: z.string().max(500),
  onBreakInactiveDate: z.string().nullable(),
  recentPerformances: z
    .array(
      z.object({
        attendance: z.enum(["Absent", "Pending", "Present"]),
        id: z.uuid(),
        rsvp: z.enum(["Yes", "No", "Pending"]),
        startsAt: z.iso.datetime(),
        title: z.string().min(1).max(500),
      }),
    )
    .max(10),
});

export const organizationRosterAutomationPreviewResponseSchema = z.object({
  affectedProfileCount: z.number().int().nonnegative().max(500),
  onBreakTimeoutCount: z.number().int().nonnegative().max(500),
  rsvpExpiryCount: z.number().int().nonnegative().max(10_000),
  selectedProfile: organizationRosterAutomationPreviewProfileSchema.nullable(),
  statusChangeCount: z.number().int().nonnegative().max(500),
});

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
