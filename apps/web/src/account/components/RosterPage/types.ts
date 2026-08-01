import type {
  DuesRecord,
  OrganizationMembershipSummary,
  OrganizationProfile,
  OrganizationProfileFolderNumber,
  OrganizationProfilePerformanceHistoryResponse,
  OrganizationProfileStatusHistoryResponse,
  OrganizationRosterConfiguration,
  Season,
} from "@choir/contracts";

export type RosterState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly configuration: OrganizationRosterConfiguration;
      readonly memberships: readonly OrganizationMembershipSummary[];
      readonly profiles: readonly OrganizationProfile[];
      readonly status: "ready";
    };

export type RosterStatusFilter = "all" | OrganizationProfile["globalStatus"];

export type ProfileTab = "dues" | "folders" | "info" | "performance";

export type ProfileStatusHistoryState =
  | { readonly status: "error" | "idle" | "loading" }
  | { readonly data: OrganizationProfileStatusHistoryResponse; readonly status: "ready" };

export type PerformanceHistoryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly data: OrganizationProfilePerformanceHistoryResponse;
      readonly status: "ready";
    };

export type ProfileDuesState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly dues: readonly DuesRecord[];
      readonly seasons: readonly Season[];
      readonly status: "ready";
    };

export type ProfileFolderNumbersState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly folderNumbers: readonly OrganizationProfileFolderNumber[];
      readonly status: "ready";
    };

export type RsvpStatus = "No" | "Pending" | "Yes";
