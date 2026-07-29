import { createContext, useContext } from "react";

export interface OrganizationTerminology {
  readonly performerLabel: string;
  readonly performerLabelPlural: string;
  readonly setPerformerLabel: (label: string) => void;
}

export const organizationTerminologyContext = createContext<OrganizationTerminology>({
  performerLabel: "Performer",
  performerLabelPlural: "Performers",
  setPerformerLabel: () => undefined,
});

export function useOrganizationTerminology(): OrganizationTerminology {
  return useContext(organizationTerminologyContext);
}
