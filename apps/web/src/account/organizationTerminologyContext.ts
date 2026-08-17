import { createContext, useContext } from "react";

export interface OrganizationTerminology {
  readonly partLabel: string;
  readonly partLabelPlural: string;
  readonly performerLabel: string;
  readonly performerLabelPlural: string;
  readonly setPerformerLabel: (label: string) => void;
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
