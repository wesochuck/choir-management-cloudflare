import {
  moduleStatesResponseSchema,
  setupStatusSchema,
  type CurrentAuthSession,
  type ModuleState,
  type OrganizationAuthStatusResponse,
} from "@choir/contracts";
import { Sheet } from "@choir/ui";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AuthApiError,
  getOrganizationAuthStatus,
  getOrganizationRosterConfiguration,
  getPlatformMfaStatus,
  signOut,
} from "../auth/api";
import { FloatingSaveBarProvider } from "./FloatingSaveBar";
import { OrganizationAdminOverview } from "./OrganizationAdminOverview";
import { OrganizationTerminologyProvider } from "./organizationTerminology";

type Workspace = "account" | "member" | "organization" | "platform";
type ThemePreference = "dark" | "light";

const themeStoragePrefix = "choir-theme:";

const AccountSecurity = lazy(() =>
  import("./AccountSecurity").then(({ AccountSecurity: component }) => ({ default: component })),
);
const AccountView = lazy(() =>
  import("./AccountView").then(({ AccountView: component }) => ({ default: component })),
);
const AttendanceManager = lazy(() =>
  import("./AttendanceManager").then(({ AttendanceManager: component }) => ({
    default: component,
  })),
);
const AuditionManager = lazy(() =>
  import("./AuditionManager").then(({ AuditionManager: component }) => ({ default: component })),
);
const CalendarSubscription = lazy(() =>
  import("./CalendarSubscription").then(({ CalendarSubscription: component }) => ({
    default: component,
  })),
);
const CommunicationCenter = lazy(() =>
  import("./CommunicationCenter").then(({ CommunicationCenter: component }) => ({
    default: component,
  })),
);
const DonationsManager = lazy(() =>
  import("./DonationsManager").then(({ DonationsManager: component }) => ({ default: component })),
);
const EventsPage = lazy(() =>
  import("./EventsPage").then(({ EventsPage: component }) => ({ default: component })),
);
const LearningTrackPlayer = lazy(() =>
  import("./LearningTrackPlayer").then(({ LearningTrackPlayer: component }) => ({
    default: component,
  })),
);
const MemberProfileDirectory = lazy(() =>
  import("./MemberProfileDirectory").then(({ MemberProfileDirectory: component }) => ({
    default: component,
  })),
);
const MemberDuesPage = lazy(() =>
  import("./MemberDuesPage").then(({ MemberDuesPage: component }) => ({ default: component })),
);
const ModuleSettingsView = lazy(() =>
  import("./ModuleSettingsView").then(({ ModuleSettingsView: component }) => ({
    default: component,
  })),
);
const MusicCatalog = lazy(() =>
  import("./MusicCatalog").then(({ MusicCatalog: component }) => ({ default: component })),
);
const MySchedule = lazy(() =>
  import("./MySchedule").then(({ MySchedule: component }) => ({ default: component })),
);
const OrganizationAccess = lazy(() =>
  import("./OrganizationAccess").then(({ OrganizationAccess: component }) => ({
    default: component,
  })),
);
const OrganizationResources = lazy(() =>
  import("./OrganizationResources").then(({ OrganizationResources: component }) => ({
    default: component,
  })),
);
const OrganizationSettingsPage = lazy(() =>
  import("./OrganizationSettingsPage").then(({ OrganizationSettingsPage: component }) => ({
    default: component,
  })),
);
const PlatformAccess = lazy(() =>
  import("./PlatformAccess").then(({ PlatformAccess: component }) => ({ default: component })),
);
const PlatformSetupMonitor = lazy(() =>
  import("./PlatformSetupMonitor").then(({ PlatformSetupMonitor: component }) => ({
    default: component,
  })),
);
const PollsPage = lazy(() =>
  import("./PollsPage").then(({ PollsPage: component }) => ({ default: component })),
);
const PublicWebsiteManager = lazy(() =>
  import("./PublicWebsiteManager").then(({ PublicWebsiteManager: component }) => ({
    default: component,
  })),
);
const ReportsView = lazy(() =>
  import("./ReportsView").then(({ ReportsView: component }) => ({ default: component })),
);
const RosterPage = lazy(() =>
  import("./RosterPage").then(({ RosterPage: component }) => ({ default: component })),
);
const RsvpManagerPage = lazy(() =>
  import("./RsvpManagerPage").then(({ RsvpManagerPage: component }) => ({ default: component })),
);
const SeasonsManager = lazy(() =>
  import("./SeasonsManager").then(({ SeasonsManager: component }) => ({ default: component })),
);
const SeatingFinder = lazy(() =>
  import("./SeatingFinder").then(({ SeatingFinder: component }) => ({ default: component })),
);
const SeatingManager = lazy(() =>
  import("./SeatingManager").then(({ SeatingManager: component }) => ({ default: component })),
);
const SetListManager = lazy(() =>
  import("./SetListManager").then(({ SetListManager: component }) => ({ default: component })),
);
const SetupChecklistView = lazy(() =>
  import("./SetupChecklistView").then(({ SetupChecklistView: component }) => ({
    default: component,
  })),
);
const TicketingManager = lazy(() =>
  import("./TicketingManager").then(({ TicketingManager: component }) => ({ default: component })),
);
const VenuesPage = lazy(() =>
  import("./VenuesPage").then(({ VenuesPage: component }) => ({ default: component })),
);

