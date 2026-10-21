import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchOrganization } from "../../../api/search";
import { useAdminSearch } from "./useAdminSearch";
import type { OrganizationFeatureContext } from "../../organizationFeatures/types";
vi.mock("../../../api/search", () => ({ searchOrganization: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(searchOrganization).mockReset();
  vi.mocked(searchOrganization).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
const context: OrganizationFeatureContext = { status: "ready", modules: [] };
const props = {
  hostname: "org-a.example",
  isOwner: false,
  modules: [],
  organizationContext: context,
  open: true,
};
describe("full Organization entity search survives registry migration", () => {
  it.each(["roster", "events", "music", "polls"] as const)(
    "retains %s prefix, server search, hidden controls and module filtering",
    async (category) => {
      const entity = {
        id: `entity-${category}`,
        category,
        title: "Server Record",
        href: category === "music" ? "/admin/library?pieceId=1" : `/admin/${category}?id=1`,
      };
      vi.mocked(searchOrganization).mockResolvedValue([entity]);
      const { result, rerender } = renderHook((p) => useAdminSearch(p), { initialProps: props });
      act(() => {
        result.current.setQuery(`${category}: Record`);
        result.current.setIncludeHidden(true);
      });
      expect(searchOrganization).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(121);
      });
      expect(searchOrganization).toHaveBeenCalledWith(
        { category, includeHidden: true, limit: 15, query: "Record" },
        expect.any(AbortSignal),
      );
      expect(result.current.results).toContainEqual(entity);
      const id = category === "music" ? "music_library" : category;
      rerender({
        ...props,
        organizationContext: { ...context, modules: [{ id, enabled: false }] },
      });
      expect(result.current.results).not.toContainEqual(entity);
      rerender(props);
      expect(result.current.results).toContainEqual(entity);
    },
  );
  it("cancels on query change and close, ignores late responses, and retains settings/action local search", async () => {
    const { result, rerender } = renderHook((p) => useAdminSearch(p), { initialProps: props });
    act(() => {
      result.current.setQuery("old");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(121);
    });
    const signal = vi.mocked(searchOrganization).mock.calls[0]?.[1];
    act(() => {
      result.current.setQuery("new");
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(121);
    });
    const latest = vi.mocked(searchOrganization).mock.calls[1]?.[1];
    rerender({ ...props, open: false });
    expect(latest?.aborted).toBe(true);
    rerender(props);
    act(() => {
      result.current.setQuery("settings: roster");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(searchOrganization).toHaveBeenCalledTimes(2);
    expect(result.current.results.some((r) => r.id === "set-roster-automation")).toBe(true);
    act(() => {
      result.current.setQuery("actions: theme");
    });
    expect(result.current.results.some((r) => r.id === "act-toggle-theme")).toBe(true);
  });
});

it("requeries an open entity search after a module is enabled, without changing the query or reloading", async () => {
  const disabled = {
    ...props,
    organizationContext: { ...context, modules: [{ id: "music_library", enabled: false }] },
  };
  const { result, rerender } = renderHook((p) => useAdminSearch(p), { initialProps: disabled });
  act(() => {
    result.current.setQuery("music: Mozart");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(121);
  });
  expect(result.current.results).toEqual([]);
  const entity = {
    id: "music-1",
    category: "music" as const,
    title: "Mozart",
    href: "/admin/library?pieceId=1",
  };
  vi.mocked(searchOrganization).mockResolvedValue([entity]);
  rerender({
    ...disabled,
    organizationContext: { ...context, modules: [{ id: "music_library", enabled: true }] },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(121);
  });
  expect(result.current.query).toBe("music: Mozart");
  expect(result.current.results).toContainEqual(entity);
  expect(searchOrganization).toHaveBeenCalledTimes(2);
});
