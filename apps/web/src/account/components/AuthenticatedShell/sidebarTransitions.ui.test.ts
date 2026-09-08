import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import {
  NavScrollStore,
  REDUCED_MOTION_QUERY,
  findActiveNavItem,
  isActiveOutsideView,
  isElementVisible,
  isMobileTriggerVisible,
  isSidebarVisible,
  prefersReducedMotion,
  readNarrowViewport,
  revealActiveIfOutside,
  shouldCloseDrawerAfterNavigate,
  shouldCloseStaleDrawer,
  shouldShowDrawerPin,
} from "./sidebarTransitions";

describe("sidebar phase 2 transitions", () => {
  it("shows the drawer pin only on desktop while unpinned", () => {
    expect(shouldShowDrawerPin(false, false)).toBe(true);
    expect(shouldShowDrawerPin(false, true)).toBe(false);
    expect(shouldShowDrawerPin(true, false)).toBe(false);
    expect(shouldShowDrawerPin(true, true)).toBe(false);
  });

  it("closes a stale drawer only when widening over a pinned layout", () => {
    expect(
      shouldCloseStaleDrawer({
        isNarrow: false,
        mobileOpen: true,
        sidebarPinned: true,
        wasNarrow: true,
      }),
    ).toBe(true);
    expect(
      shouldCloseStaleDrawer({
        isNarrow: false,
        mobileOpen: true,
        sidebarPinned: false,
        wasNarrow: true,
      }),
    ).toBe(false);
    expect(
      shouldCloseStaleDrawer({
        isNarrow: false,
        mobileOpen: false,
        sidebarPinned: true,
        wasNarrow: true,
      }),
    ).toBe(false);
    expect(
      shouldCloseStaleDrawer({
        isNarrow: true,
        mobileOpen: true,
        sidebarPinned: true,
        wasNarrow: false,
      }),
    ).toBe(false);
  });

  it("keeps drawer navigation open after a dirty-cancel and closes after accept", () => {
    expect(shouldCloseDrawerAfterNavigate(false)).toBe(false);
    expect(shouldCloseDrawerAfterNavigate(true)).toBe(true);
  });

  it("resolves visible sidebar and trigger states without touching storage", () => {
    expect(isSidebarVisible(true, false)).toBe(true);
    expect(isSidebarVisible(true, true)).toBe(false);
    expect(isSidebarVisible(false, false)).toBe(false);
    expect(isMobileTriggerVisible(false, false)).toBe(true);
    expect(isMobileTriggerVisible(true, false)).toBe(false);
    expect(isMobileTriggerVisible(true, true)).toBe(true);
  });

  it("detects when the active item is outside the visible nav area", () => {
    const container = { bottom: 400, top: 100 };
    expect(isActiveOutsideView(container, { bottom: 90, top: 70 })).toBe(true);
    expect(isActiveOutsideView(container, { bottom: 420, top: 400 })).toBe(true);
    expect(isActiveOutsideView(container, { bottom: 200, top: 150 })).toBe(false);
  });

  it("keeps per-workspace scroll memory in memory only", () => {
    const store = new NavScrollStore();
    expect(store.read("organization")).toBeUndefined();
    store.write("organization", 120);
    store.write("member", 40);
    expect(store.read("organization")).toBe(120);
    expect(store.read("member")).toBe(40);
    store.write("organization", 200);
    expect(store.read("organization")).toBe(200);
    expect(store.read("member")).toBe(40);
  });

  it("reveals the active item only when outside the visible area", () => {
    const container = document.createElement("div");
    const active = document.createElement("a");
    active.setAttribute("aria-current", "page");
    container.append(active);
    document.body.append(container);

    expect(findActiveNavItem(container)).toBe(active);

    let scrolled = 0;
    active.scrollIntoView = () => {
      scrolled += 1;
    };
    stubRect(container, { bottom: 400, top: 100 });
    stubRect(active, { bottom: 200, top: 150 });
    revealActiveIfOutside(container);
    expect(scrolled).toBe(0);

    stubRect(active, { bottom: 500, top: 450 });
    revealActiveIfOutside(container);
    expect(scrolled).toBe(1);

    container.remove();
  });

  it("treats detached elements as invisible focus targets", () => {
    const detached = document.createElement("button");
    expect(isElementVisible(detached)).toBe(false);
    expect(isElementVisible(null)).toBe(false);
  });

  it("reads the narrow breakpoint without touching stored preferences", () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    let storageReads = 0;
    let storageWrites = 0;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          storageReads += 1;
          return null;
        },
        setItem: () => {
          storageWrites += 1;
        },
      },
    });
    const narrowStub = (query: string): MediaQueryList => ({
      matches: query.includes("48rem"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: narrowStub,
      writable: true,
    });
    try {
      expect(readNarrowViewport()).toBe(true);
    } finally {
      if (matchMediaDescriptor) {
        Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
      }
      if (storageDescriptor) {
        Object.defineProperty(window, "localStorage", storageDescriptor);
      } else {
        Reflect.deleteProperty(window, "localStorage");
      }
    }
    expect(storageReads).toBe(0);
    expect(storageWrites).toBe(0);
  });

  it("reads reduced-motion without touching stored preferences", () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    let storageReads = 0;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          storageReads += 1;
          return null;
        },
        setItem: () => undefined,
      },
    });
    const motionStub = (query: string): MediaQueryList => ({
      matches: query === REDUCED_MOTION_QUERY,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: motionStub,
      writable: true,
    });
    try {
      expect(prefersReducedMotion()).toBe(true);
    } finally {
      if (matchMediaDescriptor) {
        Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
      }
      if (storageDescriptor) {
        Object.defineProperty(window, "localStorage", storageDescriptor);
      } else {
        Reflect.deleteProperty(window, "localStorage");
      }
    }
    expect(storageReads).toBe(0);
  });

  it("falls back to overlay navigation when matchMedia is unavailable", () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
    try {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
      expect(readNarrowViewport()).toBe(false);
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      if (matchMediaDescriptor) {
        Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
      }
    }
  });

  it("hides elements with display:none or visibility:hidden from focus targets", () => {
    const container = document.createElement("div");
    const hidden = document.createElement("button");
    const invisible = document.createElement("button");
    hidden.textContent = "hidden";
    invisible.textContent = "invisible";
    container.append(hidden, invisible);
    document.body.append(container);
    try {
      hidden.style.display = "none";
      invisible.style.visibility = "hidden";
      expect(isElementVisible(hidden)).toBe(false);
      expect(isElementVisible(invisible)).toBe(false);
    } finally {
      container.remove();
    }
  });

  it("treats boundary-aligned active items as visible", () => {
    const container = { bottom: 400, top: 100 };
    expect(isActiveOutsideView(container, { bottom: 400, top: 100 })).toBe(false);
    expect(isActiveOutsideView(container, { bottom: 400, top: 399 })).toBe(false);
    expect(isActiveOutsideView(container, { bottom: 101, top: 100 })).toBe(false);
    expect(isActiveOutsideView(container, { bottom: 100, top: 99 })).toBe(true);
    expect(isActiveOutsideView(container, { bottom: 401, top: 400 })).toBe(true);
  });

  it("never touches storage when resolving drawer and trigger visibility", () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    let storageReads = 0;
    let storageWrites = 0;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          storageReads += 1;
          throw new Error("storage unavailable");
        },
        setItem: () => {
          storageWrites += 1;
          throw new Error("storage unavailable");
        },
      },
    });
    try {
      expect(shouldShowDrawerPin(false, false)).toBe(true);
      expect(isSidebarVisible(false, true)).toBe(false);
      expect(isMobileTriggerVisible(true, true)).toBe(true);
      expect(
        shouldCloseStaleDrawer({
          isNarrow: true,
          mobileOpen: true,
          sidebarPinned: true,
          wasNarrow: true,
        }),
      ).toBe(false);
      expect(shouldCloseDrawerAfterNavigate(true)).toBe(true);
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, "localStorage", storageDescriptor);
      } else {
        Reflect.deleteProperty(window, "localStorage");
      }
    }
    expect(storageReads).toBe(0);
    expect(storageWrites).toBe(0);
  });

  it("keeps narrowing a drawer open instead of treating it as stale", () => {
    expect(
      shouldCloseStaleDrawer({
        isNarrow: true,
        mobileOpen: true,
        sidebarPinned: true,
        wasNarrow: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseStaleDrawer({
        isNarrow: true,
        mobileOpen: true,
        sidebarPinned: false,
        wasNarrow: false,
      }),
    ).toBe(false);
    expect(
      shouldCloseStaleDrawer({
        isNarrow: false,
        mobileOpen: false,
        sidebarPinned: false,
        wasNarrow: true,
      }),
    ).toBe(false);
  });

  it("isolates scroll memory across every workspace without persistence", () => {
    const store = new NavScrollStore();
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    let storageWrites = 0;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          storageWrites += 1;
        },
      },
    });
    try {
      store.write("organization", 120);
      store.write("member", 40);
      store.write("account", 70);
      store.write("platform", 15);
      expect(store.read("organization")).toBe(120);
      expect(store.read("member")).toBe(40);
      expect(store.read("account")).toBe(70);
      expect(store.read("platform")).toBe(15);
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, "localStorage", storageDescriptor);
      } else {
        Reflect.deleteProperty(window, "localStorage");
      }
    }
    expect(storageWrites).toBe(0);
  });

  it("finds no active item when navigation has no current page", () => {
    const container = document.createElement("div");
    const link = document.createElement("a");
    link.setAttribute("href", "/admin/roster");
    container.append(link);
    document.body.append(container);
    try {
      expect(findActiveNavItem(container)).toBeNull();
      expect(findActiveNavItem(null)).toBeNull();
    } finally {
      container.remove();
    }
  });

  it("leaves scroll alone when there is no active item or no overflow", () => {
    const empty = document.createElement("div");
    document.body.append(empty);
    try {
      expect(() => {
        revealActiveIfOutside(null);
        revealActiveIfOutside(empty);
      }).not.toThrow();
    } finally {
      empty.remove();
    }

    const container = document.createElement("div");
    const active = document.createElement("a");
    active.setAttribute("aria-current", "page");
    container.append(active);
    document.body.append(container);
    let scrolled = 0;
    active.scrollIntoView = () => {
      scrolled += 1;
    };
    try {
      stubRect(container, { bottom: 400, top: 100 });
      stubRect(active, { bottom: 101, top: 100 });
      revealActiveIfOutside(container);
      expect(scrolled).toBe(0);
      stubRect(active, { bottom: 400, top: 399 });
      revealActiveIfOutside(container);
      expect(scrolled).toBe(0);
    } finally {
      container.remove();
    }
  });
});

function stubRect(
  element: HTMLElement,
  rect: { readonly bottom: number; readonly top: number },
): void {
  element.getBoundingClientRect = () => new DOMRect(0, rect.top, 100, rect.bottom - rect.top);
}
