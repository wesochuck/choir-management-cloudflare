import type { PerformanceAutomationRecord } from "@choir/domain";

export interface StoredProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly displayName: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly id: string;
  readonly statusChangedAt: string;
  readonly statusChangeReason: string;
  readonly statusIsManual: number;
  readonly voicePart: string;
}

export interface RawPerformanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly isArchived: number;
  readonly isCanceled: number;
  readonly profileId: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly startsAt: string;
  readonly title: string;
}

export interface StoredPerformanceRow extends PerformanceAutomationRecord {
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly profileId: string;
  readonly title: string;
}

export interface StoredPendingRsvpRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly profileId: string;
  readonly startsAt: string;
  readonly type: "Performance" | "Rehearsal";
  readonly rsvpDeadlineDate: string | null;
}

export interface StoredEventRow {
  readonly durationMinutes: number | null;
  readonly isCanceled?: boolean | number;
  readonly startsAt: string;
  readonly type: "Performance" | "Rehearsal";
  readonly rsvpDeadlineDate: string | null;
}

export type RawEventRow = StoredEventRow & Record<string, SqlStorageValue>;

export interface StatusAutomationActor {
  readonly actorId: string;
  readonly actorType: "organization_member" | "system";
  readonly requestId: string;
}

export interface EventRsvpChange {
  readonly actor: StatusAutomationActor;
  readonly automatic: boolean;
  readonly eventId: string;
  readonly newRsvp: "No" | "Pending" | "Yes";
  readonly profileId: string;
  readonly reason: string;
  readonly rsvpNote: string;
  readonly occurredAt: string;
}

export const MAX_AUTOMATION_PROFILES = 500;
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
export const STATUS_AUTOMATION_FIXTURE_DISPLAY_PREFIX = "QUAL-STATUS-AUTOMATION-";

export const defaultStatusAutomationActor = (
  organizationId: string,
  occurredAt: string,
): StatusAutomationActor => ({
  actorId: "",
  actorType: "system",
  requestId: `automation:${organizationId}:${occurredAt}`,
});
