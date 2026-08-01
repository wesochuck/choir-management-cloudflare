import type {
  OrganizationAudition,
  OrganizationMembershipSummary,
  OrganizationProfile,
} from "@choir/contracts";

export interface Props {
  readonly enabled: boolean;
}

export type ManagerState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly auditions: readonly OrganizationAudition[] };

export type AuditionTab = "inquiries" | "settings";

export interface AdministratorRecipient {
  readonly email: string;
  readonly profile: OrganizationProfile;
  readonly role: OrganizationMembershipSummary["role"];
}
