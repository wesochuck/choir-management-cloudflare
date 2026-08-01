import {
  moduleStatesResponseSchema,
  setupStatusSchema,
  type CurrentAuthSession,
  type ModuleState,
} from "@choir/contracts";
import { Sheet } from "@choir/ui";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AuthApiError,
  getOrganizationAuthStatus,
  getOrganizationRosterConfiguration,
  getPlatformMfaStatus,
  signOut,
} from "../../../auth/api";
import { FloatingSaveBarProvider } from "../../FloatingSaveBar";
import { OrganizationTerminologyProvider } from "../../organizationTerminology";

import {
  applyTheme,
  memberGroups,
  organizationGroups,
  pageTitle,
  readRoute,
  readThemePreference,
  routeHasModule,
  themeStorageKey,
  workspaceForPath,
  workspaceLabel,
} from "./utils";
import { useRoute } from "./hooks";
import { AppLink, Navigation, ThemeIcon } from "./navigation";

import type { AccessState, ThemePreference, Workspace } from "./types";

import { WorkspacePageLoading, WorkspacePage } from "./workspaces";
import {
  availableWorkspaces,
  organizationDisplayName,
  readWorkspace,
  workspaceHome,
  workspaceNavigation,
} from "./workspacesUtils";

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
      fetch("/api/organization/module-state", {
        credentials: "same-origin",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) return [] as readonly ModuleState[];
        const body: unknown = await response.json();
        return moduleStatesResponseSchema.safeParse(body).success
          ? moduleStatesResponseSchema.parse(body).modules
          : [];
      }),
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
