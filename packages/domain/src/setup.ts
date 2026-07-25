export type SetupStep = "organization_info" | "modules" | "theme" | "launch";

export interface SetupProgress {
  readonly completedSteps: readonly string[];
  readonly currentStep: SetupStep | null;
  readonly allModulesConfigured: boolean;
  readonly launched: boolean;
}

export interface OrganizationSetup {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly progress: SetupProgress;
  readonly moduleConfig: Record<string, boolean>;
  readonly themeConfig: Record<string, string>;
}

const stepOrder: readonly SetupStep[] = ["organization_info", "modules", "theme", "launch"];

export function nextSetupStep(currentSteps: readonly string[]): SetupStep | null {
  const completed = new Set(currentSteps);
  for (const step of stepOrder) {
    if (!completed.has(step)) {
      return step;
    }
  }
  return null;
}

export function isSetupComplete(setup: SetupProgress): boolean {
  return setup.launched && setup.completedSteps.length >= stepOrder.length;
}
