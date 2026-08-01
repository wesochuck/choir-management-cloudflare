import type { ModuleState, OrganizationAuthStatusResponse } from "@choir/contracts";

export type Workspace = "account" | "member" | "organization" | "platform";

export type ThemePreference = "dark" | "light";

export interface RouteState {
  readonly pathname: string;
  readonly search: string;
}

export type RosterProfileTab = "dues" | "folders" | "info" | "performance";

export type AccessState =
  | { readonly status: "loading" }
  | { readonly status: "none" }
  | { readonly status: "error" }
  | {
      readonly context: OrganizationAuthStatusResponse;
      readonly modules: readonly ModuleState[];
      readonly organizationName: string | null;
      readonly status: "ready";
    };

export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly module?: "events" | "people" | "programs";
}

export interface NavigationGroup {
  readonly items: readonly NavigationItem[];
  readonly label: string;
}
