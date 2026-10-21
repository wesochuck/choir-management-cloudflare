import { createContext, useContext } from "react";
import type { ModuleState } from "@choir/contracts";

export type OrganizationModuleSnapshot =
  | { readonly status: "loading" | "error"; readonly modules: readonly ModuleState[] }
  | { readonly status: "ready"; readonly modules: readonly ModuleState[] };
export interface OrganizationModuleController {
  readonly snapshot: OrganizationModuleSnapshot;
  readonly warning: boolean;
  readonly refresh: () => Promise<void>;
  readonly confirmChange: (id: string, enabled: boolean) => void;
}
export const organizationModuleContext = createContext<OrganizationModuleController | null>(null);
export function useOrganizationModules() {
  return useContext(organizationModuleContext);
}
