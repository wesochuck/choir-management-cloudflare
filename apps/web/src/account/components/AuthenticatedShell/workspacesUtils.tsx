import type { CurrentAuthSession } from "@choir/contracts";
import type { ReactNode } from "react";

import {
  AccountSecurity,
  AccountView,
  AttendanceManager,
  AuditionManager,
  CommunicationCenter,
  DashboardView,
  DonationsManager,
  EventsPage,
  LearningTrackPlayer,
  MemberDuesPage,
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

export function renderOrganizationPage(
  routeState: RouteState,
  enabled: boolean,
  manager: boolean,
  navigate: (href: string) => void,
  notFoundPage: (navigate: (href: string) => void) => ReactNode,
) {
  const focusedEnabled = enabled && manager;
  const { pathname } = routeState;
  const routeParams = new URLSearchParams(routeState.search);
  const rosterProfileId = routeParams.get("profileId");
  const requestedRosterSection = routeParams.get("section");
  const returnToSetList = routeParams.get("returnTo") === "/admin/setlists";
  const rosterSection =
    requestedRosterSection === "settings" || requestedRosterSection === "automation"
      ? requestedRosterSection
      : "roster";
  const musicPieceId = routeParams.get("pieceId");
  const rsvpEventId = routeParams.get("eventId");
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
    "/admin/library": (
      <MusicCatalog
        enabled={focusedEnabled}
        initialPieceId={musicPieceId}
        navigate={navigate}
        returnTo={returnToSetList ? "/admin/setlists" : null}
      />
    ),
    "/admin/library/settings": (
      <MusicLibrarySettings enabled={focusedEnabled} navigate={navigate} />
    ),
    "/admin/polls": <PollsPage enabled={focusedEnabled} />,
    "/admin/reports": <ReportsView enabled={focusedEnabled} />,
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
        initialSection={rosterSection}
        initialProfileId={rosterProfileId}
        initialProfileTab={rosterProfileTabFromSearch(routeState.search)}
      />
    ),
    "/admin/rsvp": <RsvpManagerPage enabled={focusedEnabled} eventId={rsvpEventId} />,
    "/admin/settings": <OrganizationSettingsPage enabled={focusedEnabled} />,
    "/admin/settings/invitations": <OrganizationAccess section="invitations" />,
    "/admin/settings/modules": <ModuleSettingsView />,
    "/admin/settings/security": <OrganizationAccess section="security" />,
    "/admin/settings/setup-checklist": <SetupChecklistView />,
  };
  if (route === "event-roster") {
    return <RsvpManagerPage enabled={focusedEnabled} eventId={pathname.split("/")[3] ?? null} />;
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
): ReactNode {
  const pages: Record<string, ReactNode> = {
    "/directory": <MemberProfileDirectory enabled={enabled} view="directory" />,
    "/member/resources": <OrganizationResources enabled={enabled} manager={false} />,
    "/practice": <LearningTrackPlayer enabled={enabled} />,
    "/profile": <MemberProfileDirectory enabled={enabled} view="profile" />,
    "/dues": <MemberDuesPage enabled={enabled} />,
    "/schedule": <MySchedule enabled={enabled} />,
    // Keep the former deep link working while the subscription controls live on My schedule.
    "/calendar": <MySchedule enabled={enabled} />,
  };
  if (pathname === "/dashboard") {
    return <DashboardView accessStatus={accessStatus} enabled={enabled} navigate={navigate} />;
  }
  if (pathname.startsWith("/seating/")) return <SeatingFinder enabled={enabled} />;
  return pages[pathname] ?? null;
}
