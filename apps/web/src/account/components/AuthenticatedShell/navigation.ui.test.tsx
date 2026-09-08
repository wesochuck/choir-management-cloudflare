import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { ModuleState } from "@choir/contracts";

import { AppLink, Navigation, SidebarWorkspaceHeading } from "./navigation";
import type { NavigationGroup } from "./types";
import { organizationGroups, routeHasModule } from "./utils";
import { workspaceNavigation } from "./workspacesUtils";

const groups: readonly NavigationGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Admin overview" },
      { href: "/admin/roster", label: "Roster" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin/settings", label: "Organization settings" },
      { href: "/admin/settings/modules", label: "Modules" },
    ],
  },
];

function currentLinks(): readonly HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('a[aria-current="page"]')];
}

describe("sidebar navigation behavior", () => {
  it("shares one workspace heading hierarchy", () => {
    const { container } = render(
      <SidebarWorkspaceHeading organizationName="Alpha Choir" workspaceName="Organization Admin" />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Organization Admin" })).toBeVisible();
    expect(screen.getByText("Alpha Choir")).toBeVisible();
    const context = container.querySelector(".sidebar-context");
    expect(context).not.toBeNull();
    expect([...(context?.children ?? [])].map((child) => child.tagName)).toEqual(["H2", "P"]);
    expect(container.querySelector("h1")).toBeNull();
  });

  it("wraps long workspace and organization names instead of clipping", () => {
    const longWorkspace = "Organization Administration and Extended Workspace Label";
    const longOrg = "Dr. Alexander Montgomery-Wellington III Memorial Choir Society";
    const { container } = render(
      <SidebarWorkspaceHeading organizationName={longOrg} workspaceName={longWorkspace} />,
    );
    const title = screen.getByRole("heading", { level: 2, name: longWorkspace });
    expect(title).toBeVisible();
    expect(title).toHaveClass("sidebar-context__title");
    expect(screen.getByText(longOrg)).toBeVisible();
    // Wrapping itself is enforced by `.sidebar-context__title` /
    // `.sidebar-context__org { overflow-wrap: anywhere; }` in
    // signed-in-shell.css; jsdom does not apply stylesheets, so assert the
    // DOM contract that CSS relies on: heading + org share one container
    // with no truncation attributes.
    const context = container.querySelector(".sidebar-context");
    expect(context).not.toBeNull();
    expect(title.getAttribute("title")).toBeNull();
  });

  it("marks exactly one current-page link for an exact route", () => {
    render(<Navigation groups={groups} navigate={() => undefined} pathname="/admin/roster" />);
    const current = currentLinks();
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("href")).toBe("/admin/roster");
    expect(screen.getByRole("link", { name: "Roster(current)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("prefers the most specific nested match and never marks the parent", () => {
    render(
      <Navigation groups={groups} navigate={() => undefined} pathname="/admin/settings/modules" />,
    );
    const current = currentLinks();
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("href")).toBe("/admin/settings/modules");
    expect(screen.getByRole("link", { name: "Organization settings" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("matches nested roster detail routes to the roster destination", () => {
    render(
      <Navigation groups={groups} navigate={() => undefined} pathname="/admin/roster/detail" />,
    );
    expect(currentLinks().map((link) => link.getAttribute("href"))).toEqual(["/admin/roster"]);
  });

  it("renders text-first navigation without repetitive dots", () => {
    const { container } = render(
      <Navigation groups={groups} navigate={() => undefined} pathname="/admin" />,
    );
    expect(container.querySelectorAll(".workspace-nav__dot")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Admin overview(current)" })).toBeVisible();
  });

  it("preserves native behavior for modified and non-primary clicks", () => {
    const onNavigate = vi.fn();
    render(
      <AppLink href="/admin/roster" onNavigate={onNavigate}>
        Roster
      </AppLink>,
    );
    const link = screen.getByRole("link", { name: "Roster" });

    for (const eventInit of [
      { button: 1 },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ] as const) {
      const event = new MouseEvent("click", { bubbles: true, button: 0, ...eventInit });
      const prevented = !link.dispatchEvent(event);
      expect(prevented).toBe(false);
    }
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("/admin/roster");
  });

  it("filters module-gated destinations without exposing new routes", () => {
    const allHrefs = new Set(
      organizationGroups.flatMap((group) => group.items.map((item) => item.href)),
    );
    const modules: readonly ModuleState[] = [
      { category: "people", enabled: true, id: "roster", label: "Roster" },
      { category: "events", enabled: false, id: "events", label: "Events" },
    ];
    const visible = organizationGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => routeHasModule(item, modules)),
      }))
      .filter((group) => group.items.length > 0);
    const visibleHrefs = visible.flatMap((group) => group.items.map((item) => item.href));
    expect(visibleHrefs).not.toContain("/admin/events");
    expect(visibleHrefs).toContain("/admin/roster");
    for (const href of visibleHrefs) {
      expect(allHrefs.has(href)).toBe(true);
    }
  });

  it("keeps workspace navigation scoped to the active workspace", () => {
    const organization = workspaceNavigation("organization", organizationGroups, []);
    const account = workspaceNavigation("account", organizationGroups, []);
    expect(organization.flatMap((group) => group.items.map((item) => item.href))).toContain(
      "/admin/roster",
    );
    expect(account.flatMap((group) => group.items.map((item) => item.href))).not.toContain(
      "/admin/roster",
    );
  });
});
