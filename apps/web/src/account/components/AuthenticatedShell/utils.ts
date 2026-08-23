import type { ModuleState } from "@choir/contracts";
import type {
  NavigationGroup,
  NavigationItem,
  RosterProfileTab,
  RouteState,
  ThemePreference,
  Workspace,
} from "./types";

const themeStoragePrefix = "choir-theme:";

export function themeStorageKey(): string {
  return `${themeStoragePrefix}${window.location.hostname}`;
}

export function readThemePreference(): ThemePreference {
  try {
    return window.localStorage.getItem(themeStorageKey()) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = preference;
}

export function rosterProfileTabFromSearch(search: string): RosterProfileTab {
  const tab = new URLSearchParams(search).get("tab");
  return tab === "dues" || tab === "folders" || tab === "performance" ? tab : "info";
}

export const accountGroups: readonly NavigationGroup[] = [
  {
    label: "Account",
    items: [
      { href: "/account", label: "Account overview" },
      { href: "/account/organizations", label: "Organizations" },
      { href: "/account/security", label: "Sign-in & security" },
      { href: "/account/sessions", label: "Active sessions" },
    ],
  },
];

export const memberGroups: readonly NavigationGroup[] = [
  {
    label: "Your choir",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/schedule", label: "My schedule", module: "events" },
      { href: "/profile", label: "My Profile", module: "people" },
      { href: "/directory", label: "Directory", module: "people" },
      { href: "/dues", label: "Season dues", module: "people" },
    ],
  },
  {
    label: "Practice & resources",
    items: [
      { href: "/practice", label: "Practice", module: "programs" },
      { href: "/member/resources", label: "Resources", module: "programs" },
    ],
  },
];

export const organizationGroups: readonly NavigationGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Admin overview" }],
  },
  {
    label: "People",
    items: [
      { href: "/admin/roster", label: "Roster", module: "people" },
      { href: "/admin/settings/invitations", label: "Membership invitations", module: "people" },
      { href: "/directory", label: "Directory", module: "people" },
      { href: "/admin/auditions", label: "Auditions & Inquiries", module: "people" },
    ],
  },
  {
    label: "Events",
    items: [
      { href: "/admin/events", label: "Events", module: "events" },
      { href: "/admin/venues", label: "Venues", module: "events" },
      { href: "/admin/rsvp", label: "RSVPs", module: "events" },
      { href: "/admin/attendance", label: "Attendance", module: "events" },
      { href: "/admin/seating", label: "Seating", module: "events" },
    ],
  },
  {
    label: "Music & content",
    items: [
      { href: "/admin/library", label: "Music library", module: "programs" },
      { href: "/admin/setlists", label: "Set lists", module: "programs" },
      { href: "/admin/resources", label: "Resources", module: "programs" },
      { href: "/admin/website", label: "Public website", module: "programs" },
    ],
  },
  {
    label: "Communications & finance",
    items: [
      { href: "/admin/communications", label: "Communications", module: "programs" },
      { href: "/admin/polls", label: "Polls", module: "programs" },
      { href: "/admin/tickets", label: "Ticketing", module: "programs" },
      { href: "/admin/donations", label: "Donations & giving", module: "programs" },
      { href: "/admin/seasons", label: "Seasons & dues", module: "people" },
    ],
  },
  {
    label: "Insights & settings",
    items: [
      { href: "/admin/reports", label: "Reports", module: "events" },
      { href: "/admin/settings", label: "Organization settings" },
      { href: "/admin/settings/modules", label: "Modules" },
      { href: "/admin/settings/setup-checklist", label: "Setup checklist" },
      { href: "/admin/settings/security", label: "Organization security" },
    ],
  },
];

export const platformGroups: readonly NavigationGroup[] = [
  {
    label: "Platform",
    items: [
      { href: "/platform", label: "Platform overview" },
      { href: "/platform/security", label: "Platform security" },
      { href: "/platform/organizations", label: "Organizations" },
      { href: "/platform/dead-letters", label: "Queue dead letters" },
      { href: "/platform/email-suppressions", label: "Email suppressions" },
    ],
  },
];

