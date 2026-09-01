import type { OrganizationProfile, OrganizationRosterConfiguration } from "@choir/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AuthApiError,
  getOrganizationRosterConfiguration,
  listOrganizationProfiles,
  updateOrganizationRosterConfiguration,
} from "../auth/api";
import { usePersistedDraft } from "../persistence";
import { useOrganizationTerminology } from "./organizationTerminologyContext";
import {
  rosterConfigurationDraftContext,
  type RosterConfigurationDraftContextValue,
} from "./rosterConfigurationDraftContext";

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
      .then(([config, profilesData]) => {
        setInitialConfig(config);
        setProfiles(profilesData);
        setPerformerLabel(config.performerLabel);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof AuthApiError
              ? err.message
              : "Failed to load roster configuration settings.",
          );
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, setPerformerLabel]);

  const refreshProfiles = async () => {
    try {
      const refreshed = await listOrganizationProfiles();
      setProfiles(refreshed);
    } catch {
      // Ignored: profile list refresh is best effort
    }
  };

  const value: RosterConfigurationDraftContextValue = useMemo(
    () => ({
      draft: draftReturn.draft,
      draftReturn,
      error,
      loading,
      profiles,
      refreshProfiles,
      setProfiles,
    }),
    [draftReturn, error, loading, profiles],
  );

  return (
    <rosterConfigurationDraftContext.Provider value={value}>
      {children}
    </rosterConfigurationDraftContext.Provider>
  );
}
