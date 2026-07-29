import {
  moduleStatesResponseSchema,
  setupStatusSchema,
  type CurrentAuthSession,
  type ModuleState,
  type OrganizationAuthStatusResponse,
  type OrganizationDashboardSummaryResponse,
} from "@choir/contracts";
import { Sheet } from "@choir/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AuthApiError,
  getOrganizationDashboardSummary,
  getOrganizationAuthStatus,
  getPlatformMfaStatus,
  signOut,
} from "../auth/api";
import { AccountSecurity } from "./AccountSecurity";
import { AccountView } from "./AccountView";
import { AttendanceManager } from "./AttendanceManager";
import { AuditionManager } from "./AuditionManager";
import { CalendarSubscription } from "./CalendarSubscription";
import { CommunicationCenter } from "./CommunicationCenter";
import { DonationsManager } from "./DonationsManager";
import { EventsPage } from "./EventsPage";
import { FloatingSaveBarProvider } from "./FloatingSaveBar";
import { LearningTrackPlayer } from "./LearningTrackPlayer";
import { MemberProfileDirectory } from "./MemberProfileDirectory";
import { ModuleSettingsView } from "./ModuleSettingsView";
import { MusicCatalog } from "./MusicCatalog";
import { MySchedule } from "./MySchedule";
import { OrganizationAccess } from "./OrganizationAccess";
import { OrganizationResources } from "./OrganizationResources";
import { OrganizationSettingsPage } from "./OrganizationSettingsPage";
import { PlatformAccess } from "./PlatformAccess";
import { PlatformSetupMonitor } from "./PlatformSetupMonitor";
import { PollsPage } from "./PollsPage";
import { PublicWebsiteManager } from "./PublicWebsiteManager";
import { ReportsView } from "./ReportsView";
import { RosterPage } from "./RosterPage";
import { RsvpManagerPage } from "./RsvpManagerPage";
import { SeasonsManager } from "./SeasonsManager";
import { SeatingFinder } from "./SeatingFinder";
import { SeatingManager } from "./SeatingManager";
import { SetListManager } from "./SetListManager";
import { SetupChecklistView } from "./SetupChecklistView";
import { TicketingManager } from "./TicketingManager";
import { VenuesPage } from "./VenuesPage";

type Workspace = "account" | "member" | "organization" | "platform";
type ThemePreference = "dark" | "light";

const themeStoragePrefix = "choir-theme:";

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

