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
  performerLabel,
}: {
  readonly children: ReactNode;
  readonly onLabelChange: (label: string) => void;
  readonly performerLabel: string;
}) {
  const value = useMemo(
    () => ({
      performerLabel: normalizePerformerLabel(performerLabel),
      performerLabelPlural: pluralizePerformerLabel(normalizePerformerLabel(performerLabel)),
      setPerformerLabel: onLabelChange,
    }),
    [onLabelChange, performerLabel],
  );

  return (
    <organizationTerminologyContext.Provider value={value}>
      {children}
    </organizationTerminologyContext.Provider>
  );
}
