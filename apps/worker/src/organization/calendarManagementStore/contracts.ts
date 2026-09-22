import {
  organizationAttendanceBulkRequestSchema,
  organizationCalendarSettingsRequestSchema,
  organizationEventRequestSchema,
  organizationProfileFolderNumberUpdateSchema,
  organizationRsvpRequestSchema,
  organizationRosterConfigurationRequestSchema,
  organizationVenueRequestSchema,
} from "@choir/contracts";
import { z } from "zod";

const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

export const managementRequestSchema = z.discriminatedUnion("action", [
  actorSchema.extend({
    action: z.literal("bulk_attendance"),
    attendance: organizationAttendanceBulkRequestSchema,
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("update_profile_folder_number"),
    eventId: z.uuid(),
    folder: organizationProfileFolderNumberUpdateSchema,
    profileId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("create_event"),
    event: organizationEventRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("update_event"),
    event: organizationEventRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("archive_event"),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("cancel_event"),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("create_venue"),
    venue: organizationVenueRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("update_venue"),
    venue: organizationVenueRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("delete_venue"),
    venueId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("set_rsvp"),
    eventId: z.uuid(),
    rsvp: organizationRsvpRequestSchema,
    selfService: z.boolean().default(false),
  }),
  actorSchema.extend({
    action: z.literal("bulk_set_rsvp"),
    eventId: z.uuid(),
    updates: z.array(organizationRsvpRequestSchema).min(1).max(500),
  }),
  actorSchema.extend({
    action: z.literal("update_timezone"),
    settings: organizationCalendarSettingsRequestSchema,
  }),
  actorSchema.extend({
    action: z.literal("update_roster_configuration"),
    configuration: organizationRosterConfigurationRequestSchema,
  }),
]);

export type ManagementRequest = z.infer<typeof managementRequestSchema>;
export type EventOperation = Extract<ManagementRequest, { readonly event: unknown }>;
export type VenueOperation = Extract<
  ManagementRequest,
  { readonly action: "create_venue" | "delete_venue" | "update_venue" }
>;

export interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface VenueRow {
  readonly [column: string]: SqlStorageValue;
  readonly address: string;
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface EventRow {
  readonly [column: string]: SqlStorageValue;
  readonly advancePriceCents: number;
  readonly callTime: string;
  readonly createdAt: string;
  readonly details: string;
  readonly dayOfPriceCents: number;
  readonly doorsOpenTime: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly isCanceled: number;
  readonly isTicketingEnabled: number;
  readonly location: string;
  readonly parentPerformanceId: string | null;
  readonly publicDetails: string;
  readonly publicGraphicFileId: string | null;
  readonly publishOnWebsite: number;
  readonly rsvpFollowUpLeadHours: number | null;
  readonly rsvpDeadlineDate: string | null;
  readonly rsvpFollowUpMode: "disabled" | "enabled" | "inherit";
  readonly setListApproved: number;
  readonly setListDefaultTransitionSeconds: number;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly ticketCapacity: number | null;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly updatedAt: string;
  readonly venueId: string | null;
}

export interface DashboardEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
}

export interface MemberEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendanceMissed: number;
  readonly attendanceTotal: number;
  readonly callTime: string;
  readonly details: string;
  readonly directRsvp: "No" | "Pending" | "Yes" | null;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly isCanceled: number;
  readonly location: string;
  readonly parentRsvp: "No" | "Pending" | "Yes" | null;
  readonly parentSetListJson: string | null;
  readonly practiceEventId: string | null;
  readonly practiceTrackCount: number;
  readonly rsvpDeadlineDate: string | null;
  readonly rsvpNote: string;
  readonly seatingChartExists: number;
  readonly seatingAssigned: number;
  readonly setListApproved: number;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly venueAddress: string;
  readonly venueName: string;
}

export interface ProfilePerformanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly id: string;
  readonly location: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly startsAt: string;
  readonly title: string;
  readonly venueName: string;
}

export interface AttendanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly displayName: string;
  readonly profileId: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly updatedAt: string | null;
  readonly voicePart: string;
}

export interface EventRsvpHistoryRow {
  readonly [column: string]: SqlStorageValue;
  readonly actorType: string;
  readonly automatic: number;
  readonly displayName: string;
  readonly eventId: string;
  readonly newRsvp: "No" | "Pending" | "Yes";
  readonly occurredAt: string;
  readonly previousRsvp: "No" | "Pending" | "Yes";
  readonly profileId: string;
  readonly reason: string;
}

export interface ProfileFolderNumberRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventType: "Performance";
  readonly folderNumber: string;
  readonly folderReturned: number;
  readonly profileId: string;
  readonly returnedAt: string | null;
  readonly startsAt: string;
  readonly updatedAt: string | null;
}
