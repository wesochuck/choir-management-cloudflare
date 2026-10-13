import { describe, expect, it } from "vitest";

import { parseQuery } from "./useAdminSearch";

describe("parseQuery", () => {
  it("parses empty and plain queries", () => {
    expect(parseQuery("")).toEqual({ cleanTerm: "", prefix: null, scopedCategory: null });
    expect(parseQuery("rehearsal")).toEqual({
      cleanTerm: "rehearsal",
      prefix: null,
      scopedCategory: null,
    });
  });

  it("parses prefix shortcuts correctly", () => {
    expect(parseQuery("roster: smith")).toEqual({
      cleanTerm: "smith",
      prefix: "roster",
      scopedCategory: "roster",
    });
    expect(parseQuery("events: winter concert")).toEqual({
      cleanTerm: "winter concert",
      prefix: "events",
      scopedCategory: "events",
    });
    expect(parseQuery("music: handel")).toEqual({
      cleanTerm: "handel",
      prefix: "music",
      scopedCategory: "music",
    });
    expect(parseQuery("settings: dues")).toEqual({
      cleanTerm: "dues",
      prefix: "settings",
      scopedCategory: "settings",
    });
    expect(parseQuery("actions: create")).toEqual({
      cleanTerm: "create",
      prefix: "actions",
      scopedCategory: "actions",
    });
  });
});

import { staticNavigationItems } from "./navigationIndex";

describe("staticNavigationItems workspace scoping", () => {
  it("restricts member workspace to member routes and actions only", () => {
    const memberItems = staticNavigationItems.filter((item) => {
      const workspaces = item.workspaces ?? ["organization"];
      return workspaces.includes("member");
    });

    // None of the member items should have admin paths
    expect(memberItems.every((item) => !item.href?.startsWith("/admin"))).toBe(true);

    const hrefs = memberItems.map((item) => item.href).filter(Boolean);
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).toContain("/schedule");
    expect(hrefs).toContain("/profile");
    expect(hrefs).toContain("/directory");
    expect(hrefs).toContain("/dues");
    expect(hrefs).toContain("/practice");
    expect(hrefs).toContain("/member/resources");

    // Searching 'ticket' in member workspace matches nothing
    const ticketInMember = memberItems.filter((item) => {
      const text = `${item.title} ${item.subtitle ?? ""}`.toLowerCase();
      return text.includes("ticket");
    });
    expect(ticketInMember).toEqual([]);

    // Theme toggle is available in member workspace
    const themeAction = memberItems.find((item) => item.id === "act-toggle-theme");
    expect(themeAction).toBeDefined();
  });

  it("includes admin routes in organization workspace", () => {
    const orgItems = staticNavigationItems.filter((item) => {
      const workspaces =
        item.workspaces ?? (item.href?.startsWith("/admin") ? ["organization"] : ["organization"]);
      return workspaces.includes("organization");
    });

    const ticketInOrg = orgItems.filter((item) => item.id === "nav-ticketing");
    expect(ticketInOrg).toHaveLength(1);
    expect(ticketInOrg[0]?.href).toBe("/admin/tickets");
  });
});
