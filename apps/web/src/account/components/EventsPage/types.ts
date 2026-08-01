import type { OrganizationEvent, OrganizationVenue } from "@choir/contracts";

export type EventsState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly events: readonly OrganizationEvent[];
      readonly rsvpFollowUpEnabled: boolean;
      readonly rsvpFollowUpLeadHours: number;
      readonly status: "ready";
      readonly rsvpExpiryEnabled: boolean;
      readonly rsvpExpiryLeadDays: number;
      readonly timezone: string;
      readonly venues: readonly OrganizationVenue[];
    };

export type EventTab = "all" | "performances" | "rehearsals";
