import type { Workspace } from "./types";

export const NARROW_SIDEBAR_QUERY = "(max-width: 48rem)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function readNarrowViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(NARROW_SIDEBAR_QUERY).matches;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function isElementVisible(element: HTMLElement | null): boolean {
  if (!element?.isConnected) return false;
  try {
    const candidate = element as HTMLElement & {
      checkVisibility?: (options?: {
        readonly checkOpacity?: boolean;
        readonly checkVisibilityCSS?: boolean;
      }) => boolean;
    };
    if (typeof candidate.checkVisibility === "function") {
      return candidate.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
  } catch {
    // Fall through to the rect-based check below.
  }
  if (element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function shouldShowDrawerPin(sidebarPinned: boolean, isNarrowViewport: boolean): boolean {
  return !sidebarPinned && !isNarrowViewport;
}

export function shouldCloseStaleDrawer(args: {
  readonly isNarrow: boolean;
  readonly mobileOpen: boolean;
  readonly sidebarPinned: boolean;
  readonly wasNarrow: boolean;
}): boolean {
  return args.wasNarrow && !args.isNarrow && args.mobileOpen && args.sidebarPinned;
}

export function isSidebarVisible(sidebarPinned: boolean, isNarrow: boolean): boolean {
  return sidebarPinned && !isNarrow;
}

export function isMobileTriggerVisible(sidebarPinned: boolean, isNarrow: boolean): boolean {
  return !sidebarPinned || isNarrow;
}

export function isActiveOutsideView(
  containerRect: { readonly bottom: number; readonly top: number },
  activeRect: { readonly bottom: number; readonly top: number },
): boolean {
  return activeRect.top < containerRect.top || activeRect.bottom > containerRect.bottom;
}

export function shouldCloseDrawerAfterNavigate(allowed: boolean): boolean {
  return allowed;
}

export function findActiveNavItem(container: HTMLElement | null): HTMLElement | null {
  if (!container) return null;
  return container.querySelector<HTMLElement>('[aria-current="page"]');
}

export function revealActiveIfOutside(container: HTMLElement | null): void {
  if (!container) return;
  const active = findActiveNavItem(container);
  if (!active) return;
  const containerRect = container.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  if (isActiveOutsideView(containerRect, activeRect)) {
    active.scrollIntoView({ block: "nearest" });
  }
}

export class NavScrollStore {
  private readonly positions = new Map<Workspace, number>();

  read(workspace: Workspace): number | undefined {
    return this.positions.get(workspace);
  }

  write(workspace: Workspace, scrollTop: number): void {
    this.positions.set(workspace, scrollTop);
  }
}
