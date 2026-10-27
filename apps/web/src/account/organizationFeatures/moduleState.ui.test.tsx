import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleState } from "@choir/contracts";
import { getOrganizationModuleState, saveSetupProgress } from "../../api";
import { ModuleSettingsView } from "../ModuleSettingsView";
import { organizationModuleContext } from "./moduleStateContext";
import { useOrganizationModuleState } from "./useOrganizationModuleState";
import {
  getOrganizationDashboardSections,
  getOrganizationQuickActions,
  getOrganizationSidebarGroups,
} from "./selectors";
import { CommandPaletteModal } from "../components/CommandPalette/CommandPaletteModal";
import { addRecentSearch, getRecentSearches } from "../components/CommandPalette/recents";

vi.mock("../../api", () => ({ getOrganizationModuleState: vi.fn(), saveSetupProgress: vi.fn() }));
const catalog: readonly ModuleState[] = [
  { id: "music_library", enabled: true, label: "Music Library", category: "content" },
  { id: "practice_player", enabled: true, label: "Practice Player", category: "content" },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function Harness() {
  const controller = useOrganizationModuleState("org-a");
  const context = { ...controller.snapshot, isOwner: true };
  return (
    <organizationModuleContext.Provider value={controller}>
      <ModuleSettingsView />
      <output data-testid="sidebar">
        {getOrganizationSidebarGroups(context)
          .flatMap((g) => g.items)
          .map((i) => i.href)
          .join(" ")}
      </output>
      <output data-testid="dashboard">
        {getOrganizationDashboardSections(context)
          .flatMap((g) => g.cards)
          .map((i) => i.href)
          .join(" ")}
      </output>
      <output data-testid="actions">
        {getOrganizationQuickActions(context)
          .map((i) => i.label)
          .join(" ")}
      </output>
      <CommandPaletteModal
        open
        isOwner
        modules={[]}
        organizationContext={context}
        onClose={() => undefined}
        onNavigate={() => undefined}
        onToggleTheme={() => undefined}
      />
    </organizationModuleContext.Provider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    },
  });
  vi.mocked(getOrganizationModuleState).mockResolvedValue(catalog);
  vi.mocked(saveSetupProgress).mockResolvedValue({ saved: true });
});
describe("shell-owned reactive module snapshot", () => {
  it("deduplicates reads, patches acknowledged changes and rejects stale responses", async () => {
    const { result } = renderHook(() => useOrganizationModuleState("org-a"));
    await waitFor(() => {
      expect(result.current.snapshot.status).toBe("ready");
    });
    const old = deferred<readonly ModuleState[]>();
    vi.mocked(getOrganizationModuleState).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refresh();
      expect(result.current.refresh()).toBe(pending);
    });
    const newest = deferred<readonly ModuleState[]>();
    vi.mocked(getOrganizationModuleState).mockReturnValueOnce(newest.promise);
    act(() => {
      result.current.confirmChange("music_library", false);
    });
    expect(result.current.snapshot.modules[0]?.enabled).toBe(false);
    await act(async () => {
      old.resolve(catalog);
      await pending;
    });
    expect(result.current.snapshot.modules[0]?.enabled).toBe(false);
    await act(async () => {
      newest.resolve(catalog.map((m) => ({ ...m, enabled: m.id !== "music_library" })));
      await newest.promise;
    });
    expect(result.current.snapshot.modules[0]?.enabled).toBe(false);
    expect(getOrganizationModuleState).toHaveBeenCalledTimes(3);
  });
  it("retains confirmed delta on failed readback and retries once when foregrounded", async () => {
    const { result } = renderHook(() => useOrganizationModuleState("org-a"));
    await waitFor(() => {
      expect(result.current.snapshot.status).toBe("ready");
    });
    vi.mocked(getOrganizationModuleState).mockRejectedValueOnce(new Error("readback"));
    act(() => {
      result.current.confirmChange("music_library", false);
    });
    await waitFor(() => {
      expect(result.current.warning).toBe(true);
    });
    expect(result.current.snapshot.status).toBe("ready");
    expect(result.current.snapshot.modules[0]?.enabled).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(result.current.warning).toBe(false);
    });
    expect(getOrganizationModuleState).toHaveBeenCalledTimes(3);
  });
  it("fails closed on initial read failure and recovers on retry", async () => {
    vi.mocked(getOrganizationModuleState).mockRejectedValueOnce(new Error("unavailable"));
    const { result } = renderHook(() => useOrganizationModuleState("org-a"));
    await waitFor(() => {
      expect(result.current.snapshot.status).toBe("error");
    });
    expect(result.current.snapshot.modules).toEqual([]);
    await act(() => result.current.refresh());
    expect(result.current.snapshot.status).toBe("ready");
  });
  it("uses a prewarmed snapshot immediately and avoids a duplicate mount read", () => {
    const { result } = renderHook(() => useOrganizationModuleState("org-a", catalog, true, false));

    expect(result.current.snapshot).toEqual({ modules: catalog, status: "ready" });
    expect(getOrganizationModuleState).not.toHaveBeenCalled();
  });
  it("keeps module loading disabled on the product-base host", () => {
    const { result } = renderHook(() =>
      useOrganizationModuleState("base:user-a", undefined, false),
    );

    expect(result.current.snapshot).toEqual({ modules: [], status: "loading" });
    expect(getOrganizationModuleState).not.toHaveBeenCalled();
  });
  it("resets on Organization identity change and aborts earlier reads / callbacks", async () => {
    const old = deferred<readonly ModuleState[]>();
    vi.mocked(getOrganizationModuleState).mockReturnValueOnce(old.promise);
    const { result, rerender, unmount } = renderHook(({ id }) => useOrganizationModuleState(id), {
      initialProps: { id: "org-a" },
    });
    const staleConfirm = result.current.confirmChange;
    const signal = vi.mocked(getOrganizationModuleState).mock.calls[0]?.[0];
    rerender({ id: "org-b" });
    await waitFor(() => {
      expect(result.current.snapshot.status).toBe("ready");
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      old.resolve([{ id: "music_library", enabled: false }]);
      await old.promise;
    });
    act(() => {
      staleConfirm("music_library", false);
    });
    expect(result.current.snapshot.modules[0]?.enabled).toBe(true);
    const currentConfirm = result.current.confirmChange;
    unmount();
    currentConfirm("music_library", false);
    expect(getOrganizationModuleState).toHaveBeenCalledTimes(2);
  });
  it("changes all consumers and Recents only after successful save; re-enable restores history", async () => {
    addRecentSearch(window.location.hostname, {
      id: "nav-music",
      category: "navigation",
      title: "Old Music",
      href: "/admin/library",
    });
    addRecentSearch(window.location.hostname, {
      id: "piece-1",
      category: "music",
      title: "Cached Piece",
      href: "/admin/library?pieceId=1",
    });
    render(<Harness />);
    const checkbox = await screen.findByLabelText("Music Library");
    expect(screen.getByLabelText("Practice Player")).toBeChecked();
    expect(screen.getByText("Cached Piece")).toBeVisible();
    const save = deferred<Awaited<ReturnType<typeof saveSetupProgress>>>();
    vi.mocked(saveSetupProgress).mockReturnValueOnce(save.promise);
    fireEvent.click(checkbox);
    expect(screen.getByTestId("actions")).toHaveTextContent("Add Music");
    expect(screen.getByText("Cached Piece")).toBeVisible();
    vi.mocked(getOrganizationModuleState).mockResolvedValue(
      catalog.map((m) => ({ ...m, enabled: m.id !== "music_library" })),
    );
    await act(async () => {
      save.resolve({ saved: true });
      await save.promise;
    });
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(screen.getByTestId("sidebar")).not.toHaveTextContent("/admin/library");
    expect(screen.getByTestId("dashboard")).not.toHaveTextContent("/admin/library");
    expect(screen.getByTestId("actions")).not.toHaveTextContent("Add Music");
    expect(screen.queryByText("Cached Piece")).toBeNull();
    expect(getRecentSearches(window.location.hostname)).toHaveLength(2);
    vi.mocked(getOrganizationModuleState).mockResolvedValue(catalog);
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(screen.getByText("Cached Piece")).toBeVisible();
    expect(screen.getAllByText("Music Library").length).toBeGreaterThan(0);
    expect(getOrganizationModuleState).toHaveBeenCalledTimes(3);
  });
  it("does not change eligibility on failed save", async () => {
    render(<Harness />);
    const checkbox = await screen.findByLabelText("Music Library");
    vi.mocked(saveSetupProgress).mockRejectedValueOnce(new Error("save failed"));
    fireEvent.click(checkbox);
    await screen.findByText("Module could not be updated. Please try again.");
    expect(checkbox).toBeChecked();
    expect(screen.getByTestId("actions")).toHaveTextContent("Add Music");
    expect(getOrganizationModuleState).toHaveBeenCalledTimes(1);
  });
});
