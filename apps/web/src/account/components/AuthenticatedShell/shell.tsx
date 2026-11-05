import { MobileMemberNavigation } from "./MobileMemberNavigation";
import { OrganizationAdminNavigation } from "../../organizationFeatures/OrganizationAdminNavigation";
import { MobileOrganizationAdminNavigation } from "../../organizationFeatures/MobileOrganizationAdminNavigation";
import { organizationModuleContext } from "../../organizationFeatures/moduleStateContext";
import type { CurrentAuthSession, PlatformMfaStatusResponse } from "@choir/contracts";
import { Sheet } from "@choir/ui";
import { Suspense, useState } from "react";
import { signOut } from "../../../auth/api";
import type { PostSignInBootstrap } from "../../../auth/postSignIn";
import { requestGlobalLeave, SaveBar, SaveCoordinatorProvider } from "../../../persistence";
import { OrganizationTerminologyProvider } from "../../organizationTerminology";
import { pageDescription, pageTitle, readRoute, workspaceForPath, workspaceLabel } from "./utils";
import { useRoute } from "./hooks";
import { AppLink, Navigation, SidebarWorkspaceHeading, ThemeIcon } from "./navigation";
import type { Workspace } from "./types";
import { WorkspacePageLoading, WorkspacePage } from "./workspaces";
import { CommandPaletteModal, QuickSearchTrigger } from "../CommandPalette";
import { NotificationBell } from "../NotificationInbox/NotificationBell";
import { readWorkspace } from "./workspacesUtils";
import { useOrganizationShellBootstrap } from "./useOrganizationShellBootstrap";
import { useShellNavigationChrome } from "./useShellNavigationChrome";

function moduleStatusMessage(status: "loading" | "ready" | "error"): string {
  switch (status) {
    case "loading":
      return "Loading Organization modules…";
    case "error":
      return "Organization modules could not be loaded. Module-dependent shortcuts are unavailable.";
    case "ready":
      return "Organization modules could not be refreshed. Confirmed changes remain active.";
  }
}

