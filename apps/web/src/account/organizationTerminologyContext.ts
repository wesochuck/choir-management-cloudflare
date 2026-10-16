import { createContext, useContext } from "react";

export interface OrganizationTerminology {
  readonly organizationName?: string | undefined;
  readonly partLabel: string;
  readonly partLabelPlural: string;
  readonly performerLabel: string;
  readonly performerLabelPlural: string;
  readonly setPerformerLabel: (label: string) => void;
  readonly setRosterStructure?: (structure: "sections_only" | "sections_with_parts") => void;
}

export const organizationTerminologyContext = createContext<OrganizationTerminology>({
  partLabel: "Part",
  partLabelPlural: "Parts",
  performerLabel: "Performer",
  performerLabelPlural: "Performers",
  setPerformerLabel: () => undefined,
});

export function useOrganizationTerminology(): OrganizationTerminology {
  return useContext(organizationTerminologyContext);
}
