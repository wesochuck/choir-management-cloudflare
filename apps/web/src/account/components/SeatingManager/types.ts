import type {
  OrganizationEvent,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
  OrganizationSeatingChartRequest,
  SeatingConfiguration,
} from "@choir/contracts";

export interface SeatingResources {
  readonly events: readonly OrganizationEvent[];
  readonly profiles: readonly OrganizationProfile[];
  readonly roster: OrganizationRosterConfiguration;
  readonly seating: SeatingConfiguration;
}

export type ViewMode = "grid" | "list" | "index";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface ConfirmState {
  readonly confirmLabel: string;
  readonly message: string;
  readonly onConfirm: () => void | Promise<void>;
  readonly title: string;
}

export interface FormationOrderOption {
  readonly label: string;
  readonly value: string;
}

export interface SeatTileProps {
  readonly assigned: OrganizationProfile | undefined;
  readonly label: string;
  readonly mismatch: boolean;
  readonly onActivate: () => void;
  readonly onDrop: (token: string) => void;
  readonly onRemove: () => void;
  readonly seatKey: string;
  readonly suggestion: string | undefined;
}

export type { OrganizationProfileRequest, OrganizationSeatingChartRequest };
