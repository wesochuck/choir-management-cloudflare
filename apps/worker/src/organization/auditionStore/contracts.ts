import type { OrganizationAuditionSettings } from "@choir/contracts";
import { z } from "zod";

export const defaultAuditionSettings: OrganizationAuditionSettings = {
  adminNotifyEnabled: false,
  adminNotifyUsers: [],
  confirmationMessage: "Thank you for your interest. We will be in touch soon.",
  defaultPerformanceId: null,
  enabled: true,
  mode: "audition",
  rehearsalNotes: "",
  rehearsalSchedule: [],
  slots: [],
  startDate: null,
  venueId: null,
};

export const publicAuditionRateLimitRequestSchema = z.object({
  clientKey: z.string().regex(/^[a-f0-9]{64}$/),
  emailKey: z.string().regex(/^[a-f0-9]{64}$/),
  organizationId: z.string().trim().min(1).max(128),
});

export const publicAuditionRateLimits = [
  { durationMs: 10 * 60 * 1_000, key: "ip", limit: 10 },
  { durationMs: 24 * 60 * 60 * 1_000, key: "email", limit: 3 },
  { durationMs: 60 * 60 * 1_000, key: "organization", limit: 100 },
] as const;

export interface AuditionCreateInput {
  readonly adminNotes?: string;
  readonly availabilityNotes: string;
  readonly email: string;
  readonly experience: string;
  readonly name: string;
  readonly performanceId?: string | null;
  readonly phone: string;
  readonly requestedSlots?: readonly string[];
  readonly scheduledTimeSlot?: string | null;
  readonly status?: string;
  readonly voicePart: string;
}

export interface AuditionUpdateInput {
  readonly adminNotes?: string;
  readonly availabilityNotes?: string;
  readonly email?: string;
  readonly experience?: string;
  readonly name?: string;
  readonly performanceId?: string | null;
  readonly phone?: string;
  readonly requestedSlots?: readonly string[];
  readonly scheduledTimeSlot?: string | null;
  readonly status?: string;
  readonly voicePart?: string;
}

export interface AuditionActor {
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface AuditionRow {
  readonly [column: string]: SqlStorageValue;
  readonly adminNotes: string;
  readonly availabilityNotes: string;
  readonly createdAt: string;
  readonly email: string;
  readonly experience: string;
  readonly id: string;
  readonly name: string;
  readonly performanceId: string | null;
  readonly phone: string;
  readonly requestedSlotsJson: string;
  readonly scheduledTimeSlot: string | null;
  readonly status: string;
  readonly updatedAt: string;
  readonly voicePart: string;
}

export interface AuditionNotificationRow {
  readonly [column: string]: SqlStorageValue;
  readonly auditionId: string;
  readonly contentMarkdown: string;
  readonly destination: string;
  readonly id: string;
  readonly kind:
    "inquiry_confirmation" | "scheduled_confirmation" | "audition_reminder" | "admin_alert";
  readonly recipientName: string;
  readonly status: string;
  readonly subject: string;
  readonly providerEventAt: string | null;
  readonly providerMessageId: string | null;
  readonly providerReason: string;
  readonly providerStatus: string | null;
}

export interface AuditionNotificationResult {
  readonly failureDetail: string;
  readonly jobId: string;
  readonly providerMessageId: string | null;
  readonly status: "failed" | "sent" | "suppressed";
}

export interface AuditionSystemCommunicationTemplate {
  readonly [column: string]: SqlStorageValue;
  readonly contentMarkdown: string;
  readonly subject: string;
}

export const AUDITION_REMINDER_LEAD_MS = 24 * 60 * 60 * 1_000;
