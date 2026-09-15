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
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/schedule", label: "My schedule", module: "events" },
      { href: "/profile", label: "My Profile", module: "roster" },
      { href: "/directory", label: "Directory", module: "directory" },
      { href: "/dues", label: "Season dues", module: "dues" },
    ],
  },
  {
    label: "Practice & resources",
    items: [
      { href: "/practice", label: "Practice", module: "practice_player" },
      { href: "/member/resources", label: "Resources", module: "resources" },
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
      { href: "/admin/roster", label: "Roster", module: "roster" },
      { href: "/admin/contacts", label: "Contacts" },
      { href: "/admin/settings/invitations", label: "Membership invitations", module: "roster" },
      { href: "/directory", label: "Directory", module: "directory" },
      { href: "/admin/auditions", label: "Auditions & Inquiries", module: "auditions" },
    ],
  },
  {
    label: "Events",
    items: [
      { href: "/admin/events", label: "Events", module: "events" },
      { href: "/admin/venues", label: "Venues", module: "venues" },
      { href: "/admin/rsvp", label: "RSVPs", module: "rsvp" },
      { href: "/admin/attendance", label: "Attendance", module: "attendance" },
      { href: "/admin/seating", label: "Seating", module: "seating" },
    ],
  },
  {
    label: "Music & content",
    items: [
      { href: "/admin/library", label: "Music library", module: "music_library" },
      { href: "/admin/setlists", label: "Set lists", module: "setlists" },
      { href: "/admin/resources", label: "Resources", module: "resources" },
      { href: "/admin/website", label: "Public website", module: "public_website" },
    ],
  },
  {
    label: "Communications & finance",
    items: [
      { href: "/admin/communications", label: "Communications", module: "communications" },
      { href: "/admin/polls", label: "Polls", module: "polls" },
      { href: "/admin/tickets", label: "Ticketing", module: "ticketing" },
      { href: "/admin/donations", label: "Donations & giving", module: "donations" },
      { href: "/admin/seasons", label: "Seasons & dues", module: "dues" },
    ],
  },
  {
    label: "Insights & settings",
    items: [
      { href: "/admin/reports", label: "Reports", module: "reports" },
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
      { href: "/platform/design-system", label: "Design system" },
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
  ["/admin/donations", "Monitor incoming donations, giving activity, and donor recognition tiers."],
  ["/admin/patrons", "Monitor incoming donations, giving activity, and donor recognition tiers."],
  [
    "/admin/communications",
    "Build a message in three steps: choose the audience, write with Markdown and placeholders, then review it before queueing delivery.",
  ],
  [
    "/admin/contacts",
    "Manage marketing and community contacts, contact lists, and communication preferences separately from the Organization roster.",
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
  ["/admin/seasons", "Manage performance seasons, dues schedules, and payment tracking."],
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
  ["/seating", "Charts are shown from the director’s perspective, with the back row first."],
  ["/dues", "View and pay season membership dues and track payment history."],
  ["/account", "Manage your personal account, sign-in security, and organization memberships."],
  ["/account/organizations", "Switch between your organizations or view invitations."],
  ["/account/security", "Manage your sign-in password, email address, and authentication methods."],
  ["/account/sessions", "Review and manage active sign-in sessions across your devices."],
];

export function pageDescription(pathname: string, search = ""): string | null {
  if (pathname === "/admin/library" || pathname === "/admin/music") {
    const params = new URLSearchParams(search);
    if (params.get("view") === "credits") {
      return "Review exact catalog credits and correct a composer or arranger name everywhere it is used.";
    }
    return "Manage owned works and movements. Audio tracks are stored securely as Organization files and will appear here when linked through the track workflow.";
  }
  if (pathname === "/admin/library/settings" || pathname === "/admin/music/settings") {
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
    ["/admin/music/settings", "Music library settings"],
    ["/admin/music", "Music library"],
    ["/admin/communications/polls", "Polls"],
    ["/admin/setlists", "Set lists"],
    ["/admin/resources", "Resources"],
    ["/admin/communications", "Communications"],
    ["/admin/contacts", "Contacts"],
    ["/admin/polls", "Polls"],
    ["/admin/tickets/scan", "Ticket scanner"],
    ["/admin/tickets", "Ticketing"],
    ["/admin/ticketing", "Ticketing"],
    ["/admin/invitations", "Membership invitations"],
    ["/admin/donations", "Donations & Giving"],
    ["/admin/seasons", "Seasons & dues"],
    ["/admin/reports", "Reports"],
    ["/admin/website", "Public website"],
    ["/admin/settings", "Organization settings"],
    ["/platform/security", "Platform security"],
    ["/platform/organizations", "Organizations"],
    ["/platform/dead-letters", "Queue dead letters"],
    ["/platform/email-suppressions", "Email suppressions"],
    ["/platform/design-system", "Design system"],
    ["/platform/access", "Scoped Organization access"],
    ["/platform", "Platform overview"],
    ["/profile", "My Profile"],
    ["/directory", "Directory"],
    ["/dues", "Season dues"],
    ["/schedule", "My schedule"],
    ["/practice", "Practice"],
    ["/seating", "Seating finder"],
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

const moduleRoutePrefixes: readonly (readonly [
  Exclude<NavigationItem["module"], undefined>,
  readonly string[],
])[] = [
  ["attendance", ["/admin/attendance"]],
  ["auditions", ["/admin/auditions"]],
  ["communications", ["/admin/communications"]],
  ["directory", ["/directory"]],
  ["donations", ["/admin/donations", "/admin/patrons"]],
  ["dues", ["/admin/seasons", "/dues"]],
  ["events", ["/schedule", "/calendar", "/admin/events"]],
  ["music_library", ["/admin/library", "/admin/music"]],
  ["polls", ["/admin/polls", "/admin/communications/polls"]],
  ["practice_player", ["/practice"]],
  ["public_website", ["/admin/website"]],
  ["reports", ["/admin/reports"]],
  ["resources", ["/member/resources", "/admin/resources"]],
  ["roster", ["/profile", "/admin/roster", "/admin/settings/invitations", "/admin/invitations"]],
  ["rsvp", ["/admin/rsvp"]],
  ["seating", ["/seating", "/admin/seating"]],
  ["setlists", ["/admin/setlists"]],
  ["ticketing", ["/admin/tickets", "/admin/ticketing"]],
  ["venues", ["/admin/venues"]],
];

export function routeModule(pathname: string): NavigationItem["module"] {
  for (const [moduleKey, prefixes] of moduleRoutePrefixes) {
    if (prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return moduleKey;
    }
  }
  return undefined;
}
