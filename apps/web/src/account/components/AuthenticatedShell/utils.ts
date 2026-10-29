import {
  getOrganizationSidebarGroups,
  getAdminFeatureForPath,
} from "../../organizationFeatures/selectors";
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
  return tab === "dues" ||
    tab === "email" ||
    tab === "folders" ||
    tab === "messages" ||
    tab === "performance"
    ? tab
    : "info";
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
    id: "home",
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", iconId: "home" }],
  },
  {
    id: "people",
    label: "Your membership",
    iconId: "contacts",
    tone: "green",
    items: [
      { href: "/schedule", label: "My schedule", module: "events", iconId: "events" },
      { href: "/profile", label: "My Profile", module: "roster", iconId: "contacts" },
      { href: "/directory", label: "Directory", module: "directory", iconId: "roster" },
      { href: "/dues", label: "Season dues", module: "dues", iconId: "wallet" },
    ],
  },
  {
    id: "music",
    label: "Practice & resources",
    iconId: "music",
    tone: "blue",
    items: [
      { href: "/practice", label: "Practice", module: "practice_player", iconId: "headphones" },
      { href: "/member/resources", label: "Resources", module: "resources", iconId: "resources" },
    ],
  },
];

export function visibleMemberNavigationGroups(
  status: "loading" | "ready" | "error",
  modules: readonly ModuleState[],
): readonly NavigationGroup[] {
  return memberGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.module === undefined || (status === "ready" && routeHasModule(item, modules)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export const organizationGroups: readonly NavigationGroup[] = getOrganizationSidebarGroups({
  modules: [],
  status: "ready",
});

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
  ["/member/resources", "Shared files and trusted links for this Organization."],
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
  ["/member/polls", "Submit your vote on active Organization polls."],
  ["/account", "Manage your personal account, sign-in security, and organization memberships."],
  ["/account/organizations", "Switch between your organizations or view invitations."],
  ["/account/security", "Manage your sign-in password, email address, and authentication methods."],
  ["/account/sessions", "Review and manage active sign-in sessions across your devices."],
];

export function pageDescription(pathname: string, search = ""): string | null {
  if (["/admin/library", "/admin/music"].includes(pathname)) {
    const params = new URLSearchParams(search);
    if (params.get("view") === "credits") {
      return "Review exact catalog credits and correct a composer or arranger name everywhere it is used.";
    }
    return "Manage owned works and movements. Audio tracks are stored securely as Organization files and will appear here when linked through the track workflow.";
  }
  if (["/admin/library/settings", "/admin/music/settings"].includes(pathname)) {
    return "Configure publisher catalog links and the expiry period for public practice-player links.";
  }
  if (pathname === "/admin/tickets/scan")
    return "Scan a ticket QR code at the door or validate a ticket credential manually.";
  const feature = getAdminFeatureForPath(pathname);
  if (feature?.description) return feature.description;
  const exactMatch = staticPageDescriptions.find(([prefix]) => pathname === prefix);
  if (exactMatch) return exactMatch[1];

  let longestMatch: (typeof staticPageDescriptions)[number] | null = null;
  for (const entry of staticPageDescriptions) {
    if (pathname.startsWith(`${entry[0]}/`)) {
      if (!longestMatch || entry[0].length > longestMatch[0].length) {
        longestMatch = entry;
      }
    }
  }
  return longestMatch?.[1] ?? null;
}

export function pageTitle(pathname: string): string {
  if (["/admin/library/settings", "/admin/music/settings"].includes(pathname))
    return "Music library settings";
  if (pathname === "/admin/tickets/scan") return "Ticket scanner";
  const feature = getAdminFeatureForPath(pathname);
  if (feature) return feature.pageTitle;
  const titles: readonly [string, string][] = [
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
    ["/member/polls", "Vote in Poll"],
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
  ["directory", ["/directory"]],
  ["dues", ["/dues"]],
  ["events", ["/schedule", "/calendar"]],
  ["polls", ["/member/polls"]],
  ["practice_player", ["/practice"]],
  ["resources", ["/member/resources"]],
  ["roster", ["/profile"]],
  ["seating", ["/seating"]],
];

export function routeModule(pathname: string): NavigationItem["module"] {
  const feature = getAdminFeatureForPath(pathname);
  if (feature) return feature.requiredModule ?? undefined;
  for (const [moduleKey, prefixes] of moduleRoutePrefixes) {
    if (prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return moduleKey;
    }
  }
  return undefined;
}