export function readRoute(): RouteState {
  return {
    pathname: window.location.pathname.replace(/\/+$/, "") || "/",
    search: window.location.search,
  };
}

export function workspaceForPath(pathname: string): Workspace {
  if (pathname.startsWith("/admin")) return "organization";
  if (pathname.startsWith("/platform")) return "platform";
  if (pathname.startsWith("/account")) return "account";
  return "member";
}

export function workspaceLabel(workspace: Workspace): string {
  switch (workspace) {
    case "organization":
      return "Organization Admin";
    case "platform":
      return "Platform Admin";
    case "account":
      return "Account";
    case "member":
      return "Member workspace";
  }
}

const staticPageDescriptions: readonly [string, string][] = [
  [
    "/admin/events",
    "Create and manage rehearsals, performances, and call times. Track attendance and edit seating charts.",
  ],
  ["/admin/venues", "Manage performance and rehearsal venues and locations."],
  ["/admin/rsvp", "Track singer availability and RSVP responses for rehearsals and performances."],
  [
    "/admin/attendance",
    "Tap a name to cycle Pending, Present, and Absent. Changes save immediately.",
  ],
  [
    "/admin/setlists",
    "Build concert set lists, link musical pieces from the catalog, and share performance order.",
  ],
  [
    "/admin/auditions",
    "Review candidate submissions, manage audition slots, and track singer inquiries.",
  ],
  ["/admin/tickets", "Manage ticket sales, bundles, and check-in."],
  [
    "/admin/tickets/scan",
    "Scan a ticket QR code at the door or validate a ticket credential manually.",
  ],
  [
    "/admin/donations",
    "Monitor your choir’s incoming donations, giving activity, and donor recognition tiers.",
  ],
  [
    "/admin/patrons",
    "Monitor your choir’s incoming donations, giving activity, and donor recognition tiers.",
  ],
  [
    "/admin/communications",
    "Build a message in three steps: choose the audience, write with Markdown and placeholders, then review it before queueing delivery.",
  ],
  [
    "/admin/website",
    "Edit a private draft, then publish an immutable edge-cached version for Organization visitors.",
  ],
  ["/admin/resources", "Shared files and trusted links for this Organization."],
  ["/member/resources", "Shared files and trusted links for this Organization."],
  [
    "/admin/roster",
    "Manage the organization roster, section assignments, member statuses, and contact details.",
  ],
  ["/admin/reports", "Generate and review attendance, repertoire, and roster reports."],
  ["/admin/seasons", "Manage choir performance seasons, dues schedules, and payment tracking."],
  ["/admin/polls", "Create polls, collect member votes, and review real-time tally results."],
  ["/admin/settings", "Manage organization preferences, terminology, and defaults."],
  [
    "/admin/settings/invitations",
    "Invite new members, managers, and administrators to the organization.",
  ],
  [
    "/admin/settings/security",
    "Manage two-factor authentication and organization security policies.",
  ],
  ["/admin/settings/modules", "Enable or disable feature modules for your organization."],
  [
    "/admin/settings/setup-checklist",
    "Review configuration steps to prepare your organization for launch.",
  ],
  ["/directory", "Search and browse member directory contacts and section assignments."],
  [
    "/profile",
    "View and update your member profile details, voice part, and directory preferences.",
  ],
  ["/schedule", "View your upcoming rehearsals, performances, call times, and locations."],
  ["/calendar", "View your upcoming rehearsals, performances, call times, and locations."],
  ["/practice", "Listen to rehearsal learning tracks and audio recordings."],
  ["/dues", "View and pay season membership dues and track payment history."],
  ["/account", "Manage your personal account, sign-in security, and organization memberships."],
  ["/account/organizations", "Switch between your organizations or view invitations."],
  ["/account/security", "Manage your sign-in password, email address, and authentication methods."],
  ["/account/sessions", "Review and manage active sign-in sessions across your devices."],
];

