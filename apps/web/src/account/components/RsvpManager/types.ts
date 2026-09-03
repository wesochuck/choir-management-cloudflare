import type {
  OrganizationEvent,
  OrganizationProfile,
  OrganizationRosterConfiguration,
} from "@choir/contracts";

export type RsvpState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly events: readonly OrganizationEvent[];
      readonly profiles: readonly OrganizationProfile[];
      readonly roster: OrganizationRosterConfiguration;
      readonly status: "ready";
    };

export type RsvpFilter = "active" | "Yes" | "No" | "Pending";
export type RsvpView = "roster" | "history";
export type RsvpAssignmentFilter =
  | { readonly kind: "section"; readonly value: string }
  | { readonly kind: "voicePart"; readonly value: string };

export interface RsvpCounts {
  readonly active: number;
  readonly attending: number;
  readonly declined: number;
  readonly pending: number;
}
