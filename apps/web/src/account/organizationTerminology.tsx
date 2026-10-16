import { useMemo, type ReactNode } from "react";

import { organizationTerminologyContext } from "./organizationTerminologyContext";

const DEFAULT_PERFORMER_LABEL = "Performer";

function normalizePerformerLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed || DEFAULT_PERFORMER_LABEL;
}

function pluralizePerformerLabel(label: string): string {
  return `${label}s`;
}

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
      partLabel: rosterStructure === "sections_only" ? "Section" : "Part",
      partLabelPlural: rosterStructure === "sections_only" ? "Sections" : "Parts",
      performerLabel: normalizePerformerLabel(performerLabel),
      performerLabelPlural: pluralizePerformerLabel(normalizePerformerLabel(performerLabel)),
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
