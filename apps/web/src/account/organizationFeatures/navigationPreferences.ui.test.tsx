import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  navigationStorageKey,
  organizationNavigationKey,
  useOrganizationNavigationPreferences,
  useWorkspaceNavigationPreferences,
} from "./navigationPreferences";
import { OrganizationAdminNavigation } from "./OrganizationAdminNavigation";
import { getOrganizationSidebarGroups } from "./selectors";

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
});

describe("Organization-only navigation preferences", () => {
  it("defaults to People, expands aliases on navigation, and respects manual collapse until the next navigation", () => {
    const { result, rerender } = renderHook(
      ({ path }) => useOrganizationNavigationPreferences("alpha.example", path),
      { initialProps: { path: "/admin" } },
    );
    expect(result.current.expanded).toEqual(["people"]);
    act(() => {
      result.current.toggleGroup("events");
    });
    expect(result.current.expanded).toEqual(["people", "events"]);
    act(() => {
      result.current.toggleGroup("people");
    });
    rerender({ path: "/admin" });
    expect(result.current.expanded).toEqual(["events"]);
    rerender({ path: "/admin/invitations" });
    expect(result.current.expanded).toEqual(["events", "people"]);
    act(() => {
      result.current.toggleGroup("people");
    });
    expect(result.current.expanded).toEqual(["events"]);
    rerender({ path: "/admin/roster?section=settings" });
    expect(result.current.expanded).toEqual(["events", "people"]);
  });

  it("migrates legacy pinned=false to compact, restores valid group preferences, isolates hosts, and does not touch the legacy pinned preference", () => {
    window.localStorage.setItem(
      organizationNavigationKey("alpha.example", "groups"),
      '["unknown","music"]',
    );
    window.localStorage.setItem("choir-sidebar-pinned:alpha.example", "false");
    const { result, rerender } = renderHook(
      ({ host }) => useOrganizationNavigationPreferences(host, "/admin"),
      { initialProps: { host: "alpha.example" } },
    );
    expect(result.current.expanded).toEqual(["music"]);
    // Legacy choir-sidebar-pinned:false is migrated to compact=true
    expect(result.current.compact).toBe(true);
    act(() => {
      result.current.toggleCompact();
    });
    expect(window.localStorage.getItem(organizationNavigationKey("alpha.example", "compact"))).toBe(
      "false",
    );
    expect(window.localStorage.getItem("choir-sidebar-pinned:alpha.example")).toBe("false");
    rerender({ host: "beta.example" });
    expect(result.current.compact).toBe(false);
    expect(result.current.expanded).toEqual(["people"]);
    rerender({ host: "alpha.example" });
    expect(result.current.compact).toBe(false);
    expect(result.current.expanded).toEqual(["music"]);
  });

  it("supports Member workspace navigation preferences with auto-revealing route and independent compact state", () => {
    const { result, rerender } = renderHook(
      ({ path }) => useWorkspaceNavigationPreferences("alpha.example", path, "member"),
      { initialProps: { path: "/dashboard" } },
    );
    expect(result.current.expanded).toEqual(["people", "music"]);
    expect(result.current.compact).toBe(false);

    act(() => {
      result.current.toggleCompact();
    });
    expect(result.current.compact).toBe(true);
    expect(
      window.localStorage.getItem(navigationStorageKey("alpha.example", "member", "compact")),
    ).toBe("true");

    act(() => {
      result.current.expandGroup("people");
    });
    expect(result.current.compact).toBe(false);
    expect(result.current.expanded).toContain("people");

    rerender({ path: "/practice" });
    expect(result.current.expanded).toContain("music");
  });

  it("retains valid expanded IDs when modules change while hiding empty groups", () => {
    function Navigation() {
      const state = useOrganizationNavigationPreferences("alpha.example", "/admin");
      return (
        <OrganizationAdminNavigation
          groups={getOrganizationSidebarGroups({
            status: "ready",
            modules: [
              { id: "events", enabled: false },
              { id: "venues", enabled: false },
              { id: "rsvp", enabled: false },
              { id: "attendance", enabled: false },
              { id: "seating", enabled: false },
            ],
          })}
          path="/admin"
          expanded={state.expanded}
          toggleGroup={state.toggleGroup}
          navigate={() => Promise.resolve(true)}
          onSearch={() => undefined}
        />
      );
    }
    render(<Navigation />);
    expect(screen.queryByRole("button", { name: "Events & attendance" })).toBeNull();
    const people = screen.getByRole("button", { name: "People & membership" });
    expect(people).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(people);
    expect(people).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("calls onExpandGroup and expands in place instead of rendering a popover in compact mode", () => {
    const onExpandGroup = vi.fn();
    render(
      <OrganizationAdminNavigation
        groups={getOrganizationSidebarGroups({ status: "ready", modules: [] })}
        path="/admin"
        compact={true}
        expanded={["people"]}
        toggleGroup={() => undefined}
        onExpandGroup={onExpandGroup}
        navigate={() => Promise.resolve(true)}
        onSearch={() => undefined}
      />,
    );

    const people = screen.getByRole("button", { name: "People & membership" });
    fireEvent.click(people);
    expect(onExpandGroup).toHaveBeenCalledWith("people");
    // Popover is no longer rendered
    expect(document.querySelector(".organization-nav__flyout")).toBeNull();
  });

  it("survives unavailable storage and keeps independent group controls usable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    const { result } = renderHook(() =>
      useOrganizationNavigationPreferences("alpha.example", "/admin/settings/modules"),
    );
    expect(result.current.expanded).toEqual(["people", "insights"]);
    act(() => {
      result.current.toggleGroup("music");
      result.current.toggleCompact();
    });
    expect(result.current.compact).toBe(true);
    expect(result.current.expanded).toContain("music");
  });
});

describe("Organization active destination", () => {
  it.each([
    ["/admin/patrons", "/admin/donations"],
    ["/admin/invitations", "/admin/settings/invitations"],
    ["/directory?from=admin", "/directory?from=admin"],
    ["/admin/settings/modules", "/admin/settings/modules"],
    ["/admin/roster/detail", "/admin/roster"],
  ])("reveals exactly one destination for %s", (path, href) => {
    const { container } = render(
      <OrganizationAdminNavigation
        groups={getOrganizationSidebarGroups({ status: "ready", modules: [] })}
        path={path}
        expanded={["people", "events", "music", "communications", "insights"]}
        toggleGroup={() => undefined}
        navigate={() => Promise.resolve(true)}
        onSearch={() => undefined}
      />,
    );
    const active = container.querySelectorAll('a[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", href);
  });
});
