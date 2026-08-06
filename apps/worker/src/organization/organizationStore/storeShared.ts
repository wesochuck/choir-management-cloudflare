import { z } from "zod";
import {
  memberProfileUpdateRequestSchema,
  organizationProfileRequestSchema,
} from "@choir/contracts";

export const completionSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  completedAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
});

export const failureSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  failedAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
});

export const terminalSchema = failureSchema.extend({
  errorCode: z.string().min(1).max(128),
  terminalAt: z.iso.datetime(),
});

export const organizationProvisioningSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "pending"]),
  name: z.string().min(1).max(120),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
  slug: z.string().min(2).max(63),
});

export const profileIdSchema = z.uuid();
export const profileCreateSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  profile: organizationProfileRequestSchema,
  profileId: z.uuid(),
  requestId: z.uuid(),
});
export const profileUpdateSchema = profileCreateSchema;
export const profileDeleteSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  profileId: z.uuid(),
  requestId: z.uuid(),
});
export const profileImportSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  profiles: z
    .array(
      z.object({
        profile: organizationProfileRequestSchema,
        profileId: z.uuid(),
      }),
    )
    .min(1)
    .max(500),
  requestId: z.uuid(),
});
export const memberProfileUpdateSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  profile: memberProfileUpdateRequestSchema,
  profileId: z.uuid(),
  requestId: z.uuid(),
});
export const profilePhotoOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("attach"),
    actorUserId: z.string().min(1).max(128),
    fileId: z.uuid(),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
    requestId: z.uuid(),
  }),
  z.object({
    action: z.literal("remove"),
    actorUserId: z.string().min(1).max(128),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
    requestId: z.uuid(),
  }),
]);
export const schemaPreparationRequestSchema = z.object({
  organizationId: z.string().min(1).max(128),
  targetVersion: z.number().int().positive(),
});
export const privateFileReclaimResponseSchema = z.object({
  reclaimed: z.literal(true),
});
export const calendarCredentialRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
  }),
  z.object({
    action: z.literal("reset"),
    actorUserId: z.string().min(1).max(128),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
    requestId: z.uuid(),
  }),
]);
export const calendarFeedValidationSchema = z.object({
  organizationId: z.string().min(1).max(128),
  profileId: z.uuid(),
  readAt: z.iso.datetime(),
  revocationVersion: z.number().int().positive(),
});

export interface OrganizationMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly name: string;
  readonly organizationId: string;
  readonly slug: string;
}

export interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface OrganizationSchemaVersionRow {
  readonly [column: string]: SqlStorageValue;
  readonly schemaVersion: number;
}

export interface CalendarProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly calendarFeedVersion: number;
  readonly displayName: string;
}

export interface OrganizationProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly displayName: string;
  readonly doNotEmail: number;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly id: string;
  readonly isSectionLeader: number;
  readonly lastBounceAt: string;
  readonly notes: string;
  readonly photoFileId: string | null;
  readonly phone: string;
  readonly bounceReason: string;
  readonly receiveAdminNotifications: number;
  readonly receiveAttendanceReports: number;
  readonly receiveFinancialAlerts: number;
  readonly receiveRsvpDeclineNotices: number;
  readonly showInDirectory: number;
  readonly statusChangedAt: string;
  readonly statusChangeReason: string;
  readonly statusIsManual: number;
  readonly updatedAt: string;
  readonly voicePart: string;
}

export function profileResult(row: OrganizationProfileRow, onBreakInactiveAt: string | null) {
  return {
    createdAt: row.createdAt,
    displayName: row.displayName,
    doNotEmail: row.doNotEmail === 1,
    globalStatus: row.globalStatus,
    id: row.id,
    onBreakInactiveAt,
    isSectionLeader: row.isSectionLeader === 1,
    lastBounceAt: row.lastBounceAt,
    notes: row.notes,
    photoFileId: row.photoFileId,
    phone: row.phone,
    bounceReason: row.bounceReason,
    receiveAdminNotifications: row.receiveAdminNotifications === 1,
    receiveAttendanceReports: row.receiveAttendanceReports === 1,
    receiveFinancialAlerts: row.receiveFinancialAlerts === 1,
    receiveRsvpDeclineNotices: row.receiveRsvpDeclineNotices === 1,
    showInDirectory: row.showInDirectory === 1,
    statusChangedAt: row.statusChangedAt || row.createdAt,
    statusChangeReason: row.statusChangeReason || "Initial status",
    statusIsManual: row.statusIsManual === 1,
    updatedAt: row.updatedAt,
    voicePart: row.voicePart,
  };
}

export interface CalendarEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly callTime: string;
  readonly details: string;
  readonly directRsvp: string | null;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly parentRsvp: string | null;
  readonly setListApproved: number;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly venueAddress: string;
  readonly venueName: string;
}

export interface JobLedgerRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempt: number;
  readonly jobId: string;
  readonly status: string;
}

export interface PrivateFileMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentType: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly uploadedAt: string;
}

export function organizationIdentity(
  storage: DurableObjectStorage,
): OrganizationMetadataRow | undefined {
  return storage.sql
    .exec<OrganizationMetadataRow>(
      `SELECT organization_id AS organizationId, name, slug
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
}
