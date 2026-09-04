import type {
  CurrentAuthSession,
  ModuleState,
  OrganizationImpersonationStatusResponse,
} from "@choir/contracts";
import { Sheet } from "@choir/ui";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AuthApiError,
  getHealth,
  getOrganizationAuthStatus,
  getOrganizationBranding,
  getOrganizationImpersonationStatus,
  getOrganizationModuleState,
  getOrganizationRosterConfiguration,
  getPlatformMfaStatus,
  getSetupStatus,
  stopOrganizationImpersonation,
} from "../../../api";
import { signOut } from "../../../auth/api";
import { requestGlobalLeave, SaveBar, SaveCoordinatorProvider } from "../../../persistence";
import { OrganizationTerminologyProvider } from "../../organizationTerminology";

import {
  applyTheme,
  memberGroups,
  organizationGroups,
  pageDescription,
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
import { CommandPaletteModal, QuickSearchTrigger } from "../CommandPalette";
import {
  availableWorkspaces,
  organizationDisplayName,
  readWorkspace,
  workspaceHome,
  workspaceNavigation,
} from "./workspacesUtils";

function sidebarPinnedStorageKey(): string {
  return `choir-sidebar-pinned:${window.location.hostname}`;
}

function readSidebarPinned(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(sidebarPinnedStorageKey()) !== "false";
  } catch {
    return true;
  }
}

