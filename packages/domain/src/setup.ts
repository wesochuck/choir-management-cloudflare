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

export type ModuleCategory = "people" | "events" | "content" | "finance" | "insights";

export interface ModuleDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: ModuleCategory;
  readonly defaultEnabled: boolean;
  readonly legacyParent?: "people" | "events" | "programs";
}

export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  {
    category: "people",
    defaultEnabled: true,
    description: "Manage member roster, section assignments, statuses, and contact details.",
    id: "roster",
    label: "Roster & Members",
    legacyParent: "people",
  },
  {
    category: "people",
    defaultEnabled: true,
    description: "Member-facing searchable contact directory.",
    id: "directory",
    label: "Member Directory",
    legacyParent: "people",
  },
  {
    category: "people",
    defaultEnabled: true,
    description: "Singer inquiry forms, audition scheduling, and applicant scoring.",
    id: "auditions",
    label: "Auditions & Inquiries",
    legacyParent: "people",
  },
  {
    category: "events",
    defaultEnabled: true,
    description: "Rehearsal and performance calendar management and member schedules.",
    id: "events",
    label: "Events & Rehearsals",
    legacyParent: "events",
  },
  {
    category: "events",
    defaultEnabled: true,
    description: "Rehearsal and performance locations and directions.",
    id: "venues",
    label: "Venues",
    legacyParent: "events",
  },
  {
    category: "events",
    defaultEnabled: true,
    description: "Singer attendance availability and RSVP response tracking.",
    id: "rsvp",
    label: "Event RSVPs",
    legacyParent: "events",
  },
  {
    category: "events",
    defaultEnabled: true,
    description: "Attendance taking at rehearsals and performances.",
    id: "attendance",
    label: "Attendance Tracking",
    legacyParent: "events",
  },
  {
    category: "events",
    defaultEnabled: true,
    description: "Visual choir risers and stage seating layouts.",
    id: "seating",
    label: "Seating Charts",
    legacyParent: "events",
  },
  {
    category: "content",
    defaultEnabled: true,
    description: "Music catalog, titles, movements, audio tracks, and folder assignments.",
    id: "music_library",
    label: "Music Library",
    legacyParent: "programs",
  },
  {
    category: "content",
    defaultEnabled: true,
    description: "Concert set lists, performance order, and linked repertoire.",
    id: "setlists",
    label: "Set Lists",
    legacyParent: "programs",
  },
  {
    category: "content",
    defaultEnabled: true,
    description: "Shared sheet music links, handbooks, policy documents, and files.",
    id: "resources",
    label: "Resources & Files",
    legacyParent: "programs",
  },
  {
    category: "content",
    defaultEnabled: true,
    description: "Practice player for audio playback and part rehearsal.",
    id: "practice_player",
    label: "Practice Player",
    legacyParent: "programs",
  },
  {
    category: "content",
    defaultEnabled: true,
    description: "Public website, concert previews, and organization overview.",
    id: "public_website",
    label: "Public Website",
    legacyParent: "programs",
  },
  {
    category: "finance",
    defaultEnabled: true,
    description: "Mass email announcements, rehearsal reminders, and messaging.",
    id: "communications",
    label: "Communications",
    legacyParent: "programs",
  },
  {
    category: "finance",
    defaultEnabled: true,
    description: "Member polls and decision voting.",
    id: "polls",
    label: "Member Polls",
    legacyParent: "programs",
  },
  {
    category: "finance",
    defaultEnabled: true,
    description: "Concert ticket sales, discount codes, bundles, and ticket scanner.",
    id: "ticketing",
    label: "Ticketing & Sales",
    legacyParent: "programs",
  },
  {
    category: "finance",
    defaultEnabled: true,
    description: "Online and manual donations, patron tiers, and donor thank-you notes.",
    id: "donations",
    label: "Donations & Giving",
    legacyParent: "programs",
  },
  {
    category: "finance",
    defaultEnabled: true,
    description: "Performance seasons, member dues tracking, and payment receipts.",
    id: "dues",
    label: "Seasons & Dues",
    legacyParent: "people",
  },
  {
    category: "insights",
    defaultEnabled: true,
    description: "Attendance, repertoire, roster, and music folder reports.",
    id: "reports",
    label: "Reports & Analytics",
    legacyParent: "events",
  },
];

export function resolveModuleEnabled(moduleId: string, config: Record<string, boolean>): boolean {
  const directValue = config[moduleId];
  if (typeof directValue === "boolean") {
    return directValue;
  }
  const definition = MODULE_DEFINITIONS.find((def) => def.id === moduleId);
  if (definition?.legacyParent) {
    const parentValue = config[definition.legacyParent];
    if (typeof parentValue === "boolean") {
      return parentValue;
    }
  }
  return definition?.defaultEnabled ?? true;
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
