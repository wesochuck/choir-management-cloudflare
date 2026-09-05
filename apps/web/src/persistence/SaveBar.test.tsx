import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SaveBar } from "./SaveBar";
import { SaveCoordinatorContext } from "./SaveCoordinatorContext";
import type { SaveCoordinatorContextValue } from "./types";

describe("SaveBar", () => {
  const baseCoordinator: SaveCoordinatorContextValue = {
    dirtyCount: 0,
    discardAll: vi.fn(),
    isDirty: false,
    isSaving: false,
    register: vi.fn().mockReturnValue(vi.fn()),
    requestLeave: vi.fn().mockResolvedValue(true),
    saveAll: vi.fn().mockResolvedValue({ errors: [], success: true }),
  };

  it("renders null when not dirty and not saving", () => {
    const html = renderToString(
      <SaveCoordinatorContext.Provider value={baseCoordinator}>
        <SaveBar />
      </SaveCoordinatorContext.Provider>,
    );
    expect(html).toBe("");
  });

  it("renders save bar with polite live region when dirty", () => {
    const html = renderToString(
      <SaveCoordinatorContext.Provider
        value={{
          ...baseCoordinator,
          dirtyCount: 1,
          isDirty: true,
        }}
      >
        <SaveBar />
      </SaveCoordinatorContext.Provider>,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("You have unsaved changes");
    expect(html).toContain("Discard");
    expect(html).toContain("Save changes");
  });

  it("renders saving state when isSaving is true", () => {
    const html = renderToString(
      <SaveCoordinatorContext.Provider
        value={{
          ...baseCoordinator,
          dirtyCount: 1,
          isDirty: true,
          isSaving: true,
        }}
      >
        <SaveBar />
      </SaveCoordinatorContext.Provider>,
    );
    expect(html).toContain("Saving changes…");
    expect(html).toContain("Saving…");
    expect(html).toContain("disabled");
  });
});
