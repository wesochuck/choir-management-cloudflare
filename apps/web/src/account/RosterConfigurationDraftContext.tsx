import type { OrganizationProfile, OrganizationRosterConfiguration } from "@choir/contracts";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  AuthApiError,
  getOrganizationRosterConfiguration,
  listOrganizationProfiles,
  updateOrganizationRosterConfiguration,
} from "../auth/api";
import { usePersistedDraft, type PersistedDraftReturn } from "../persistence";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

export interface RosterConfigurationDraftContextValue {
  readonly draft: OrganizationRosterConfiguration | null;
  readonly draftReturn: PersistedDraftReturn<OrganizationRosterConfiguration>;
  readonly error: string | null;
  readonly loading: boolean;
  readonly profiles: readonly OrganizationProfile[];
  readonly refreshProfiles: () => Promise<void>;
  readonly setProfiles: React.Dispatch<React.SetStateAction<readonly OrganizationProfile[]>>;
}

export const RosterConfigurationDraftContext =
  createContext<RosterConfigurationDraftContextValue | null>(null);

export function useRosterConfigurationDraft(): RosterConfigurationDraftContextValue {
  const context = useContext(RosterConfigurationDraftContext);
  if (!context) {
    throw new Error(
      "useRosterConfigurationDraft must be used within a RosterConfigurationDraftProvider",
    );
  }
  return context;
}

export function RosterConfigurationDraftProvider({
  children,
  enabled,
}: {
  readonly children: ReactNode;
  readonly enabled: boolean;
}) {
  const { setPerformerLabel } = useOrganizationTerminology();
  const [initialConfig, setInitialConfig] = useState<OrganizationRosterConfiguration | null>(null);
  const [profiles, setProfiles] = useState<readonly OrganizationProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const draftReturn = usePersistedDraft<OrganizationRosterConfiguration>({
    initialValue: initialConfig,
    onSaveSuccess: (saved) => {
      setPerformerLabel(saved.performerLabel);
    },
    resourceKey: "organization-roster-configuration",
    save: updateOrganizationRosterConfiguration,
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationProfiles(controller.signal),
    ])
      .then(([loadedConfig, loadedProfiles]) => {
        setInitialConfig(loadedConfig);
        setProfiles(loadedProfiles);
        setPerformerLabel(loadedConfig.performerLabel);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof AuthApiError
            ? caught.message
            : "Roster configuration could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [enabled, setPerformerLabel]);

  async function refreshProfiles(): Promise<void> {
    try {
      const refreshed = await listOrganizationProfiles();
      setProfiles(refreshed);
    } catch {
      // Retain existing profiles if refresh fails
    }
  }

  return (
    <RosterConfigurationDraftContext.Provider
      value={{
        draft: draftReturn.draft,
        draftReturn,
        error: error ?? draftReturn.error,
        loading,
        profiles,
        refreshProfiles,
        setProfiles,
      }}
    >
      {children}
    </RosterConfigurationDraftContext.Provider>
  );
}