// eslint-disable-next-line complexity -- the shell coordinates pinned and modal navigation states.
function AuthenticatedOrganizationShell({
  baseHostname,
  baseHostnameResolved,
  currentSession,
  initialPlatformMfaStatus,
  initialLogoFileId,
  initialOrganizationName,
  onSignedOut,
  shellBootstrap,
}: {
  readonly baseHostname: string | null;
  readonly baseHostnameResolved: boolean;
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly initialPlatformMfaStatus: PlatformMfaStatusResponse | null;
  readonly initialLogoFileId: string | null;
  readonly initialOrganizationName: string | null;
  readonly onSignedOut: () => void;
  readonly shellBootstrap: PostSignInBootstrap | null;
}) {
  const [route, navigate] = useRoute();
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace>(() =>
    workspaceForPath(readRoute().pathname),
  );

  const {
    access,
    activeOrgName,
    branding,
    canAccessPalette,
    canManage,
    effectiveAccess,
    featureContext,
    handleExitImpersonation,
    identity,
    impersonation,
    isOrganization,
    memberEnabled,
    moduleController,
    modules,
    organizationName,
    organizationPerformerLabel,
    platformAvailable,
    platformMfaStatus,
    platformStatus,
    refreshPlatformStatus,
    rosterStructure,
    setOrganizationPerformerLabel,
    setRosterStructure,
    visibleMemberGroups,
    visibleOrganizationGroups,
    workspaceOptions,
  } = useOrganizationShellBootstrap({
    baseHostname,
    baseHostnameResolved,
    currentSession,
    initialLogoFileId,
    initialOrganizationName,
    initialPlatformMfaStatus,
    navigate,
    routePathname: route.pathname,
    selectedWorkspace,
    shellBootstrap,
  });

  const {
    closePalette,
    commandPaletteOpen,
    drawerScrollRef,
    handleDrawerNavigate,
    handleExpandAdminGroup,
    handleExpandMemberGroup,
    handleNavScroll,
    handleRailClick,
    handleToggleNavigation,
    handleVoidNavigate,
    isCollapsibleWorkspace,
    isCompact,
    isNarrowViewport,
    memberNavigation,
    mobileNavOpen,
    mobileNavTriggerRef,
    navGroups,
    navOpenerRef,
    openPaletteFromDrawer,
    openPaletteFromHeader,
    openPaletteFromSidebar,
    organizationNavigation,
    selectedWorkspaceHome,
    setMobileNavOpen,
    setThemePreference,
    sidebarCollapseRef,
    sidebarScrollRef,
    switchWorkspace,
    themePreference,
  } = useShellNavigationChrome({
    access,
    activeOrgName,
    canAccessPalette,
    navigate,
    route,
    selectedWorkspace,
    setSelectedWorkspace,
    visibleMemberGroups,
    visibleOrganizationGroups,
  });

  const workspace = workspaceForPath(route.pathname);

  return (
    <SaveCoordinatorProvider>
      <div
        className="signed-in-shell"
        data-attendance-view={route.pathname === "/admin/attendance" ? "true" : undefined}
        data-sidebar-pinned="true"
        data-theme={themePreference}
        data-workspace={selectedWorkspace}
        data-navigation-mode={
          isCollapsibleWorkspace ? (isCompact ? "compact" : "expanded") : "expanded"
        }
        data-organization-navigation={
          selectedWorkspace === "organization"
            ? organizationNavigation.compact
              ? "compact"
              : "expanded"
            : undefined
        }
      >
        <a className="skip-link" href="#signed-in-main">
          Skip to main content
        </a>
        <header className="signed-in-header">
          <div className="signed-in-header__brand">
            <button
              className="mobile-nav-trigger"
              onClick={() => {
                navOpenerRef.current = mobileNavTriggerRef.current;
                setMobileNavOpen(true);
              }}
              ref={(element) => {
                mobileNavTriggerRef.current = element;
              }}
              type="button"
              aria-label="Open workspace navigation"
              aria-expanded={mobileNavOpen}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <AppLink href={selectedWorkspaceHome} onNavigate={handleVoidNavigate}>
              {branding?.logoFileId ? (
                <img
                  src={`/api/organization/files/${encodeURIComponent(branding.logoFileId)}`}
                  alt=""
                  className="brand-logo"
                />
              ) : (
                <span className="brand-mark" aria-hidden="true">
                  {branding?.organizationName
                    ? branding.organizationName
                        .split(/\s+/)
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()
                    : "CM"}
                </span>
              )}
              <span>
                {branding?.organizationName ??
                  (access.status === "ready" || access.status === "platform-scoped"
                    ? access.organizationName
                    : null) ??
                  "Choir Management"}
              </span>
            </AppLink>
          </div>
          <div className="signed-in-header__actions">
            {canAccessPalette ? (
              <QuickSearchTrigger
                className="header-quick-search-trigger"
                onClick={openPaletteFromHeader}
                variant="header"
              />
            ) : null}
            {access.status === "ready" && selectedWorkspace !== "platform" ? (
              <NotificationBell
                onNavigate={(href) => {
                  void navigate(href);
                }}
                organizationId={access.context.organizationId}
                userId={currentSession.user.id}
                userRole={access.context.role}
              />
            ) : null}
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
                void requestGlobalLeave({
                  action: async () => {
                    await signOut();
                    onSignedOut();
                  },
                  reason: "sign-out",
                });
              }}
              type="button"
            >
              Sign out
            </button>
          </div>
        </header>
        {isOrganization && impersonation?.active ? (
          <aside aria-label="Impersonation status" className="impersonation-banner" role="status">
            <div className="impersonation-banner__info">
              <span aria-hidden="true" className="impersonation-banner__icon">
                👁️
              </span>
              <span>
                Viewing as <strong>{impersonation.impersonatedProfile?.displayName}</strong>
                {impersonation.impersonatedProfile?.voicePart
                  ? ` (${impersonation.impersonatedProfile.voicePart})`
                  : ""}
              </span>
            </div>
            <button
              className="button button--secondary button--small impersonation-banner__exit-btn"
              onClick={() => {
                void handleExitImpersonation();
              }}
              type="button"
            >
              Exit Impersonation
            </button>
          </aside>
        ) : null}
        {isOrganization &&
        access.status === "ready" &&
        (access.context.role === "owner" || access.context.role === "administrator") &&
        !access.context.profileLinked ? (
          <aside
            aria-label="Unlinked administrator warning"
            className="notice notice--warning"
            role="alert"
          >
            <strong>Your administrator account does not have a linked Profile.</strong> You will not
            receive administrative email alerts or notification inbox notices until your account is
            linked. <a href="/admin/members">Go to Members to link your Profile</a>.
          </aside>
        ) : null}
        <div className="signed-in-body">
          <aside className="signed-in-sidebar" onClick={isCompact ? handleRailClick : undefined}>
            <div className="sidebar-header">
              {selectedWorkspace !== "organization" && !isCompact ? (
                <SidebarWorkspaceHeading workspaceName={workspaceLabel(selectedWorkspace)} />
              ) : null}
              {isCollapsibleWorkspace ? (
                <div className="sidebar-toolbar" role="group" aria-label="Navigation controls">
                  <button
                    aria-label={isCompact ? "Expand navigation" : "Collapse navigation"}
                    className="sidebar-toolbar__button"
                    onClick={handleToggleNavigation}
                    ref={sidebarCollapseRef}
                    title={isCompact ? "Expand navigation" : "Collapse navigation"}
                    type="button"
                  >
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                      <rect width="18" height="18" x="3" y="3" rx="2.5" />
                      <path d="M9 3v18" />
                      {isCompact ? (
                        <path d="m5 9.5 2.5 2.5-2.5 2.5" />
                      ) : (
                        <path d="m7 9.5-2.5 2.5 2.5 2.5" />
                      )}
                    </svg>
                    <span className="sr-only">
                      {isCompact ? "Expand navigation" : "Collapse navigation"}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <div
              className="sidebar-nav-scroll"
              onScroll={handleNavScroll(selectedWorkspace)}
              ref={sidebarScrollRef}
            >
              {selectedWorkspace === "organization" ? (
                <OrganizationAdminNavigation
                  groups={navGroups}
                  path={`${route.pathname}${route.search}`}
                  compact={isCompact}
                  expanded={organizationNavigation.expanded}
                  toggleGroup={organizationNavigation.toggleGroup}
                  onExpandGroup={handleExpandAdminGroup}
                  navigate={navigate}
                  onSearch={openPaletteFromSidebar}
                />
              ) : (
                <Navigation
                  memberStyle={selectedWorkspace === "member"}
                  groups={navGroups}
                  navigate={handleVoidNavigate}
                  pathname={route.pathname}
                  compact={isCompact}
                  expandedGroups={memberNavigation.expanded}
                  toggleGroup={memberNavigation.toggleGroup}
                  onExpandGroup={handleExpandMemberGroup}
                />
              )}
            </div>
          </aside>
          <main
            className={[
              "signed-in-main",
              route.pathname === "/admin" ? "signed-in-main--admin-overview" : "",
              route.pathname === "/admin/attendance" ? "signed-in-main--attendance" : "",
              route.pathname.startsWith("/admin/communications")
                ? "signed-in-main--communications"
                : "",
              route.pathname.startsWith("/admin/seating") ? "signed-in-main--seating" : "",
              route.pathname === "/admin/website" ? "signed-in-main--website" : "",
              workspace === "platform" ? "signed-in-main--platform" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            id="signed-in-main"
          >
            {route.pathname === "/admin" ||
            route.pathname === "/admin/seating" ||
            route.pathname === "/admin/venues" ||
            route.pathname === "/admin/roster" ||
            route.pathname === "/admin/auditions" ||
            route.pathname === "/admin/invitations" ||
            route.pathname === "/admin/settings/invitations" ? null : (
              <div
                className={`page-heading${selectedWorkspace === "organization" && ["/admin/tickets", "/admin/ticketing"].includes(route.pathname) ? " page-heading--ticketing" : ""}`}
              >
                <div>
                  <h1>{pageTitle(route.pathname)}</h1>
                  {pageDescription(route.pathname, route.search) ? (
                    <p className="page-heading__description">
                      {pageDescription(route.pathname, route.search)}
                    </p>
                  ) : null}
                </div>
                {selectedWorkspace === "organization" &&
                ["/admin/tickets", "/admin/ticketing"].includes(route.pathname) ? (
                  <AppLink
                    className="button button--primary"
                    href="/admin/tickets/scan"
                    onNavigate={handleVoidNavigate}
                  >
                    Scan tickets
                  </AppLink>
                ) : null}
              </div>
            )}
            {access.status === "error" ? (
              <p className="notice notice--error" role="alert">
                Workspace access could not be loaded. Refresh and try again.
              </p>
            ) : null}
            {selectedWorkspace === "organization" &&
            (moduleController.warning || moduleController.snapshot.status === "error") ? (
              <p className="notice notice--info" role="status">
                {moduleStatusMessage(moduleController.snapshot.status)}
                <button
                  type="button"
                  onClick={() => {
                    void moduleController.refresh();
                  }}
                >
                  Retry
                </button>
              </p>
            ) : null}
            <organizationModuleContext.Provider value={moduleController}>
              <OrganizationTerminologyProvider
                onLabelChange={setOrganizationPerformerLabel}
                onStructureChange={setRosterStructure}
                rosterStructure={rosterStructure}
                organizationName={organizationName}
                performerLabel={organizationPerformerLabel}
              >
                <Suspense fallback={<WorkspacePageLoading />}>
                  <WorkspacePage
                    access={effectiveAccess}
                    currentSession={currentSession}
                    memberEnabled={memberEnabled}
                    navigate={handleVoidNavigate}
                    onOpenCommandPalette={openPaletteFromHeader}
                    onSignedOut={onSignedOut}
                    platformAvailable={platformAvailable}
                    platformMfaStatus={platformMfaStatus}
                    platformStatus={platformStatus}
                    refreshPlatformStatus={refreshPlatformStatus}
                    route={route}
                    workspace={workspace}
                  />
                </Suspense>
                <SaveBar />
              </OrganizationTerminologyProvider>
            </organizationModuleContext.Provider>
          </main>
        </div>
        {selectedWorkspace === "organization" ? (
          <MobileOrganizationAdminNavigation
            groups={navGroups}
            path={`${route.pathname}${route.search}`}
            navigate={navigate}
            onSearch={openPaletteFromSidebar}
          />
        ) : null}
        {selectedWorkspace === "member" && isNarrowViewport ? (
          <MobileMemberNavigation
            key={identity}
            groups={visibleMemberGroups}
            path={`${route.pathname}${route.search}`}
            navigate={navigate}
          />
        ) : null}
        <Sheet
          onClose={() => {
            setMobileNavOpen(false);
          }}
          open={mobileNavOpen}
          restoreFocusRef={navOpenerRef}
          title="Workspace navigation"
        >
          <div className="sheet__header sidebar-drawer__header">
            {selectedWorkspace === "organization" ? (
              <h2 className="organization-nav__drawer-title">Organization Admin</h2>
            ) : (
              <SidebarWorkspaceHeading workspaceName={workspaceLabel(selectedWorkspace)} />
            )}
          </div>
          <div
            className="sidebar-nav-scroll"
            onScroll={handleNavScroll(selectedWorkspace)}
            ref={drawerScrollRef}
          >
            {selectedWorkspace === "organization" ? (
              <OrganizationAdminNavigation
                groups={navGroups}
                path={`${route.pathname}${route.search}`}
                compact={false}
                expanded={organizationNavigation.expanded}
                toggleGroup={organizationNavigation.toggleGroup}
                navigate={async (href) => {
                  const allowed = await navigate(href);
                  if (allowed) setMobileNavOpen(false);
                  return allowed;
                }}
                onSearch={openPaletteFromDrawer}
              />
            ) : (
              <Navigation
                memberStyle={selectedWorkspace === "member"}
                groups={navGroups}
                navigate={handleDrawerNavigate}
                pathname={route.pathname}
                compact={false}
                expandedGroups={memberNavigation.expanded}
                toggleGroup={memberNavigation.toggleGroup}
              />
            )}
          </div>
        </Sheet>
        {canAccessPalette ? (
          <CommandPaletteModal
            isOwner={
              access.status === "ready" && (access.context.role === "owner" || platformAvailable)
            }
            organizationContext={featureContext}
            modules={modules.filter((m) => m.enabled).map((m) => m.id)}
            onClose={closePalette}
            onNavigate={(path) => {
              closePalette();
              const targetWorkspace = workspaceForPath(path);
              if (
                targetWorkspace !== selectedWorkspace &&
                (targetWorkspace !== "organization" || canManage) &&
                (targetWorkspace !== "platform" || platformAvailable)
              ) {
                setSelectedWorkspace(targetWorkspace);
                try {
                  window.localStorage.setItem(
                    `choir-workspace:${window.location.hostname}`,
                    targetWorkspace,
                  );
                } catch {
                  // Restricted storage
                }
              }
              void navigate(path);
            }}
            onToggleTheme={() => {
              setThemePreference((current) => (current === "dark" ? "light" : "dark"));
            }}
            open={commandPaletteOpen}
            selectedWorkspace={selectedWorkspace}
          />
        ) : null}
      </div>
    </SaveCoordinatorProvider>
  );
}

export function AuthenticatedShell(props: {
  readonly baseHostname: string | null;
  readonly baseHostnameResolved: boolean;
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly initialPlatformMfaStatus: PlatformMfaStatusResponse | null;
  readonly initialLogoFileId: string | null;
  readonly initialOrganizationName: string | null;
  readonly onSignedOut: () => void;
  readonly shellBootstrap: PostSignInBootstrap | null;
}) {
  return (
    <AuthenticatedOrganizationShell
      key={`${window.location.hostname}:${props.currentSession.user.id}`}
      {...props}
    />
  );
}