function themeStorageKey(): string {
  return `${themeStoragePrefix}${window.location.hostname}`;
}

function readThemePreference(): ThemePreference {
  try {
    return window.localStorage.getItem(themeStorageKey()) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = preference;
}

function ThemeIcon({ preference }: { readonly preference: ThemePreference }) {
  return preference === "dark" ? (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  );
}

interface RouteState {
  readonly pathname: string;
  readonly search: string;
}
type RosterProfileTab = "dues" | "folders" | "info" | "performance";

function rosterProfileTabFromSearch(search: string): RosterProfileTab {
  const tab = new URLSearchParams(search).get("tab");
  return tab === "dues" || tab === "folders" || tab === "performance" ? tab : "info";
}
type AccessState =
  | { readonly status: "loading" }
  | { readonly status: "none" }
  | { readonly status: "error" }
  | {
      readonly context: OrganizationAuthStatusResponse;
      readonly modules: readonly ModuleState[];
      readonly organizationName: string | null;
      readonly status: "ready";
    };

interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly module?: "events" | "people" | "programs";
}

interface NavigationGroup {
  readonly items: readonly NavigationItem[];
  readonly label: string;
}

const accountGroups: readonly NavigationGroup[] = [
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

const memberGroups: readonly NavigationGroup[] = [
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
      { href: "/calendar", label: "Calendar subscription", module: "events" },
    ],
  },
];

