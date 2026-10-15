import type { CurrentAuthSession } from "@choir/contracts";
import type { ReactNode } from "react";
import type { ReportTab } from "../Reports/shared";
import type { TicketingTab } from "../Ticketing/shared";

import { AdminPatronsRedirect } from "./AdminPatronsRedirect";
import {
  AccountSecurity,
  AccountView,
  AttendanceManager,
  AuditionManager,
  CommunicationCenter,
  ContactsPage,
  DashboardView,
  DonationsManager,
  EventsPage,
  MemberDuesPage,
  MemberPollVoteView,
  MemberPracticeView,
  MemberProfileDirectory,
  ModuleSettingsView,
  MusicCatalog,
  MusicLibrarySettings,
  MySchedule,
  OrganizationAccess,
  OrganizationResources,
  OrganizationSettingsPage,
  PollsPage,
  PublicWebsiteManager,
  ReportsView,
  RosterPage,
  RsvpManagerPage,
  SeasonsManager,
  SeatingFinder,
  SeatingManager,
  SetListManager,
  SetupChecklistView,
  TicketingManager,
  VenuesPage,
} from "./lazyComponents";
import { accountGroups, platformGroups, rosterProfileTabFromSearch } from "./utils";
import type { AccessState, NavigationGroup, RouteState, Workspace } from "./types";
import { parseCreditFilterFromSearch } from "../MusicCatalog/utils";

export function renderAccountPage(
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

const ALLOWED_RETURN_PREFIXES = [
  "/admin/tickets",
  "/admin/ticketing",
  "/admin/setlists",
  "/admin/seating",
] as const;

export function sanitizeEventsReturnTo(returnTo: string | null | undefined): string | null {
  if (!returnTo) return null;
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\")) {
    return null;
  }
  const isAllowed = ALLOWED_RETURN_PREFIXES.some(
    (prefix) =>
      returnTo === prefix || returnTo.startsWith(`${prefix}?`) || returnTo.startsWith(`${prefix}/`),
  );
  return isAllowed ? returnTo : null;
}

