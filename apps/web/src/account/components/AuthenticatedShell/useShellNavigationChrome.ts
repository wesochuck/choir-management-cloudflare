import { useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent, SetStateAction, UIEvent } from "react";
import { requestGlobalLeave } from "../../../persistence";
import {
  useOrganizationNavigationPreferences,
  useWorkspaceNavigationPreferences,
} from "../../organizationFeatures/navigationPreferences";
import type { OrganizationGroupId } from "../../organizationFeatures/types";
import type { NavigateFn } from "./hooks";
import {
  NARROW_SIDEBAR_QUERY,
  NavScrollStore,
  isElementVisible,
  readNarrowViewport,
  revealActiveIfOutside,
  shouldCloseDrawerAfterNavigate,
  shouldCloseStaleDrawer,
} from "./sidebarTransitions";
import type { AccessState, NavigationGroup, RouteState, ThemePreference, Workspace } from "./types";
import { applyTheme, pageTitle, readThemePreference, themeStorageKey } from "./utils";
import { workspaceHome, workspaceNavigation } from "./workspacesUtils";

export function useShellNavigationChrome({
  access,
  activeOrgName,
  canAccessPalette,
  navigate,
  route,
  selectedWorkspace,
  setSelectedWorkspace,
  visibleMemberGroups,
  visibleOrganizationGroups,
}: {
  readonly access: AccessState;
  readonly activeOrgName: string | null;
  readonly canAccessPalette: boolean;
  readonly navigate: NavigateFn;
  readonly route: RouteState;
  readonly selectedWorkspace: Workspace;
  readonly setSelectedWorkspace: Dispatch<SetStateAction<Workspace>>;
  readonly visibleMemberGroups: readonly NavigationGroup[];
  readonly visibleOrganizationGroups: readonly NavigationGroup[];
}) {
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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);

  const isCollapsibleWorkspace =
    selectedWorkspace === "organization" || selectedWorkspace === "member";
  const currentNavPrefs =
    selectedWorkspace === "organization" ? organizationNavigation : memberNavigation;
  const isCompact = isCollapsibleWorkspace && (currentNavPrefs.compact || isNarrowViewport);

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

  useEffect(() => {
    if (selectedWorkspace !== "member") return;
    const phone = window.matchMedia("(max-width: 48rem)");
    const closeTabletDrawer = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileNavOpen(false);
    };
    phone.addEventListener("change", closeTabletDrawer);
    return () => {
      phone.removeEventListener("change", closeTabletDrawer);
    };
  }, [selectedWorkspace]);

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

  return {
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
  };
}
