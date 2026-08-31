import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDom } from "./testDom";
import { SaveCoordinatorProvider } from "./SaveCoordinator";
import { useNavigationGuard } from "./UnsavedChangesGuard";

setupTestDom();

describe("UnsavedChangesGuard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("permits navigation immediately when clean", async () => {
    let guardRef!: ReturnType<typeof useNavigationGuard>["guard"];

    function GuardChild() {
      const { guard } = useNavigationGuard();
      guardRef = guard;
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SaveCoordinatorProvider>
          <GuardChild />
        </SaveCoordinatorProvider>,
      );
    });

    const action = vi.fn();
    let allowed = false;
    await act(async () => {
      allowed = await guardRef({ action, reason: "navigate" });
    });

    expect(allowed).toBe(true);
    expect(action).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