export function safeAdminReturnPath(search: string): string | null {
  const params = new URLSearchParams(search);
  const rawReturnTo = params.get("returnTo");
  if (rawReturnTo) {
    if (
      !rawReturnTo.startsWith("/") ||
      rawReturnTo.startsWith("//") ||
      rawReturnTo.includes("\\") ||
      rawReturnTo.toLowerCase().includes("%5c")
    ) {
      return null;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(rawReturnTo)) {
      return null;
    }
    try {
      const parsed = new URL(rawReturnTo, "https://local.test");
      if (parsed.origin !== "https://local.test") return null;
      if (parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/")) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (params.get("from") === "admin") {
    return "/admin/roster";
  }
  return null;
}

const TICKETING_TABS: readonly TicketingTab[] = [
  "willcall",
  "bundles",
  "orders",
  "share",
  "confirmation",
  "discounts",
];

export function ticketingTabFromSearch(search: string): TicketingTab | null {
  const tabParam = new URLSearchParams(search).get("tab")?.trim();
  return TICKETING_TABS.find((tab) => tab === tabParam) ?? null;
}

function ticketingManagerPage(
  alias: "tickets" | "ticketing",
  focusedEnabled: boolean,
  initialEventId: string | null,
  initialTab: TicketingTab | null,
  navigate: (href: string) => void,
): ReactNode {
  return (
    <TicketingManager
      enabled={focusedEnabled}
      initialEventId={initialEventId}
      initialTab={initialTab ?? undefined}
      key={`${alias}:${initialEventId ?? "all"}:${initialTab ?? "default"}`}
      navigate={navigate}
    />
  );
}

export function eventsPagePropsFromSearch(search: string) {
  const routeParams = new URLSearchParams(search);
  const eventsAction = routeParams.get("action");
  const eventsTypeParam = routeParams.get("type");
  const rawEventId = routeParams.get("eventId")?.trim();
  const eventIdParam = rawEventId && rawEventId.length > 0 ? rawEventId : null;
  const sectionParam = routeParams.get("section")?.trim() ?? null;
  const initialType: "Performance" | "Rehearsal" | null =
    eventsTypeParam === "Performance" || eventsTypeParam === "Rehearsal" ? eventsTypeParam : null;
  const initialSection: "tickets" | null = sectionParam === "tickets" ? "tickets" : null;
  return {
    initialAction:
      eventsAction === "create" || routeParams.get("create") === "true"
        ? ("create" as const)
        : null,
    initialEventId: eventIdParam,
    initialSection,
    initialType,
    returnTo: sanitizeEventsReturnTo(routeParams.get("returnTo")),
  };
}

const VALID_REPORT_TABS: ReadonlySet<string> = new Set<ReportTab>([
  "attendance",
  "rsvp",
  "repertoire",
  "roster",
  "donations-tickets",
  "music-folders",
]);

function isReportTab(value: string): value is ReportTab {
  return VALID_REPORT_TABS.has(value);
}

function reportTabFromSearch(search: string): ReportTab {
  const tab = new URLSearchParams(search).get("tab") ?? "";
  return isReportTab(tab) ? tab : "attendance";
}

function rosterSectionFromSearch(search: string): "settings" | "automation" | "roster" {
  const section = new URLSearchParams(search).get("section");
  return section === "settings" || section === "automation" ? section : "roster";
}

function renderMusicPage({
  focusedEnabled,
  musicCatalogView,
  musicPieceId,
  navigate,
  pathname,
  returnToSetList,
  search,
}: {
  readonly focusedEnabled: boolean;
  readonly musicCatalogView: "catalog" | "credits";
  readonly musicPieceId: string | null;
  readonly navigate: (href: string) => void;
  readonly pathname: string;
  readonly returnToSetList: boolean;
  readonly search: string;
}): ReactNode {
  if (pathname.endsWith("/settings") || new URLSearchParams(search).get("tab") === "settings") {
    return <MusicLibrarySettings enabled={focusedEnabled} navigate={navigate} />;
  }
  const creditFilter = parseCreditFilterFromSearch(search);
  const handleClearCreditFilter = () => {
    const params = new URLSearchParams(search);
    params.delete("credit");
    params.delete("creditRole");
    const nextQuery = params.toString();
    const basePath = pathname.startsWith("/admin/music") ? "/admin/music" : "/admin/library";
    navigate(nextQuery ? `${basePath}?${nextQuery}` : basePath);
  };
  return (
    <MusicCatalog
      creditFilter={creditFilter}
      enabled={focusedEnabled}
      initialPieceId={musicPieceId}
      navigate={navigate}
      onClearCreditFilter={handleClearCreditFilter}
      returnTo={returnToSetList ? "/admin/setlists" : null}
      view={musicCatalogView}
    />
  );
}

function resolveOrganizationRouteKey(pathname: string): string {
  if (pathname.startsWith("/admin/events/") && pathname.endsWith("/roster")) {
    return "event-roster";
  }
  return pathname;
}

export function renderOrganizationPage(
  routeState: RouteState,
  enabled: boolean,
  manager: boolean,
  navigate: (href: string, options?: { readonly replace?: boolean }) => void,
  notFoundPage: (navigate: (href: string) => void) => ReactNode,
  canEditProfiles = true,
  canReviewRsvps = false,
  canManageSetLists = true,
) {
  const focusedEnabled = enabled && manager;
  const { pathname } = routeState;
  const routeParams = new URLSearchParams(routeState.search);
  const rosterProfileId = routeParams.get("profileId");
  const rosterSection = rosterSectionFromSearch(routeState.search);
  const returnToSetList = routeParams.get("returnTo") === "/admin/setlists";
  const musicPieceId = routeParams.get("pieceId");
  const musicCatalogView = routeParams.get("view") === "credits" ? "credits" : "catalog";
  const rsvpEventId = routeParams.get("eventId");
  const ticketingTab = ticketingTabFromSearch(routeState.search);
  const eventsProps = eventsPagePropsFromSearch(routeState.search);
  const reportTab = reportTabFromSearch(routeState.search);
  const route = resolveOrganizationRouteKey(pathname);
  const pages: Record<string, ReactNode> = {
    "/admin/attendance": <AttendanceManager enabled={focusedEnabled} />,
    "/admin/auditions": <AuditionManager enabled={focusedEnabled} />,
    "/admin/communications": <CommunicationCenter enabled={focusedEnabled} />,
    "/admin/contacts": <ContactsPage enabled={focusedEnabled} />,
    "/admin/donations": <DonationsManager enabled={focusedEnabled} />,
    "/admin/patrons": <AdminPatronsRedirect navigate={navigate} search={routeState.search} />,
    "/admin/library": renderMusicPage({
      focusedEnabled,
      musicCatalogView,
      musicPieceId,
      navigate,
      pathname,
      returnToSetList,
      search: routeState.search,
    }),
    "/admin/library/settings": (
      <MusicLibrarySettings enabled={focusedEnabled} navigate={navigate} />
    ),
    "/admin/music": renderMusicPage({
      focusedEnabled,
      musicCatalogView,
      musicPieceId,
      navigate,
      pathname,
      returnToSetList,
      search: routeState.search,
    }),
    "/admin/music/settings": <MusicLibrarySettings enabled={focusedEnabled} navigate={navigate} />,
    "/admin/music/folders": <ReportsView enabled={focusedEnabled} initialTab="music-folders" />,
    "/admin/polls": <PollsPage enabled={focusedEnabled} />,
    "/admin/communications/polls": <PollsPage enabled={focusedEnabled} />,
    "/admin/reports": <ReportsView enabled={focusedEnabled} initialTab={reportTab} />,
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
    "/admin/seating": (
      <SeatingManager
        enabled={focusedEnabled}
        navigate={navigate}
        canReviewRsvps={canReviewRsvps}
      />
    ),
    "/admin/setlists": (
      <SetListManager enabled={focusedEnabled} initialEventId={rsvpEventId} navigate={navigate} />
    ),
    "/admin/tickets": ticketingManagerPage(
      "tickets",
      focusedEnabled,
      rsvpEventId,
      ticketingTab,
      navigate,
    ),
    "/admin/ticketing": ticketingManagerPage(
      "ticketing",
      focusedEnabled,
      rsvpEventId,
      ticketingTab,
      navigate,
    ),
    "/admin/tickets/scan": (
      <TicketingManager enabled={focusedEnabled} navigate={navigate} scanOnly />
    ),
    "/admin/venues": <VenuesPage enabled={focusedEnabled} />,
    "/admin/website": <PublicWebsiteManager enabled={focusedEnabled} />,
    "/admin/events": (
      <EventsPage
        canManageSetLists={canManageSetLists}
        enabled={focusedEnabled}
        initialAction={eventsProps.initialAction}
        initialEventId={eventsProps.initialEventId}
        initialSection={eventsProps.initialSection}
        initialType={eventsProps.initialType}
        key={`events:${eventsProps.initialAction ?? "list"}:${eventsProps.initialEventId ?? "none"}:${eventsProps.initialType ?? "default"}:${eventsProps.initialSection ?? "default"}`}
        navigate={navigate}
        returnTo={eventsProps.returnTo}
      />
    ),
    "/admin/roster": (
      <RosterPage
        enabled={focusedEnabled}
        initialSection={rosterSection}
        initialProfileId={rosterProfileId}
        initialProfileTab={rosterProfileTabFromSearch(routeState.search)}
      />
    ),
    "/admin/rsvp": (
      <RsvpManagerPage
        canEditProfiles={canEditProfiles}
        enabled={focusedEnabled}
        eventId={rsvpEventId}
      />
    ),
    "/admin/settings": <OrganizationSettingsPage enabled={focusedEnabled} />,
    "/admin/invitations": <OrganizationAccess section="invitations" />,
    "/admin/settings/invitations": <OrganizationAccess section="invitations" />,
    "/admin/settings/modules": <ModuleSettingsView />,
    "/admin/settings/security": <OrganizationAccess section="security" />,
    "/admin/settings/setup-checklist": <SetupChecklistView />,
  };
  if (route === "event-roster") {
    return (
      <RsvpManagerPage
        canEditProfiles={canEditProfiles}
        enabled={focusedEnabled}
        eventId={pathname.split("/")[3] ?? null}
      />
    );
  }
  if (pathname === "/admin") return null;
  return pages[pathname] ?? notFoundPage(navigate);
}

export function readWorkspace(value: string): Workspace {
  if (value === "account" || value === "organization" || value === "platform") return value;
  return "member";
}

export function workspaceHome(workspace: Workspace): string {
  const homes: Record<Workspace, string> = {
    account: "/account",
    member: "/dashboard",
    organization: "/admin",
    platform: "/platform",
  };
  return homes[workspace];
}

export function availableWorkspaces(
  canManage: boolean,
  platformAvailable: boolean,
): readonly Workspace[] {
  return [
    "member",
    ...(canManage ? (["organization"] as const) : []),
    ...(platformAvailable ? (["platform"] as const) : []),
    "account",
  ];
}

export function workspaceNavigation(
  workspace: Workspace,
  organizationGroups: readonly NavigationGroup[],
  memberGroups: readonly NavigationGroup[],
): readonly NavigationGroup[] {
  if (workspace === "account") return accountGroups;
  if (workspace === "platform") return platformGroups;
  return workspace === "organization" ? organizationGroups : memberGroups;
}

export function organizationDisplayName(
  access: AccessState,
  session: NonNullable<CurrentAuthSession>,
): string {
  return access.status === "ready"
    ? (access.organizationName ?? "Your account")
    : session.user.name || session.user.email;
}

export function sessionDisplayName(session: NonNullable<CurrentAuthSession>): string {
  const name = session.user.name.trim();
  return name || (session.user.email.split("@")[0] ?? "Admin");
}

export function renderMemberPage(
  pathname: string,
  enabled: boolean,
  navigate: (href: string) => void,
  accessStatus: AccessState["status"],
  mfaRequired = false,
  adminReturnTo?: string | null,
  search?: string,
): ReactNode {
  const pages: Record<string, ReactNode> = {
    "/directory": (
      <MemberProfileDirectory
        adminReturnTo={adminReturnTo}
        enabled={enabled}
        navigate={navigate}
        view="directory"
      />
    ),
    "/member/resources": <OrganizationResources enabled={enabled} manager={false} />,
    "/practice": <MemberPracticeView enabled={enabled} />,
    "/profile": <MemberProfileDirectory enabled={enabled} view="profile" />,
    "/dues": (
      <MemberDuesPage accessStatus={accessStatus} enabled={enabled} mfaRequired={mfaRequired} />
    ),
    "/schedule": (
      <MySchedule
        accessStatus={accessStatus}
        enabled={enabled}
        mfaRequired={mfaRequired}
        navigate={navigate}
      />
    ),
    // Keep the former deep link working while the subscription controls live on My schedule.
    "/calendar": (
      <MySchedule
        accessStatus={accessStatus}
        enabled={enabled}
        mfaRequired={mfaRequired}
        navigate={navigate}
      />
    ),
  };
  if (pathname === "/dashboard") {
    return <DashboardView accessStatus={accessStatus} enabled={enabled} navigate={navigate} />;
  }
  if (pathname.startsWith("/seating/")) return <SeatingFinder enabled={enabled} />;
  if (pathname.startsWith("/member/polls/")) {
    const pollId = pathname.slice("/member/polls/".length).split("/")[0] ?? "";
    return (
      <MemberPollVoteView
        enabled={enabled}
        navigate={navigate}
        pollId={pollId}
        search={search ?? ""}
      />
    );
  }
  return pages[pathname] ?? null;
}
