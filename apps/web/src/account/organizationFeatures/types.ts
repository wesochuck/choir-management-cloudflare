import type { ModuleId, ModuleState } from "@choir/contracts";
import type { OrganizationIconId } from "./icons";

export type OverviewTone = "green" | "blue" | "amber" | "pink" | "cyan" | "slate";
export interface DashboardGroup {
  readonly label: string;
  readonly description: string;
  readonly tone: OverviewTone;
}
export interface PaletteEntry {
  readonly position: number;
  readonly id: string;
  readonly category: "navigation" | "settings";
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly ownerOnly?: boolean;
}
export type OrganizationFeatureId =
  | "admin-overview"
  | "roster"
  | "contacts"
  | "membership-invitations"
  | "directory"
  | "auditions"
  | "events"
  | "venues"
  | "rsvp"
  | "attendance"
  | "seating"
  | "music-library"
  | "setlists"
  | "resources"
  | "public-website"
  | "communications"
  | "polls"
  | "ticketing"
  | "donations"
  | "patrons-dashboard"
  | "seasons-dues"
  | "reports"
  | "organization-settings"
  | "modules"
  | "setup-checklist"
  | "organization-security";
interface FeatureIdentity {
  readonly id: OrganizationFeatureId;
  readonly href: string;
  readonly aliases?: readonly string[];
  readonly requiredModule: ModuleId | null;
  readonly iconId: OrganizationIconId;
  readonly label: string;
  readonly pageTitle: string;
  readonly description: string;
  readonly sidebar?: {
    readonly group: 0 | 1 | 2 | 3 | 4 | 5;
    readonly position: number;
    readonly href?: string;
  };
  readonly palette?: PaletteEntry;
}
export type OrganizationFeature = FeatureIdentity &
  (
    | {
        readonly dashboard: DashboardGroup & {
          readonly group: 0 | 1 | 2 | 3;
          readonly position: number;
        };
        readonly coverageReason?: "contextual";
      }
    | {
        readonly dashboard?: undefined;
        readonly coverageReason: "parity-gap" | "landing" | "configuration";
      }
  );
export interface PaletteShortcut extends PaletteEntry {
  readonly parentId: OrganizationFeatureId;
  readonly href: string;
}
export interface QuickShortcut {
  readonly featureId: OrganizationFeatureId;
  readonly href: string;
  readonly iconId: OrganizationIconId;
  readonly label: string;
}
export interface OrganizationFeatureContext {
  readonly modules: readonly ModuleState[];
  readonly status: "loading" | "ready" | "error";
  readonly performerLabel?: string;
  readonly performerLabelPlural?: string;
  readonly partLabel?: string;
  readonly partLabelPlural?: string;
  readonly isOwner?: boolean;
  readonly scopedReadOnly?: boolean;
}
