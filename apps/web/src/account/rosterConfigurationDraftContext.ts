import type { OrganizationProfile, OrganizationRosterConfiguration } from "@choir/contracts";
import { createContext, useContext } from "react";
import type { PersistedDraftReturn } from "../persistence";

export interface RosterConfigurationDraftContextValue {
  readonly draft: OrganizationRosterConfiguration | null;
  readonly draftReturn: PersistedDraftReturn<OrganizationRosterConfiguration>;
  readonly error: string | null;
  readonly loading: boolean;
  readonly profiles: readonly OrganizationProfile[];
  readonly refreshProfiles: () => Promise<void>;
  readonly setProfiles: React.Dispatch<React.SetStateAction<readonly OrganizationProfile[]>>;
}

export const rosterConfigurationDraftContext =
  createContext<RosterConfigurationDraftContextValue | null>(null);

export function useRosterConfigurationDraft(): RosterConfigurationDraftContextValue {
  const context = useContext(rosterConfigurationDraftContext);
  if (!context) {
    throw new Error(
      "useRosterConfigurationDraft must be used within a RosterConfigurationDraftProvider",
    );
  }
  return context;
}
