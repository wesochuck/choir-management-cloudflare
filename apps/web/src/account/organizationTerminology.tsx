import { useMemo, type ReactNode } from "react";

import { organizationTerminologyContext } from "./organizationTerminologyContext";

import { normalizeOrganizationTerminology } from "./organizationTerminologyUtils";

export function OrganizationTerminologyProvider({
  children,
  onLabelChange,
  onStructureChange,
  organizationName,
  performerLabel,
  rosterStructure,
}: {
  readonly children: ReactNode;
  readonly onLabelChange: (label: string) => void;
  readonly onStructureChange?: (structure: "sections_only" | "sections_with_parts") => void;
  readonly organizationName?: string;
  readonly performerLabel: string;
  readonly rosterStructure?: "sections_only" | "sections_with_parts";
}) {
  const value = useMemo(
    () => ({
      organizationName,
      ...normalizeOrganizationTerminology(performerLabel, rosterStructure),
      setPerformerLabel: onLabelChange,
      ...(onStructureChange ? { setRosterStructure: onStructureChange } : {}),
    }),
    [onLabelChange, onStructureChange, organizationName, performerLabel, rosterStructure],
  );

  return (
    <organizationTerminologyContext.Provider value={value}>
      {children}
    </organizationTerminologyContext.Provider>
  );
}