interface RouteState {
  readonly pathname: string;
  readonly search: string;
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
      { href: "/platform/access", label: "Organization access" },
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
    ["/platform/access", "Organization access"],
    ["/platform", "Platform overview"],
    ["/profile", "My Profile"],
    ["/directory", "Directory"],
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
  navigate,
  workspace,
}: {
  readonly context: OrganizationAuthStatusResponse | null;
  readonly navigate: (href: string) => void;
  readonly workspace: Workspace;
}) {
  const admin = workspace === "organization";
  const platform = workspace === "platform";
  const cards = admin
    ? [
        {
          href: "/admin/roster",
          label: "Manage roster",
          text: "Add Profiles and keep membership details current.",
        },
        {
          href: "/admin/events",
          label: "Plan events",
          text: "Schedule rehearsals and performances.",
        },
        {
          href: "/admin/communications",
          label: "Send a message",
          text: "Reach the right people with a clear announcement.",
        },
        {
          href: "/admin/reports",
          label: "View reports",
          text: "Review attendance and Organization activity.",
        },
      ]
    : platform
      ? [
          {
            href: "/platform/organizations",
            label: "Organizations",
            text: "Provision and monitor Organizations.",
          },
          {
            href: "/platform/access",
            label: "Scoped access",
            text: "Review temporary Organization access.",
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
      {!admin ? (
        <div className="workspace-hero">
          <p className="eyebrow">{workspaceLabel(workspace)}</p>
          <h1>{platform ? "Platform operations" : "Your choir at a glance"}</h1>
          <p>
            {platform
              ? "Keep Organization operations safe, scoped, and auditable."
              : "Everything you need for the next rehearsal, performance, and practice session."}
          </p>
        </div>
      ) : null}
      {admin ? <OrganizationOverviewSummary navigate={navigate} /> : null}
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

function OrganizationOverviewSummary({ navigate }: { readonly navigate: (href: string) => void }) {
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | { readonly status: "error" }
    | { readonly data: OrganizationDashboardSummaryResponse; readonly status: "ready" }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getOrganizationDashboardSummary(controller.signal)
      .then((data) => {
        setState({ data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (state.status === "loading") return <p className="notice">Loading Organization summary…</p>;
  if (state.status === "error") {
    return (
      <p className="notice notice--warning" role="status">
        Organization summary is temporarily unavailable. The focused management pages are still
        available.
      </p>
    );
  }
  return (
    <section className="overview-section" aria-labelledby="organization-summary-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Organization at a glance</p>
        <h2 id="organization-summary-title">Keep the next move visible</h2>
      </div>
      <div className="summary-grid">
        <div className="summary-card">
          <span className="summary-card__label">Active Profiles</span>
          <strong>{state.data.activeProfileCount}</strong>
          <small>
            <AppLink href="/admin/roster" onNavigate={navigate}>
              Open roster
            </AppLink>
          </small>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Upcoming events</span>
          <strong>{state.data.upcomingEventCount}</strong>
          <small>
            <AppLink href="/admin/events" onNavigate={navigate}>
              View events
            </AppLink>
          </small>
        </div>
      </div>
      <div className="summary-events">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Next on the calendar</p>
          <h3>Upcoming events</h3>
        </div>
        {state.data.nextEvents.length === 0 ? (
          <p className="empty-state">No upcoming events yet. Create the first event from Events.</p>
        ) : (
          <ul className="summary-events__list">
            {state.data.nextEvents.map((event) => (
              <li key={event.id}>
                <span>
                  <strong>{event.title}</strong>
                  <small>{event.type}</small>
                </span>
                <time dateTime={event.startsAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.startsAt))}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
  pathname: string,
  enabled: boolean,
  manager: boolean,
  navigate: (href: string) => void,
) {
  const focusedEnabled = enabled && manager;
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
    "/admin/seasons": <SeasonsManager enabled={focusedEnabled} />,
    "/admin/seating": <SeatingManager enabled={focusedEnabled} />,
    "/admin/setlists": <SetListManager enabled={focusedEnabled} />,
    "/admin/tickets": <TicketingManager enabled={focusedEnabled} />,
    "/admin/tickets/scan": <TicketingManager enabled={focusedEnabled} scanOnly />,
    "/admin/venues": <VenuesPage enabled={focusedEnabled} />,
    "/admin/website": <PublicWebsiteManager enabled={focusedEnabled} />,
    "/admin/events": <EventsPage enabled={focusedEnabled} />,
    "/admin/roster": <RosterPage enabled={focusedEnabled} />,
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

function renderMemberPage(pathname: string, enabled: boolean): ReactNode {
  const pages: Record<string, ReactNode> = {
    "/calendar": <CalendarSubscription enabled={enabled} />,
    "/directory": <MemberProfileDirectory enabled={enabled} view="directory" />,
    "/member/resources": <OrganizationResources enabled={enabled} manager={false} />,
    "/practice": <LearningTrackPlayer enabled={enabled} />,
    "/profile": <MemberProfileDirectory enabled={enabled} view="profile" />,
    "/schedule": <MySchedule enabled={enabled} />,
  };
  if (pathname.startsWith("/seating/")) return <SeatingFinder enabled={enabled} />;
  return pages[pathname] ?? null;
}

function OrganizationWorkspacePage({
  access,
  navigate,
  route,
}: {
  readonly access: AccessState;
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
  const page = renderOrganizationPage(route.pathname, enabled, manager, navigate);
  return (
    page ?? (
      <OverviewPage
        context={access.status === "ready" ? access.context : null}
        navigate={navigate}
        workspace="organization"
      />
    )
  );
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
    if (!platformAvailable) return <AccessDeniedPage workspace="Platform Admin" />;
    return route.pathname === "/platform" ? (
      <OverviewPage context={null} navigate={navigate} workspace="platform" />
    ) : (
      <PlatformAccess />
    );
  }
  if (workspace === "organization") {
    return <OrganizationWorkspacePage access={access} navigate={navigate} route={route} />;
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
          <label className="theme-switcher">
            <span className="sr-only">Color theme</span>
            <select
              aria-label="Color theme"
              value={themePreference}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "light" || next === "dark") setThemePreference(next);
              }}
            >
              <option value="dark">Dark theme</option>
              <option value="light">Light theme</option>
            </select>
          </label>
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
        <main className="signed-in-main" id="signed-in-main">
          {route.pathname === "/admin/seating" ? null : (
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
