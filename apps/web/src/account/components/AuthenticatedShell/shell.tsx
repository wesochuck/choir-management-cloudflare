import { OrganizationAdminNavigation } from "../../organizationFeatures/OrganizationAdminNavigation";
import {
  useOrganizationNavigationPreferences,
  useWorkspaceNavigationPreferences,
} from "../../organizationFeatures/navigationPreferences";
import type { OrganizationGroupId } from "../../organizationFeatures/types";
import { useOrganizationModuleState } from "../../organizationFeatures/useOrganizationModuleState";
import { organizationModuleContext } from "../../organizationFeatures/moduleStateContext";
import { getOrganizationSidebarGroups } from "../../organizationFeatures/selectors";
import { normalizeOrganizationTerminology } from "../../organizationTerminologyUtils";
import type { CurrentAuthSession, OrganizationImpersonationStatusResponse } from "@choir/contracts";
import { Sheet } from "@choir/ui";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, UIEvent } from "react";
import {
  AuthApiError,
  getHealth,
  getOrganizationAuthStatus,
  getOrganizationBranding,
  getOrganizationImpersonationStatus,
  getOrganizationRosterConfiguration,
  getPlatformMfaStatus,
  getPlatformOrganizationContext,
  getSetupStatus,
  stopOrganizationImpersonation,
} from "../../../api";
import { signOut } from "../../../auth/api";
import { purgeCachedPlayerMetadata, purgeOfflineAudioForSource } from "../../../offline/mediaStore";
import { requestGlobalLeave, SaveBar, SaveCoordinatorProvider } from "../../../persistence";
import { OrganizationTerminologyProvider } from "../../organizationTerminology";

