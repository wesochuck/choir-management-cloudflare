import {
  musicFolderNumberBatchRequestSchema,
  musicFolderReportDetailRowSchema,
  musicFolderReportSelectionSchema,
  musicFolderReturnStatusRequestSchema,
} from "@choir/contracts";
import type { MusicFolderReportStatus } from "@choir/contracts";
import { z } from "zod";

export const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

export const queryRequestSchema = actorSchema.and(musicFolderReportSelectionSchema);
export const profileDetailRequestSchema = queryRequestSchema.and(z.object({ profileId: z.uuid() }));
export const batchRequestSchema = actorSchema.and(musicFolderNumberBatchRequestSchema);
export const returnStatusRequestSchema = actorSchema.and(
  z.object({
    eventId: z.uuid(),
    folder: musicFolderReturnStatusRequestSchema,
    profileId: z.uuid(),
  }),
);

export interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface PerformanceOptionRow {
  readonly [column: string]: SqlStorageValue;
  readonly assignedFolderCount: number;
  readonly id: string;
  readonly isArchived: number;
  readonly isCanceled: number;
  readonly startsAt: string;
  readonly title: string;
}

export interface PerformanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly isArchived: number;
  readonly isCanceled: number;
  readonly startsAt: string;
}

export interface ProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly profileId: string;
}

export interface FolderStorageRow extends PerformanceRow {
  readonly displayName: string;
  readonly folderNumber: string;
  readonly folderReturned: number;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly profileId: string;
  readonly returnedAt: string | null;
  readonly updatedAt: string | null;
}

export interface CurrentFolderRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly folderNumber: string;
  readonly folderReturned: number;
  readonly profileId: string;
  readonly returnedAt: string | null;
  readonly updatedAt: string;
}

export interface ReportActor {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface GroupedProfile {
  readonly displayName: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly profileId: string;
  readonly rows: { readonly status: MusicFolderReportStatus }[];
}

export type MusicFolderNumberUpdate = z.infer<
  typeof musicFolderNumberBatchRequestSchema
>["updates"][number];

export type PreliminaryUpdate =
  | {
      readonly current: CurrentFolderRow | undefined;
      readonly kind: "invalid";
      readonly reason: string;
      readonly update: MusicFolderNumberUpdate;
    }
  | {
      readonly current: CurrentFolderRow;
      readonly kind: "candidate";
      readonly reason: null;
      readonly update: MusicFolderNumberUpdate;
    }
  | {
      readonly current: CurrentFolderRow;
      readonly kind: "stale";
      readonly reason: "stale_folder_row";
      readonly update: MusicFolderNumberUpdate;
    };

export function isCandidate(
  item: PreliminaryUpdate,
): item is Extract<PreliminaryUpdate, { kind: "candidate" }> {
  return item.kind === "candidate";
}

export function identityMatches(storage: DurableObjectStorage, organizationId: string): boolean {
  const identity = storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return identity?.organizationId === organizationId;
}

export function placeholders(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

export { musicFolderReportDetailRowSchema };
