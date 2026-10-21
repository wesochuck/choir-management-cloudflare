import type {
  OrganizationFeatureId,
  OrganizationGroupId,
  OverviewTone,
} from "../../organizationFeatures/types";
import type { OrganizationIconId } from "../../organizationFeatures/icons";
import type {
  ModuleId,
  ModuleState,
  OrganizationAuthStatusResponse,
  PlatformOrganizationContextResponse,
} from "@choir/contracts";

export type Workspace = "account" | "member" | "organization" | "platform";

export type ThemePreference = "dark" | "light";

export interface RouteState {
  readonly pathname: string;
  readonly search: string;
}

export type RosterProfileTab = "dues" | "email" | "folders" | "info" | "messages" | "performance";

export type AccessState =
  | { readonly status: "loading" }
  | { readonly status: "none" }
  | { readonly status: "error" }
  | {
      readonly context: OrganizationAuthStatusResponse;
      readonly platformContext?: PlatformOrganizationContextResponse;
      readonly modules: readonly ModuleState[];
      readonly organizationName: string | null;
      readonly status: "ready";
    }
  | {
      /**
       * Verified Platform Administrator scoped to the hostname-resolved
       * Organization without Organization Membership (issue #147).
       * Read-only unless `platformContext.canEdit` (timed elevation).
       */
      readonly modules: readonly ModuleState[];
      readonly organizationName: string | null;
      readonly platformContext: PlatformOrganizationContextResponse;
      readonly status: "platform-scoped";
    };

export interface NavigationItem {
  readonly featureId?: OrganizationFeatureId;
  readonly iconId?: OrganizationIconId;
  readonly href: string;
  readonly label: string;
  readonly module?: ModuleId;
}

export interface NavigationGroup {
  readonly id?: OrganizationGroupId | "home";
  readonly iconId?: OrganizationIconId;
  readonly tone?: OverviewTone;
  readonly items: readonly NavigationItem[];
  readonly label: string;
}