import {
  applyTheme,
  memberGroups,
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
import { AppLink, Navigation, SidebarWorkspaceHeading, ThemeIcon } from "./navigation";
import {
  NARROW_SIDEBAR_QUERY,
  NavScrollStore,
  isElementVisible,
  readNarrowViewport,
  revealActiveIfOutside,
  shouldCloseDrawerAfterNavigate,
  shouldCloseStaleDrawer,
} from "./sidebarTransitions";

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

function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

// eslint-disable-next-line complexity -- the shell coordinates pinned and modal navigation states.
function AuthenticatedOrganizationShell({
  currentSession,
  onSignedOut,
}: {
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly onSignedOut: () => void;
}) {
  const [route, navigate] = useRoute();
  const organizationNavigation = useOrganizationNavigationPreferences(
    window.location.hostname,
    `${route.pathname}${route.search}`,
    "organization",
  );
  const memberNavigation = useWorkspaceNavigationPreferences(
    window.location.hostname,
    `${route.pathname}${route.search}`,
    "member",
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(readNarrowViewport);
  const mobileNavTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarCollapseRef = useRef<HTMLButtonElement | null>(null);
  const navOpenerRef = useRef<HTMLElement | null>(null);
  const focusPinnedSidebarRef = useRef(false);
  const paletteOpenerRef = useRef<HTMLElement | null>(null);
  const paletteWasOpenRef = useRef(false);
  const [navScrollStore] = useState(() => new NavScrollStore());
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const drawerScrollRef = useRef<HTMLDivElement | null>(null);
  const previousNarrowRef = useRef(isNarrowViewport);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace>(() =>
    workspaceForPath(readRoute().pathname),
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const moduleController = useOrganizationModuleState(
    `${window.location.hostname}:${currentSession.user.id}`,
  );
  const [access, setAccess] = useState<AccessState>({ status: "loading" });
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [baseHostname, setBaseHostname] = useState<string | null>(null);
  const [organizationPerformerLabel, setOrganizationPerformerLabel] = useState("Performer");
  const [rosterStructure, setRosterStructure] = useState<"sections_only" | "sections_with_parts">(
    "sections_with_parts",
  );
  const [branding, setBranding] = useState<{
    readonly logoFileId: string | null;
    readonly organizationName: string;
  } | null>(null);
  const [impersonation, setImpersonation] =
    useState<OrganizationImpersonationStatusResponse | null>(null);

  const isCollapsibleWorkspace =
    selectedWorkspace === "organization" || selectedWorkspace === "member";
  const currentNavPrefs =
    selectedWorkspace === "organization" ? organizationNavigation : memberNavigation;
  const isCompact = isCollapsibleWorkspace && (currentNavPrefs.compact || isNarrowViewport);

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
      void navigate("/admin/roster");
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
    if (mobileNavOpen || !focusPinnedSidebarRef.current) return;
    focusPinnedSidebarRef.current = false;
    window.requestAnimationFrame(() => {
      sidebarCollapseRef.current?.focus();
    });
  }, [mobileNavOpen]);

  // Track the narrow breakpoint without ever overwriting
  // the saved desktop preference. Viewport changes only affect drawer
  // visibility and focus placement.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(NARROW_SIDEBAR_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setIsNarrowViewport(event.matches);
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => {
        media.removeEventListener("change", onChange);
      };
    }
    return () => undefined;
  }, []);

  // Widening past 64rem with a stale drawer over a restored
  // pinned layout closes the modal layer. Focus moves only when its element
  // is no longer visible; ordinary layout changes never steal focus.
  useEffect(() => {
    const wasNarrow = previousNarrowRef.current;
    previousNarrowRef.current = isNarrowViewport;
    if (wasNarrow === isNarrowViewport) return;
    if (wasNarrow && !isNarrowViewport) {
      if (
        shouldCloseStaleDrawer({
          isNarrow: isNarrowViewport,
          mobileOpen: mobileNavOpen,
          wasNarrow,
        })
      ) {
        focusPinnedSidebarRef.current = true;
        setMobileNavOpen(false);
        return;
      }
      const focused = document.activeElement;
      const active = focused instanceof HTMLElement ? focused : null;
      if (active && !isElementVisible(active)) {
        window.requestAnimationFrame(() => {
          if (isElementVisible(sidebarCollapseRef.current)) {
            sidebarCollapseRef.current?.focus();
          } else if (isElementVisible(mobileNavTriggerRef.current)) {
            mobileNavTriggerRef.current?.focus();
          }
        });
      }
      return;
    }
    const focused = document.activeElement;
    const active = focused instanceof HTMLElement ? focused : null;
    if (active && sidebarScrollRef.current?.contains(active)) {
      window.requestAnimationFrame(() => {
        mobileNavTriggerRef.current?.focus();
      });
      return;
    }
    if (active && !isElementVisible(active)) {
      window.requestAnimationFrame(() => {
        if (isElementVisible(mobileNavTriggerRef.current)) {
          mobileNavTriggerRef.current?.focus();
        }
      });
    }
  }, [isNarrowViewport, mobileNavOpen]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getOrganizationAuthStatus(controller.signal).catch((error: unknown) => {
        if (error instanceof AuthApiError && (error.status === 403 || error.status === 404))
          return null;
        throw error;
      }),
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
      .then(async ([context, organizationName, hasPlatformAccess, baseHostname]) => {
        if (isSignalAborted(controller.signal)) return;
        const platformContext = hasPlatformAccess
          ? await getPlatformOrganizationContext(controller.signal).catch(() => null)
          : null;
        if (isSignalAborted(controller.signal)) return;
        setBaseHostname(baseHostname);
        setPlatformAvailable(hasPlatformAccess);
        if (!context) {
          // Not an Organization member on this host: a verified Platform
          // Administrator may still have scoped access to this Organization.
          if (platformContext) {
            setAccess({
              modules: [],
              organizationName,
              platformContext,
              status: "platform-scoped",
            });
            return;
          }
          setAccess({ status: "none" });
          void Promise.allSettled([
            purgeOfflineAudioForSource(window.location.host, "session"),
            purgeCachedPlayerMetadata(window.location.host),
          ]).catch(() => {
            // Best-effort: access state must resolve even if cache cleanup fails.
          });
          return;
        }
        setAccess({
          context,
          modules: [],
          organizationName,
          ...(platformContext ? { platformContext } : {}),
          status: "ready",
        });
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
        if (!controller.signal.aborted) {
          setOrganizationPerformerLabel(configuration.performerLabel);
          setRosterStructure(configuration.rosterStructure ?? "sections_with_parts");
        }
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

  const scopedPlatformOverview =
    access.status === "platform-scoped" ||
    (access.status === "ready" &&
      access.context.role === "member" &&
      Boolean(access.platformContext));
  const canManage =
    (access.status === "ready" && access.context.role !== "member") || scopedPlatformOverview;
  const organizationEnabled =
    access.status === "ready" &&
    (!access.context.mfaRequired ||
      access.context.mfaSatisfied ||
      Boolean(access.context.mfaVerifiedUntil));
  const memberEnabled = organizationEnabled;
  const modules = moduleController.snapshot.modules;
  const terminology = useMemo(
    () => normalizeOrganizationTerminology(organizationPerformerLabel, rosterStructure),
    [organizationPerformerLabel, rosterStructure],
  );
  const featureContext = useMemo(
    () => ({
      ...terminology,
      modules,
      status: moduleController.snapshot.status,
      scopedReadOnly: scopedPlatformOverview,
    }),
    [terminology, modules, moduleController.snapshot.status, scopedPlatformOverview],
  );
  const visibleOrganizationGroups = useMemo(
    () => getOrganizationSidebarGroups(featureContext),
    [featureContext],
  );
  const effectiveAccess = useMemo(
    () =>
      access.status === "ready" || access.status === "platform-scoped"
        ? { ...access, modules }
        : access,
    [access, modules],
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
  const canAccessPalette =
    selectedWorkspace !== "member" &&
    (access.status === "ready" || access.status === "platform-scoped");

  useEffect(() => {
    if (!canAccessPalette) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!commandPaletteOpen) {
          const focused = document.activeElement;
          paletteOpenerRef.current = focused instanceof HTMLElement ? focused : null;
        }
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canAccessPalette, commandPaletteOpen]);

  // Phase 2 gap 5: closing the palette restores focus to the element that
  // opened it when still visible, including the drawer-to-palette handoff
  // where the drawer trigger is gone and the visible nav trigger is next.
  useEffect(() => {
    const wasOpen = paletteWasOpenRef.current;
    paletteWasOpenRef.current = commandPaletteOpen;
    if (wasOpen && !commandPaletteOpen) {
      const opener = paletteOpenerRef.current;
      paletteOpenerRef.current = null;
      window.requestAnimationFrame(() => {
        if (isElementVisible(opener)) {
          opener?.focus();
          return;
        }
        if (isElementVisible(mobileNavTriggerRef.current)) {
          mobileNavTriggerRef.current?.focus();
          return;
        }
        if (isElementVisible(sidebarCollapseRef.current)) {
          sidebarCollapseRef.current?.focus();
        }
      });
    }
  }, [commandPaletteOpen]);

  // Phase 2 gap 6: transient per-workspace scroll memory. Positions live only
  // in memory, never in storage or backend, and survive sidebar/drawer
  // transitions plus reopen within the same workspace.
  useEffect(() => {
    const saved = navScrollStore.read(selectedWorkspace);
    if (saved === undefined) return;
    window.requestAnimationFrame(() => {
      if (sidebarScrollRef.current) {
        sidebarScrollRef.current.scrollTop = saved;
      }
      if (drawerScrollRef.current) {
        drawerScrollRef.current.scrollTop = saved;
      }
    });
  }, [selectedWorkspace, isCompact, mobileNavOpen, isNarrowViewport, navScrollStore]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      revealActiveIfOutside(sidebarScrollRef.current);
      if (mobileNavOpen) {
        revealActiveIfOutside(drawerScrollRef.current);
      }
    });
  }, [route.pathname, selectedWorkspace, mobileNavOpen, isCompact, isNarrowViewport]);

  function switchWorkspace(next: Workspace) {
    void requestGlobalLeave({
      action: () => {
        setSelectedWorkspace(next);
        try {
          window.localStorage.setItem(`choir-workspace:${window.location.hostname}`, next);
        } catch {
          // Restricted storage should not prevent switching workspaces.
        }
        void navigate(workspaceHome(next));
        setMobileNavOpen(false);
      },
      reason: "workspace-switch",
    });
  }

  function handleToggleNavigation() {
    if (!isCollapsibleWorkspace) return;
    if (isNarrowViewport) {
      navOpenerRef.current = sidebarCollapseRef.current;
      setMobileNavOpen(true);
      return;
    }
    currentNavPrefs.toggleCompact();
    window.requestAnimationFrame(() => {
      sidebarCollapseRef.current?.focus();
    });
  }

  function handleRailClick(event: MouseEvent<HTMLElement>) {
    if (!isCompact || event.button !== 0 || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a, button, input, select, textarea, [role='button'], [popover]")) {
      return;
    }
    handleToggleNavigation();
  }

  function handleExpandAdminGroup(groupId: OrganizationGroupId) {
    if (isNarrowViewport) {
      organizationNavigation.expandGroup(groupId);
      navOpenerRef.current = sidebarCollapseRef.current;
      setMobileNavOpen(true);
      return;
    }
    organizationNavigation.expandGroup(groupId);
    window.requestAnimationFrame(() => {
      sidebarCollapseRef.current?.focus();
    });
  }

  function handleExpandMemberGroup(groupId: string) {
    if (isNarrowViewport) {
      memberNavigation.expandGroup(groupId);
      navOpenerRef.current = sidebarCollapseRef.current;
      setMobileNavOpen(true);
      return;
    }
    memberNavigation.expandGroup(groupId);
    window.requestAnimationFrame(() => {
      sidebarCollapseRef.current?.focus();
    });
  }

  // Phase 2 gap 2: drawer destinations close only after the unsaved-change
  // guard accepts navigation. Cancellation keeps the route and usable nav.
  // Modified clicks never reach here; AppLink preserves native new-tab.
  function handleDrawerNavigate(href: string) {
    void navigate(href).then((allowed) => {
      if (shouldCloseDrawerAfterNavigate(allowed)) {
        setMobileNavOpen(false);
      }
    });
  }

  function capturePaletteOpener() {
    const focused = document.activeElement;
    paletteOpenerRef.current = focused instanceof HTMLElement ? focused : null;
  }

  function openPaletteFromHeader() {
    capturePaletteOpener();
    setCommandPaletteOpen(true);
  }

  function openPaletteFromSidebar() {
    capturePaletteOpener();
    setCommandPaletteOpen(true);
  }

  function openPaletteFromDrawer() {
    capturePaletteOpener();
    setMobileNavOpen(false);
    setCommandPaletteOpen(true);
  }

  function closePalette() {
    setCommandPaletteOpen(false);
  }

  function handleVoidNavigate(href: string): void {
    void navigate(href);
  }

  function handleNavScroll(workspace: Workspace) {
    const store = navScrollStore;
    return (event: UIEvent<HTMLDivElement>) => {
      store.write(workspace, event.currentTarget.scrollTop);
    };
  }

  const navGroups = workspaceNavigation(
    selectedWorkspace,
    visibleOrganizationGroups,
    visibleMemberGroups,
  );
  const selectedWorkspaceHome = workspaceHome(selectedWorkspace);
  const organizationName = organizationDisplayName(access, currentSession);
  const activeOrgName =
    branding?.organizationName ??
    (access.status === "ready" || access.status === "platform-scoped"
      ? access.organizationName
      : null);

  useEffect(() => {
    const org =
      activeOrgName ??
      (access.status === "ready" || access.status === "platform-scoped"
        ? access.organizationName
        : null);
    const title = pageTitle(route.pathname);
    const previousTitle = document.title;
    if (org) {
      document.title = title ? `${title} · ${org}` : org;
    } else if (title) {
      document.title = `${title} · Choir Management`;
    }
    return () => {
      document.title = previousTitle;
    };
  }, [activeOrgName, access, route.pathname]);

  return (
    <SaveCoordinatorProvider>
      <div
        className="signed-in-shell"
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
            (moduleController.warning || moduleController.snapshot.status !== "ready") ? (
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
                    route={route}
                    workspace={workspace}
                  />
                </Suspense>
                <SaveBar />
              </OrganizationTerminologyProvider>
            </organizationModuleContext.Provider>
          </main>
        </div>
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
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly onSignedOut: () => void;
}) {
  return (
    <AuthenticatedOrganizationShell
      key={`${window.location.hostname}:${props.currentSession.user.id}`}
      {...props}
    />
  );
}