const organizationGroups: readonly NavigationGroup[] = [
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

const platformGroups: readonly NavigationGroup[] = [
  {
    label: "Platform",
    items: [
      { href: "/platform", label: "Platform overview" },
      { href: "/platform/security", label: "Platform security" },
      { href: "/platform/organizations", label: "Organizations" },
    ],
  },
];

function readRoute(): RouteState {
  return {
    pathname: window.location.pathname.replace(/\/+$/, "") || "/",
    search: window.location.search,
  };
}

function useRoute(): [RouteState, (href: string) => void] {
  const [route, setRoute] = useState<RouteState>(readRoute);
  useEffect(() => {
    const onPopState = () => {
      setRoute(readRoute());
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
  function navigate(href: string) {
    const target = new URL(href, window.location.origin);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.href);
      return;
    }
    window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
    setRoute(readRoute());
    window.scrollTo({ behavior: "smooth", top: 0 });
  }
  return [route, navigate];
}

function AppLink({
  ariaCurrent,
  children,
  href,
  onNavigate,
}: {
  readonly ariaCurrent?: "page" | undefined;
  readonly children: ReactNode;
  readonly href: string;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <a
      href={href}
      aria-current={ariaCurrent}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
}

function workspaceForPath(pathname: string): Workspace {
  if (pathname.startsWith("/admin")) return "organization";
  if (pathname.startsWith("/platform")) return "platform";
  if (pathname.startsWith("/account")) return "account";
  return "member";
}

function workspaceLabel(workspace: Workspace): string {
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

function pageTitle(pathname: string): string {
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
    ["/calendar", "Calendar subscription"],
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

function routeHasModule(
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

function routeModule(pathname: string): NavigationItem["module"] {
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

function Navigation({
  groups,
  navigate,
  pathname,
}: {
  readonly groups: readonly NavigationGroup[];
  readonly navigate: (href: string) => void;
  readonly pathname: string;
}) {
  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      {groups.map((group) => (
        <div className="workspace-nav__group" key={group.label}>
          <p className="workspace-nav__label">{group.label}</p>
          <div className="workspace-nav__items">
            {group.items.map((item) => (
              <AppLink
                ariaCurrent={pathname === item.href ? "page" : undefined}
                href={item.href}
                key={item.href}
                onNavigate={navigate}
              >
                <span aria-hidden="true" className="workspace-nav__dot" />
                <span>{item.label}</span>
                {pathname === item.href ? <span className="sr-only"> (current)</span> : null}
              </AppLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function OverviewPage({
  context,
  displayName,
  modules,
  navigate,
  workspace,
}: {
  readonly context: OrganizationAuthStatusResponse | null;
  readonly displayName?: string;
  readonly modules?: readonly ModuleState[];
  readonly navigate: (href: string) => void;
  readonly workspace: Workspace;
}) {
  const platform = workspace === "platform";
  if (workspace === "organization") {
    return (
      <OrganizationAdminOverview
        context={context}
        displayName={displayName ?? "Admin"}
        modules={modules ?? []}
        navigate={navigate}
      />
    );
  }
  const cards = platform
    ? [
        {
          href: "/platform/organizations",
          label: "Organizations",
          text: "Provision, monitor, and manage scoped access.",
        },
        {
          href: "/platform/security",
          label: "Platform security",
          text: "Verify Platform Administrator MFA.",
        },
      ]
    : [
        {
          href: "/schedule",
          label: "My schedule",
          text: "See upcoming rehearsals and performances.",
        },
        {
          href: "/profile",
          label: "My Profile",
          text: "Keep your Organization Profile current.",
        },
        { href: "/practice", label: "Practice", text: "Open your approved learning tracks." },
        {
          href: "/member/resources",
          label: "Resources",
          text: "Find Organization documents and links.",
        },
      ];

  return (
    <>
      {!platform ? (
        <div className="workspace-hero">
          <p className="eyebrow">{workspaceLabel(workspace)}</p>
          <h1>Your choir at a glance</h1>
          <p>Everything you need for the next rehearsal, performance, and practice session.</p>
        </div>
      ) : null}
      {platform ? <PlatformSetupMonitor /> : null}
      <section className="overview-section" aria-labelledby="quick-actions-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Quick actions</p>
          <h2 id="quick-actions-title">Start with what matters</h2>
        </div>
        <div className="workspace-card-grid">
          {cards.map((card) => (
            <AppLink href={card.href} key={card.href} onNavigate={navigate}>
              <span className="workspace-card__icon" aria-hidden="true">
                →
              </span>
              <span>
                <strong>{card.label}</strong>
                <small>{card.text}</small>
              </span>
            </AppLink>
          ))}
        </div>
      </section>
      {context?.mfaRequired && !context.mfaVerifiedUntil ? (
        <p className="notice notice--warning">
          Organization MFA is required before operational data can be opened. Visit Organization
          security to verify access.
        </p>
      ) : null}
    </>
  );
}

function AccessDeniedPage({ workspace }: { readonly workspace: string }) {
  return (
    <section className="surface-card empty-page" aria-labelledby="access-denied-title">
      <p className="eyebrow">Restricted workspace</p>
      <h1 id="access-denied-title">You do not have access to this {workspace} workspace.</h1>
      <p>
        Choose a workspace from the switcher to continue with the permissions available to your
        account.
      </p>
    </section>
  );
}

function NotFoundPage({ navigate }: { readonly navigate: (href: string) => void }) {
  return (
    <section className="surface-card empty-page" aria-labelledby="not-found-title">
      <p className="eyebrow">Page not found</p>
      <h1 id="not-found-title">That workspace page does not exist.</h1>
      <button
        className="button button--primary"
        onClick={() => {
          navigate("/dashboard");
        }}
        type="button"
      >
        Return to dashboard
      </button>
    </section>
  );
}

function WorkspacePageLoading() {
  return (
    <p className="notice notice--info" role="status">
      Loading workspace page…
    </p>
  );
}

function renderAccountPage(
  pathname: string,
  session: NonNullable<CurrentAuthSession>,
  onSignedOut: () => void,
) {
  if (pathname === "/account/security") return <AccountSecurity />;
  if (pathname === "/account/organizations") {
    return (
      <AccountView currentSession={session} onSignedOut={onSignedOut} section="organizations" />
    );
  }
  if (pathname === "/account/sessions") {
    return <AccountView currentSession={session} onSignedOut={onSignedOut} section="sessions" />;
  }
  return <AccountView currentSession={session} onSignedOut={onSignedOut} section="overview" />;
}

function renderOrganizationPage(
  routeState: RouteState,
  enabled: boolean,
  manager: boolean,
  navigate: (href: string) => void,
) {
  const focusedEnabled = enabled && manager;
  const { pathname } = routeState;
  const rosterProfileId = new URLSearchParams(routeState.search).get("profileId");
  const route =
    pathname.startsWith("/admin/events/") && pathname.endsWith("/roster")
      ? "event-roster"
      : pathname;
  const pages: Record<string, ReactNode> = {
    "/admin/attendance": <AttendanceManager enabled={focusedEnabled} />,
    "/admin/auditions": <AuditionManager enabled={focusedEnabled} />,
    "/admin/communications": <CommunicationCenter enabled={focusedEnabled} />,
    "/admin/donations": <DonationsManager enabled={focusedEnabled} />,
    "/admin/patrons": <DonationsManager enabled={focusedEnabled} />,
    "/admin/library": <MusicCatalog enabled={focusedEnabled} />,
    "/admin/polls": <PollsPage enabled={focusedEnabled} />,
    "/admin/reports": <ReportsView />,
    "/admin/resources": <OrganizationResources enabled={enabled} manager={manager} />,
    "/admin/seasons": (
      <SeasonsManager
        enabled={focusedEnabled}
        onOpenProfile={(profileId) => {
          const search = new URLSearchParams({ profileId, tab: "dues" });
          navigate(`/admin/roster?${search.toString()}`);
        }}
      />
    ),
    "/admin/seating": <SeatingManager enabled={focusedEnabled} />,
    "/admin/setlists": <SetListManager enabled={focusedEnabled} />,
    "/admin/tickets": <TicketingManager enabled={focusedEnabled} />,
    "/admin/tickets/scan": <TicketingManager enabled={focusedEnabled} scanOnly />,
    "/admin/venues": <VenuesPage enabled={focusedEnabled} />,
    "/admin/website": <PublicWebsiteManager enabled={focusedEnabled} />,
    "/admin/events": <EventsPage enabled={focusedEnabled} />,
    "/admin/roster": (
      <RosterPage
        enabled={focusedEnabled}
        initialProfileId={rosterProfileId}
        initialProfileTab={rosterProfileTabFromSearch(routeState.search)}
      />
    ),
    "/admin/rsvp": <RsvpManagerPage enabled={focusedEnabled} />,
    "/admin/settings": <OrganizationSettingsPage enabled={focusedEnabled} />,
    "/admin/settings/invitations": <OrganizationInvitationsRoute />,
    "/admin/settings/modules": <ModuleSettingsView />,
    "/admin/settings/security": <OrganizationAccess section="security" />,
    "/admin/settings/setup-checklist": <SetupChecklistView />,
  };
  if (route === "event-roster") {
    return <RsvpManagerPage enabled={focusedEnabled} eventId={pathname.split("/")[3] ?? null} />;
  }
  if (pathname === "/admin") return null;
  return pages[pathname] ?? <NotFoundPage navigate={navigate} />;
}

function OrganizationInvitationsRoute() {
  return <OrganizationAccess section="invitations" />;
}

function readWorkspace(value: string): Workspace {
  if (value === "account" || value === "organization" || value === "platform") return value;
  return "member";
}

function workspaceHome(workspace: Workspace): string {
  const homes: Record<Workspace, string> = {
    account: "/account",
    member: "/dashboard",
    organization: "/admin",
    platform: "/platform",
  };
  return homes[workspace];
}

function availableWorkspaces(canManage: boolean, platformAvailable: boolean): readonly Workspace[] {
  return [
    "member",
    ...(canManage ? (["organization"] as const) : []),
    ...(platformAvailable ? (["platform"] as const) : []),
    "account",
  ];
}

function workspaceNavigation(
  workspace: Workspace,
  organizationGroups: readonly NavigationGroup[],
  memberGroups: readonly NavigationGroup[],
): readonly NavigationGroup[] {
  if (workspace === "account") return accountGroups;
  if (workspace === "platform") return platformGroups;
  return workspace === "organization" ? organizationGroups : memberGroups;
}

function organizationDisplayName(
  access: AccessState,
  session: NonNullable<CurrentAuthSession>,
): string {
  return access.status === "ready"
    ? (access.organizationName ?? "Your account")
    : session.user.name || session.user.email;
}

function sessionDisplayName(session: NonNullable<CurrentAuthSession>): string {
  const name = session.user.name.trim();
  return name || (session.user.email.split("@")[0] ?? "Admin");
}

function renderMemberPage(pathname: string, enabled: boolean): ReactNode {
  const pages: Record<string, ReactNode> = {
    "/calendar": <CalendarSubscription enabled={enabled} />,
    "/directory": <MemberProfileDirectory enabled={enabled} view="directory" />,
    "/member/resources": <OrganizationResources enabled={enabled} manager={false} />,
    "/practice": <LearningTrackPlayer enabled={enabled} />,
    "/profile": <MemberProfileDirectory enabled={enabled} view="profile" />,
    "/dues": <MemberDuesPage enabled={enabled} />,
    "/schedule": <MySchedule enabled={enabled} />,
  };
  if (pathname.startsWith("/seating/")) return <SeatingFinder enabled={enabled} />;
  return pages[pathname] ?? null;
}

function OrganizationWorkspacePage({
  access,
  displayName,
  navigate,
  route,
}: {
  readonly access: AccessState;
  readonly displayName: string;
  readonly navigate: (href: string) => void;
  readonly route: RouteState;
}) {
  if (access.status === "none") {
    return <AccessDeniedPage workspace="Organization Admin" />;
  }
  if (access.status === "ready" && access.context.role === "member") {
    return <AccessDeniedPage workspace="Organization Admin" />;
  }
  const enabled =
    access.status === "ready" &&
    (!access.context.mfaRequired || Boolean(access.context.mfaVerifiedUntil));
  const manager = access.status === "ready" && access.context.role !== "member";
  const requiredModule = routeModule(route.pathname);
  if (
    access.status === "ready" &&
    requiredModule !== undefined &&
    !routeHasModule({ module: requiredModule }, access.modules)
  ) {
    return <AccessDeniedPage workspace={`${requiredModule} module`} />;
  }
  const page = renderOrganizationPage(route, enabled, manager, navigate);
  return (
    page ?? (
      <OverviewPage
        context={access.status === "ready" ? access.context : null}
        displayName={displayName}
        modules={access.status === "ready" ? access.modules : []}
        navigate={navigate}
        workspace="organization"
      />
    )
  );
}

function PlatformWorkspacePage({
  navigate,
  platformAvailable,
  pathname,
}: {
  readonly navigate: (href: string) => void;
  readonly platformAvailable: boolean;
  readonly pathname: string;
}) {
  if (!platformAvailable) return <AccessDeniedPage workspace="Platform Admin" />;
  if (pathname === "/platform") {
    return <OverviewPage context={null} navigate={navigate} workspace="platform" />;
  }
  if (pathname === "/platform/organizations") {
    return <PlatformAccess view="organizations" />;
  }
  if (pathname === "/platform/access") {
    return <PlatformAccess view="access" />;
  }
  return <PlatformAccess view="security" />;
}

function WorkspacePage({
  access,
  currentSession,
  memberEnabled,
  navigate,
  onSignedOut,
  platformAvailable,
  route,
  workspace,
}: {
  readonly access: AccessState;
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly memberEnabled: boolean;
  readonly navigate: (href: string) => void;
  readonly onSignedOut: () => void;
  readonly platformAvailable: boolean;
  readonly route: RouteState;
  readonly workspace: Workspace;
}) {
  if (workspace === "account")
    return renderAccountPage(route.pathname, currentSession, onSignedOut);
  if (workspace === "platform") {
    return (
      <PlatformWorkspacePage
        navigate={navigate}
        platformAvailable={platformAvailable}
        pathname={route.pathname}
      />
    );
  }
  if (workspace === "organization") {
    return (
      <OrganizationWorkspacePage
        access={access}
        displayName={sessionDisplayName(currentSession)}
        navigate={navigate}
        route={route}
      />
    );
  }
  const requiredModule = routeModule(route.pathname);
  if (
    access.status === "ready" &&
    requiredModule !== undefined &&
    !routeHasModule({ module: requiredModule }, access.modules)
  ) {
    return <AccessDeniedPage workspace={`${requiredModule} module`} />;
  }
  return (
    renderMemberPage(route.pathname, memberEnabled) ?? (
      <OverviewPage
        context={access.status === "ready" ? access.context : null}
        navigate={navigate}
        workspace="member"
      />
    )
  );
}

export function AuthenticatedShell({
  currentSession,
  onSignedOut,
}: {
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly onSignedOut: () => void;
}) {
  const [route, navigate] = useRoute();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavTriggerRef = useRef<HTMLElement | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace>(() =>
    workspaceForPath(readRoute().pathname),
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [access, setAccess] = useState<AccessState>({ status: "loading" });
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [organizationPerformerLabel, setOrganizationPerformerLabel] = useState("Performer");

  useEffect(() => {
    applyTheme(themePreference);
    try {
      window.localStorage.setItem(themeStorageKey(), themePreference);
    } catch {
      // Private browsing and restricted storage should not prevent the theme from applying.
    }
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [themePreference]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getOrganizationAuthStatus(controller.signal).catch((error: unknown) => {
        if (error instanceof AuthApiError && (error.status === 403 || error.status === 404))
          return null;
        throw error;
      }),
      fetch("/api/modules/state", { credentials: "same-origin", signal: controller.signal }).then(
        async (response) => {
          if (!response.ok) return [] as readonly ModuleState[];
          const body: unknown = await response.json();
          return moduleStatesResponseSchema.safeParse(body).success
            ? moduleStatesResponseSchema.parse(body).modules
            : [];
        },
      ),
      fetch("/api/setup/status", { credentials: "same-origin", signal: controller.signal }).then(
        async (response) => {
          if (!response.ok) return null;
          const body: unknown = await response.json();
          const parsed = setupStatusSchema.safeParse(body);
          return parsed.success ? parsed.data.organizationName : null;
        },
      ),
      getPlatformMfaStatus(controller.signal)
        .then((status) => status.activePlatformAdministrator)
        .catch(() => false),
    ])
      .then(([context, modules, organizationName, hasPlatformAccess]) => {
        setPlatformAvailable(hasPlatformAccess);
        setAccess(
          context ? { context, modules, organizationName, status: "ready" } : { status: "none" },
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setAccess({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (access.status !== "ready") return;
    const controller = new AbortController();
    getOrganizationRosterConfiguration(controller.signal)
      .then((configuration) => {
        if (!controller.signal.aborted) setOrganizationPerformerLabel(configuration.performerLabel);
      })
      .catch(() => {
        // Account and Platform workspaces do not have an Organization roster to load.
      });
    return () => {
      controller.abort();
    };
  }, [access]);

  const workspace = workspaceForPath(route.pathname);

  const canManage = access.status === "ready" && access.context.role !== "member";
  const organizationEnabled =
    access.status === "ready" &&
    (!access.context.mfaRequired || Boolean(access.context.mfaVerifiedUntil));
  const memberEnabled = organizationEnabled;
  const modules = useMemo(() => (access.status === "ready" ? access.modules : []), [access]);
  const visibleOrganizationGroups = useMemo(
    () =>
      organizationGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => routeHasModule(item, modules)),
        }))
        .filter((group) => group.items.length > 0),
    [modules],
  );
  const visibleMemberGroups = useMemo(
    () =>
      memberGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => routeHasModule(item, modules)),
        }))
        .filter((group) => group.items.length > 0),
    [modules],
  );

  const workspaceOptions = availableWorkspaces(canManage, platformAvailable);

  function switchWorkspace(next: Workspace) {
    setSelectedWorkspace(next);
    window.localStorage.setItem(`choir-workspace:${window.location.hostname}`, next);
    navigate(workspaceHome(next));
    setMobileNavOpen(false);
  }

  const navGroups = workspaceNavigation(
    selectedWorkspace,
    visibleOrganizationGroups,
    visibleMemberGroups,
  );
  const selectedWorkspaceHome = workspaceHome(selectedWorkspace);
  const organizationName = organizationDisplayName(access, currentSession);

  return (
    <div className="signed-in-shell" data-theme={themePreference}>
      <a className="skip-link" href="#signed-in-main">
        Skip to main content
      </a>
      <header className="signed-in-header">
        <div className="signed-in-header__brand">
          <button
            className="mobile-nav-trigger"
            onClick={() => {
              setMobileNavOpen(true);
            }}
            ref={(element) => {
              mobileNavTriggerRef.current = element;
            }}
            type="button"
            aria-label="Open workspace navigation"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <AppLink href={selectedWorkspaceHome} onNavigate={navigate}>
            <span className="brand-mark" aria-hidden="true">
              CM
            </span>
            <span>Choir Management</span>
          </AppLink>
        </div>
        <div className="signed-in-header__actions">
          <label className="workspace-switcher">
            <span className="sr-only">Workspace</span>
            <select
              value={selectedWorkspace}
              onChange={(event) => {
                switchWorkspace(readWorkspace(event.target.value));
              }}
            >
              {workspaceOptions.map((item) => (
                <option key={item} value={item}>
                  {workspaceLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label={
              themePreference === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
            className="theme-switcher"
            title={themePreference === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            type="button"
            onClick={() => {
              setThemePreference((current) => (current === "dark" ? "light" : "dark"));
            }}
          >
            <ThemeIcon preference={themePreference} />
            <span className="sr-only">
              {themePreference === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            </span>
          </button>
          <button
            className="button button--secondary button--small"
            onClick={() => {
              void signOut().then(onSignedOut);
            }}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="signed-in-body">
        <aside className="signed-in-sidebar">
          <div className="sidebar-context">
            <span className="eyebrow">{workspaceLabel(selectedWorkspace)}</span>
            <strong>{organizationName}</strong>
          </div>
          <Navigation groups={navGroups} navigate={navigate} pathname={route.pathname} />
        </aside>
        <main
          className={
            route.pathname === "/admin"
              ? "signed-in-main signed-in-main--admin-overview"
              : "signed-in-main"
          }
          id="signed-in-main"
        >
          {route.pathname === "/admin" || route.pathname === "/admin/seating" ? null : (
            <div className="page-heading">
              <div>
                <p className="eyebrow">{workspaceLabel(workspace)}</p>
                <h1>{pageTitle(route.pathname)}</h1>
              </div>
              <span className="page-heading__location">
                {access.status === "ready" ? access.organizationName : "Signed in"}
              </span>
            </div>
          )}
          {access.status === "error" ? (
            <p className="notice notice--error" role="alert">
              Workspace access could not be loaded. Refresh and try again.
            </p>
          ) : null}
          <OrganizationTerminologyProvider
            onLabelChange={setOrganizationPerformerLabel}
            performerLabel={organizationPerformerLabel}
          >
            <Suspense fallback={<WorkspacePageLoading />}>
              <FloatingSaveBarProvider>
                <WorkspacePage
                  access={access}
                  currentSession={currentSession}
                  memberEnabled={memberEnabled}
                  navigate={navigate}
                  onSignedOut={onSignedOut}
                  platformAvailable={platformAvailable}
                  route={route}
                  workspace={workspace}
                />
              </FloatingSaveBarProvider>
            </Suspense>
          </OrganizationTerminologyProvider>
        </main>
      </div>
      <Sheet
        onClose={() => {
          setMobileNavOpen(false);
        }}
        open={mobileNavOpen}
        restoreFocusRef={mobileNavTriggerRef}
        title="Workspace navigation"
      >
        <div className="sheet__header">
          <span className="eyebrow">Workspace</span>
          <strong>{workspaceLabel(selectedWorkspace)}</strong>
        </div>
        <Navigation
          groups={navGroups}
          navigate={(href) => {
            navigate(href);
            setMobileNavOpen(false);
          }}
          pathname={route.pathname}
        />
      </Sheet>
    </div>
  );
}