// eslint-disable-next-line complexity -- the shell coordinates pinned and modal navigation states.
export function AuthenticatedShell({
  currentSession,
  onSignedOut,
}: {
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly onSignedOut: () => void;
}) {
  const [route, navigate] = useRoute();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(readSidebarPinned);
  const mobileNavTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarCollapseRef = useRef<HTMLButtonElement | null>(null);
  const focusPinnedSidebarRef = useRef(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace>(() =>
    workspaceForPath(readRoute().pathname),
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [access, setAccess] = useState<AccessState>({ status: "loading" });
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [baseHostname, setBaseHostname] = useState<string | null>(null);
  const [organizationPerformerLabel, setOrganizationPerformerLabel] = useState("Performer");
  const [branding, setBranding] = useState<{
    readonly logoFileId: string | null;
    readonly organizationName: string;
  } | null>(null);
  const [impersonation, setImpersonation] =
    useState<OrganizationImpersonationStatusResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getOrganizationImpersonationStatus(controller.signal)
      .then((status) => {
        setImpersonation(status.active ? status : null);
      })
      .catch(() => {
        setImpersonation(null);
      });
    return () => {
      controller.abort();
    };
  }, [route.pathname]);

  const handleExitImpersonation = async () => {
    try {
      await stopOrganizationImpersonation();
    } finally {
      setImpersonation(null);
      navigate("/admin/roster");
    }
  };

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
    try {
      window.localStorage.setItem(sidebarPinnedStorageKey(), String(sidebarPinned));
    } catch {
      // Restricted storage should not prevent the navigation drawer from working.
    }
  }, [sidebarPinned]);

  useEffect(() => {
    if (mobileNavOpen || !focusPinnedSidebarRef.current) return;
    focusPinnedSidebarRef.current = false;
    window.requestAnimationFrame(() => {
      sidebarCollapseRef.current?.focus();
    });
  }, [mobileNavOpen]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getOrganizationAuthStatus(controller.signal).catch((error: unknown) => {
        if (error instanceof AuthApiError && (error.status === 403 || error.status === 404))
          return null;
        throw error;
      }),
      getOrganizationModuleState(controller.signal).catch(() => [] as readonly ModuleState[]),
      getSetupStatus(controller.signal)
        .then((setup) => setup.organizationName)
        .catch(() => null),
      getPlatformMfaStatus(controller.signal)
        .then((status) => status.activePlatformAdministrator)
        .catch(() => false),
      getHealth(controller.signal)
        .then((health) => health.baseHostname ?? null)
        .catch(() => null),
    ])
      .then(([context, modules, organizationName, hasPlatformAccess, baseHostname]) => {
        setBaseHostname(baseHostname);
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

  // Platform administration is served from the product base hostname, except
  // for scoped Organization access. That page must remain on the validated
  // Organization hostname so the server can bind the elevation to exactly one
  // tenant before any edit capability is granted.
  useEffect(() => {
    if (
      selectedWorkspace !== "platform" ||
      route.pathname === "/platform/access" ||
      baseHostname === null
    )
      return;
    if (window.location.hostname !== baseHostname) {
      window.location.replace(`https://${baseHostname}/platform`);
    }
  }, [baseHostname, route.pathname, selectedWorkspace]);

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
    getOrganizationBranding(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setBranding(data);
      })
      .catch(() => {
        // Branding is optional / unavailable on Account or Platform workspaces.
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

  useEffect(() => {
    if (!canManage && !platformAvailable) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canManage, platformAvailable]);

  function switchWorkspace(next: Workspace) {
    void requestGlobalLeave({
      action: () => {
        setSelectedWorkspace(next);
        try {
          window.localStorage.setItem(`choir-workspace:${window.location.hostname}`, next);
        } catch {
          // Restricted storage should not prevent switching workspaces.
        }
        navigate(workspaceHome(next));
        setMobileNavOpen(false);
      },
      reason: "workspace-switch",
    });
  }

  function collapseWorkspaceNavigation() {
    setSidebarPinned(false);
    setMobileNavOpen(false);
  }

  function unpinWorkspaceNavigation() {
    setSidebarPinned(false);
    setMobileNavOpen(true);
  }

  function pinWorkspaceNavigation() {
    focusPinnedSidebarRef.current = true;
    setSidebarPinned(true);
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
    <SaveCoordinatorProvider>
      <div
        className="signed-in-shell"
        data-sidebar-pinned={sidebarPinned ? "true" : "false"}
        data-theme={themePreference}
      >
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
              aria-expanded={mobileNavOpen}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <AppLink href={selectedWorkspaceHome} onNavigate={navigate}>
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
                  (access.status === "ready" ? access.organizationName : null) ??
                  "Choir Management"}
              </span>
            </AppLink>
          </div>
          <div className="signed-in-header__actions">
            {canManage || platformAvailable ? (
              <QuickSearchTrigger
                className="header-quick-search-trigger"
                onClick={() => {
                  setCommandPaletteOpen(true);
                }}
                variant="header"
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
        {impersonation?.active ? (
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
        <div className="signed-in-body">
          {sidebarPinned ? (
            <aside className="signed-in-sidebar">
              <div className="sidebar-toolbar" role="group" aria-label="Navigation controls">
                <button
                  aria-label="Collapse workspace navigation"
                  className="sidebar-toolbar__button"
                  onClick={collapseWorkspaceNavigation}
                  ref={sidebarCollapseRef}
                  title="Collapse workspace navigation"
                  type="button"
                >
                  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                    <path d="m14 6-6 6 6 6" />
                  </svg>
                  <span className="sr-only">Collapse workspace navigation</span>
                </button>
                <button
                  aria-label="Unpin workspace navigation"
                  aria-pressed={sidebarPinned}
                  className="sidebar-toolbar__button sidebar-toolbar__button--pin"
                  onClick={unpinWorkspaceNavigation}
                  title="Unpin workspace navigation"
                  type="button"
                >
                  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                    <path d="M8 4h8v5l3 3H5l3-3V4M12 12v8" />
                  </svg>
                  <span className="sr-only">Unpin workspace navigation</span>
                </button>
              </div>
              <div className="sidebar-context">
                <span className="sidebar-context__label">{workspaceLabel(selectedWorkspace)}</span>
                <strong>{organizationName}</strong>
              </div>
              {selectedWorkspace === "organization" ? (
                <QuickSearchTrigger
                  onClick={() => {
                    setCommandPaletteOpen(true);
                  }}
                  variant="sidebar"
                />
              ) : null}
              <Navigation groups={navGroups} navigate={navigate} pathname={route.pathname} />
            </aside>
          ) : null}
          <main
            className={[
              "signed-in-main",
              route.pathname === "/admin" ? "signed-in-main--admin-overview" : "",
              route.pathname === "/admin/attendance" ? "signed-in-main--attendance" : "",
              route.pathname.startsWith("/admin/communications")
                ? "signed-in-main--communications"
                : "",
              workspace === "platform" ? "signed-in-main--platform" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            id="signed-in-main"
          >
            {route.pathname === "/admin" || route.pathname === "/admin/seating" ? null : (
              <div className="page-heading">
                <div>
                  <h1>{pageTitle(route.pathname)}</h1>
                  {pageDescription(route.pathname, route.search) ? (
                    <p className="page-heading__description">
                      {pageDescription(route.pathname, route.search)}
                    </p>
                  ) : null}
                </div>
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
                <WorkspacePage
                  access={access}
                  currentSession={currentSession}
                  memberEnabled={memberEnabled}
                  navigate={navigate}
                  onOpenCommandPalette={() => {
                    setCommandPaletteOpen(true);
                  }}
                  onSignedOut={onSignedOut}
                  platformAvailable={platformAvailable}
                  route={route}
                  workspace={workspace}
                />
              </Suspense>
              <SaveBar />
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
          <div className="sheet__header sidebar-drawer__header">
            <div className="sidebar-drawer__context">
              <span className="sidebar-drawer__label">Workspace</span>
              <strong>{workspaceLabel(selectedWorkspace)}</strong>
            </div>
            {!sidebarPinned ? (
              <button
                aria-label="Pin navigation open"
                aria-pressed="false"
                className="sidebar-drawer__pin"
                onClick={pinWorkspaceNavigation}
                title="Pin navigation open"
                type="button"
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                  <path d="M8 4h8v5l3 3H5l3-3V4M12 12v8" />
                </svg>
                <span className="sr-only">Pin navigation open</span>
              </button>
            ) : null}
          </div>
          {selectedWorkspace === "organization" ? (
            <QuickSearchTrigger
              onClick={() => {
                setMobileNavOpen(false);
                setCommandPaletteOpen(true);
              }}
              variant="sidebar"
            />
          ) : null}
          <Navigation
            groups={navGroups}
            navigate={(href) => {
              navigate(href);
              setMobileNavOpen(false);
            }}
            pathname={route.pathname}
          />
        </Sheet>
        {canManage || platformAvailable ? (
          <CommandPaletteModal
            isOwner={
              access.status === "ready" && (access.context.role === "owner" || platformAvailable)
            }
            modules={modules.filter((m) => m.enabled).map((m) => m.id)}
            onClose={() => {
              setCommandPaletteOpen(false);
            }}
            onNavigate={(path) => {
              setCommandPaletteOpen(false);
              navigate(path);
            }}
            onToggleTheme={() => {
              setThemePreference((current) => (current === "dark" ? "light" : "dark"));
            }}
            open={commandPaletteOpen}
          />
        ) : null}
      </div>
    </SaveCoordinatorProvider>
  );
}
