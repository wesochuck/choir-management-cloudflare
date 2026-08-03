import type { ModuleState } from "@choir/contracts";
import type {
  NavigationGroup,
  NavigationItem,
  RosterProfileTab,
  RouteState,
  ThemePreference,
  Workspace,
} from "./types";

export const themeStoragePrefix = "choir-theme:";

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
      { href: "/admin/auditions", label: "Auditions", module: "people" },
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

export function pageTitle(pathname: string): string {
  const titles: readonly [string, string][] = [
    ["/admin/settings/invitations", "Membership invitations"],
    ["/admin/settings/security", "Organization security"],
    ["/admin/settings/modules", "Modules"],
    ["/admin/settings/setup-checklist", "Setup checklist"],
    ["/admin/roster", "Roster"],
    ["/admin/auditions", "Auditions"],
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

export const moduleRoutePrefixes: Record<
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
