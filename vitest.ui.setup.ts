import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Shared setup for the Phase 4 UI interaction layer (vitest.ui.config.ts).
// React Testing Library auto-cleanup relies on a global afterEach; Vitest does
// not provide globals by default, so register cleanup explicitly.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});

function createMatchMediaStub(): (query: string) => MediaQueryList {
  return (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

// jsdom does not implement window.matchMedia; Radix primitives and responsive
// components must not crash when it is absent.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: createMatchMediaStub(),
  writable: true,
});

// jsdom does not implement Element.scrollIntoView; the Autocomplete primitive
// calls it when the active option changes.
Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: () => undefined,
  writable: true,
});

class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    // No-op stub: layout observation has no meaning in jsdom.
  }
  unobserve(): void {
    // No-op stub: layout observation has no meaning in jsdom.
  }
  disconnect(): void {
    // No-op stub: layout observation has no meaning in jsdom.
  }
}

// Radix floating primitives tolerate a missing ResizeObserver, but an explicit
// no-op keeps positioning code paths deterministic in jsdom.
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverStub,
  writable: true,
});