export function pageDescription(pathname: string, search = ""): string | null {
  if (pathname === "/admin/library") {
    const params = new URLSearchParams(search);
    if (params.get("view") === "credits") {
      return "Review exact catalog credits and correct a composer or arranger name everywhere it is used.";
    }
    return "Manage owned works and movements. Audio tracks are stored securely as Organization files and will appear here when linked through the track workflow.";
  }
  if (pathname === "/admin/library/settings") {
    return "Configure publisher catalog links and the expiry period for public practice-player links.";
  }
  return (
    staticPageDescriptions.find(
      ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )?.[1] ?? null
  );
}

export function pageTitle(pathname: string): string {
  const titles: readonly [string, string][] = [
    ["/admin/settings/invitations", "Membership invitations"],
    ["/admin/settings/security", "Organization security"],
    ["/admin/settings/modules", "Modules"],
    ["/admin/settings/setup-checklist", "Setup checklist"],
    ["/admin/roster", "Roster"],
    ["/admin/auditions", "Auditions & Inquiries"],
    ["/admin/events", "Events"],
    ["/admin/venues", "Venues"],
    ["/admin/rsvp", "Event RSVPs"],
    ["/admin/attendance", "Attendance"],
    ["/admin/seating", "Seating"],
    ["/admin/library/settings", "Music library settings"],
    ["/admin/library", "Music library"],
    ["/admin/setlists", "Set lists"],
    ["/admin/resources", "Resources"],
    ["/admin/communications", "Communications"],
    ["/admin/polls", "Polls"],
    ["/admin/tickets/scan", "Ticket scanner"],
    ["/admin/tickets", "Ticketing"],
    ["/admin/donations", "Donations & Giving"],
    ["/admin/seasons", "Seasons & dues"],
    ["/admin/reports", "Reports"],
    ["/admin/website", "Public website"],
    ["/admin/settings", "Organization settings"],
    ["/platform/security", "Platform security"],
    ["/platform/organizations", "Organizations"],
    ["/platform/dead-letters", "Queue dead letters"],
    ["/platform/email-suppressions", "Email suppressions"],
    ["/platform/access", "Scoped Organization access"],
    ["/platform", "Platform overview"],
    ["/profile", "My Profile"],
    ["/directory", "Directory"],
    ["/dues", "Season dues"],
    ["/schedule", "My schedule"],
    ["/practice", "Practice"],
    ["/member/resources", "Resources"],
    ["/calendar", "My schedule"],
    ["/account/security", "Sign-in & security"],
    ["/account/organizations", "Organizations"],
    ["/account/sessions", "Active sessions"],
    ["/account", "Account overview"],
  ];
  return (
    titles.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ??
    (pathname === "/admin"
      ? "Admin overview"
      : pathname === "/dashboard"
        ? "Dashboard"
        : "Workspace")
  );
}

export function routeHasModule(
  item: Pick<NavigationItem, "module">,
  modules: readonly ModuleState[],
): boolean {
  if (!item.module) return true;
  return modules.find((module) => module.id === item.module)?.enabled ?? true;
}

const moduleRoutePrefixes: Record<
  Exclude<NavigationItem["module"], undefined>,
  readonly string[]
> = {
  events: [
    "/schedule",
    "/calendar",
    "/seating",
    "/admin/events",
    "/admin/venues",
    "/admin/rsvp",
    "/admin/attendance",
    "/admin/seating",
    "/admin/reports",
  ],
  people: [
    "/profile",
    "/directory",
    "/dues",
    "/admin/roster",
    "/admin/settings/invitations",
    "/admin/auditions",
    "/admin/seasons",
  ],
  programs: [
    "/practice",
    "/member/resources",
    "/admin/library",
    "/admin/setlists",
    "/admin/resources",
    "/admin/website",
    "/admin/communications",
    "/admin/polls",
    "/admin/tickets",
    "/admin/donations",
    "/admin/patrons",
  ],
};

export function routeModule(pathname: string): NavigationItem["module"] {
  for (const module of ["people", "events", "programs"] as const) {
    if (
      moduleRoutePrefixes[module].some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      )
    ) {
      return module;
    }
  }
  return undefined;
}
