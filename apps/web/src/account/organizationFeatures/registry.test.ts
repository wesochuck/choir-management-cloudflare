import { describe, expect, it } from "vitest";
import { moduleIdSchema } from "@choir/contracts";
import { renderOrganizationPage } from "../components/AuthenticatedShell/workspacesUtils";
import baseline from "./baseline.json";
import { organizationFeatures, organizationPaletteShortcuts } from "./registry";
import { organizationFeatureIcons } from "./icons";
import {
  getAdminFeatureForPath,
  getOrganizationDashboardSections,
  getOrganizationPaletteEntries,
  getOrganizationQuickActions,
  getOrganizationSidebarGroups,
} from "./selectors";
import { normalizeOrganizationTerminology } from "../organizationTerminologyUtils";
import { paletteEligibility } from "../components/CommandPalette/eligibility";
import type { OrganizationFeatureContext } from "./types";

const ready: OrganizationFeatureContext = { status: "ready", modules: [], isOwner: true };
const allHrefs = (context: OrganizationFeatureContext) => ({
  sidebar: getOrganizationSidebarGroups(context).flatMap((g) => g.items.map((i) => i.href)),
  dashboard: getOrganizationDashboardSections(context).flatMap((g) => g.cards.map((i) => i.href)),
  actions: getOrganizationQuickActions(context).map((i) => i.href),
  palette: getOrganizationPaletteEntries(context).map((i) => i.href),
});
describe("Organization feature registry characterization", () => {
  it("derives the approved shared groups and full primary-feature parity", () => {
    const sidebar = getOrganizationSidebarGroups(ready);
    const dashboard = getOrganizationDashboardSections(ready);
    expect(sidebar.flatMap((g) => g.items)).toHaveLength(25);
    expect(dashboard.map((g) => g.cards.length)).toEqual([5, 5, 4, 2, 4, 2]);
    expect(sidebar.slice(1).map((g) => [g.id, g.label])).toEqual(
      dashboard.map((g) => [g.id, g.label]),
    );
    expect(
      sidebar.find((group) => group.id === "communications")?.items.map((item) => item.featureId),
    ).toEqual(["communications", "polls"]);
    expect(
      sidebar.find((group) => group.id === "finance")?.items.map((item) => item.featureId),
    ).toEqual(["ticketing", "donations", "seasons-dues"]);
    const byId = new Map(organizationFeatures.map((f) => [f.id, f]));
    for (const context of [
      ready,
      { ...ready, status: "loading" as const },
      { ...ready, status: "error" as const },
      ...moduleIdSchema.options.map((id) => ({ ...ready, modules: [{ id, enabled: false }] })),
      { ...ready, modules: moduleIdSchema.options.map((id) => ({ id, enabled: false })) },
    ]) {
      const links = getOrganizationSidebarGroups(context)
        .flatMap((g) => g.items)
        .filter((item) => item.featureId && !byId.get(item.featureId)?.coverageReason);
      const cards = getOrganizationDashboardSections(context)
        .flatMap((g) => g.cards)
        .filter((card) => !byId.get(card.featureId)?.coverageReason);
      expect(links.map((item) => item.featureId).toSorted()).toEqual(
        cards.map((card) => card.featureId).toSorted(),
      );
      const icons = new Map(cards.map((card) => [card.featureId, card.iconId]));
      for (const link of links)
        expect(link.iconId).toBe(link.featureId ? icons.get(link.featureId) : undefined);
      for (const action of getOrganizationQuickActions(context))
        expect(action.iconId).toBe(byId.get(action.featureId)?.iconId);
    }
    expect(getOrganizationQuickActions(ready).map(({ href, label }) => ({ href, label }))).toEqual(
      baseline.actions.map(({ href, label }) => ({
        href,
        label: label === "Add performer" ? "Add Performer" : label,
      })),
    );
    for (const id of ["contacts", "membership-invitations", "seasons-dues", "reports"])
      expect(organizationFeatures.find((f) => f.id === id)?.iconId).not.toBe("settings");
  });
  it("has unique identities, explicit surface coverage and valid module/icon references", () => {
    expect(new Set(organizationFeatures.map((f) => f.id)).size).toBe(organizationFeatures.length);
    expect(new Set(organizationFeatures.map((f) => f.href)).size).toBe(organizationFeatures.length);
    const ids = [
      ...organizationFeatures.flatMap((f) => (f.palette ? [f.palette.id] : [])),
      ...organizationPaletteShortcuts.map((s) => s.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of organizationFeatures) {
      if (f.requiredModule) expect(moduleIdSchema.safeParse(f.requiredModule).success).toBe(true);
      expect(organizationFeatureIcons[f.iconId]).toBeTruthy();
      expect(f.dashboard ?? f.coverageReason).toBeTruthy();
    }
    expect(organizationFeatures.some((f) => f.requiredModule === "practice_player")).toBe(false);
    expect(
      organizationFeatures.filter((f) => f.coverageReason === "configuration").map((f) => f.id),
    ).toEqual(["modules", "setup-checklist", "organization-security"]);
    expect(
      organizationFeatures.filter((f) => f.coverageReason === "landing").map((f) => f.id),
    ).toEqual(["admin-overview"]);
    expect(
      organizationFeatures.filter((f) => f.coverageReason === "contextual").map((f) => f.id),
    ).toEqual(["patrons-dashboard"]);
  });
  it("preserves static palette IDs/copy/order and only adds Contacts and Reports", () => {
    const original = baseline.palette.filter(
      (p) => p.category !== "actions" && !("workspaces" in p),
    );
    const actual = getOrganizationPaletteEntries(ready);
    expect(actual.map((p) => p.id)).toEqual([
      ...original.map((p) => p.id),
      "nav-contacts",
      "nav-reports",
    ]);
    for (const old of original) {
      const item = actual.find((p) => p.id === old.id);
      expect(item?.title).toBe(old.id === "nav-admin-overview" ? "Dashboard" : old.title);
      if (old.id === "nav-admin-overview") expect(item?.subtitle).toContain("Admin Overview");
      else expect(item?.subtitle).toBe(old.subtitle);
    }
    expect(actual.find((p) => p.id === "nav-website")?.requiredModule).toBe("public_website");
    expect(actual.find((p) => p.id === "set-roster-automation")?.href).toBe(
      "/admin/roster?section=settings",
    );
  });
  it.each([
    "roster",
    "directory",
    "donations",
    "polls",
    "reports",
    "public_website",
    "music_library",
  ] as const)("filters %s independently on every surface", (id) => {
    const context = { ...ready, modules: [{ id, enabled: false }] };
    const disabled = new Set(
      organizationFeatures.filter((f) => f.requiredModule === id).map((f) => f.href),
    );
    const result = allHrefs(context);
    expect(result.sidebar.every((href) => !disabled.has(href.split("?")[0] ?? href))).toBe(true);
    expect(result.dashboard.every((href) => !disabled.has(href))).toBe(true);
    expect(result.palette.every((href) => !href || !disabled.has(href.split("?")[0] ?? href))).toBe(
      true,
    );
    expect(result.sidebar).toContain("/admin/contacts");
    expect(result.sidebar).toContain("/admin/settings/modules");
    if (id !== "polls") expect(result.sidebar).toContain("/admin/polls");
    if (id !== "donations") expect(result.dashboard).toContain("/admin/donations?view=patrons");
  });
  it.each(["loading", "error"] as const)(
    "withholds gated shortcuts during %s and keeps module-independent destinations",
    (status) => {
      const result = allHrefs({ ...ready, status });
      expect(result.sidebar).toContain("/admin/contacts");
      expect(result.sidebar).toContain("/admin/settings/modules");
      expect(result.sidebar).not.toContain("/admin/roster");
      expect(result.actions).toEqual([]);
      expect(result.dashboard).toEqual(["/admin/contacts", "/admin/settings"]);
      expect(allHrefs(ready).sidebar).toContain("/admin/roster");
    },
  );
  it.each([
    ["/admin/music", "music-library"],
    ["/admin/music/settings", "music-library"],
    ["/admin/music/folders", "music-library"],
    ["/admin/donations?view=patrons&range=all", "patrons-dashboard"],
    ["/admin/library/settings", "music-library"],
    ["/admin/ticketing", "ticketing"],
    ["/admin/tickets/scan", "ticketing"],
    ["/admin/patrons?period=all", "donations"],
    ["/admin/invitations", "membership-invitations"],
    ["/admin/communications/polls", "polls"],
    ["/directory?from=admin", "directory"],
    ["/admin/reports?tab=music-folders", "reports"],
  ])("resolves alias/nested %s to %s", (path, id) => {
    expect(getAdminFeatureForPath(path)?.id).toBe(id);
  });
  it("keeps bare Directory member-scoped and unknown routes unmatched", () => {
    expect(getAdminFeatureForPath("/directory")).toBeUndefined();
    expect(getAdminFeatureForPath("/admin/unknown")).toBeUndefined();
    expect(getAdminFeatureForPath("/admin/roster-unknown")).toBeUndefined();
  });
  it("uses one terminology normalization and preserves stable IDs/URLs", () => {
    const custom = {
      ...ready,
      ...normalizeOrganizationTerminology(" Chorister ", "sections_only"),
    };
    const cards = getOrganizationDashboardSections(custom).flatMap((g) => g.cards);
    expect(cards.find((c) => c.href === "/directory")?.label).toBe("Chorister Directory");
    expect(cards.find((c) => c.href === "/admin/resources")?.description).toBe(
      "Upload documents and links for choristers",
    );
    expect(getOrganizationQuickActions(custom)[2]?.label).toBe("Add Chorister");
    expect(
      getOrganizationPaletteEntries(custom).find((p) => p.id === "set-roster-automation")?.title,
    ).toBe("Roster Automation & Sections Config");
    expect(getOrganizationPaletteEntries(custom).map((p) => [p.id, p.href])).toEqual(
      getOrganizationPaletteEntries(ready).map((p) => [p.id, p.href]),
    );
  });
  it("retains Owner restrictions and scoped Platform overview only", () => {
    expect(
      getOrganizationPaletteEntries({ ...ready, isOwner: false }).some(
        (p) => p.id === "set-payment",
      ),
    ).toBe(false);
    expect(
      getOrganizationSidebarGroups({ ...ready, scopedReadOnly: true })
        .flatMap((g) => g.items)
        .map((i) => i.href),
    ).toEqual(["/admin"]);
    expect(getOrganizationPaletteEntries({ ...ready, scopedReadOnly: true })).toEqual([]);
  });
  it("filters cached entity/static recents without deleting history and refreshes registered titles", () => {
    const entries = [
      {
        id: "nav-music",
        category: "navigation" as const,
        href: "/admin/library",
        title: "Old title",
        timestamp: 1,
      },
      {
        id: "music-1",
        category: "music" as const,
        href: "/admin/library?piece=1",
        title: "Piece",
        timestamp: 1,
      },
      {
        id: "set-payment",
        category: "settings" as const,
        href: "/admin/settings#payment",
        title: "Payment",
        timestamp: 1,
      },
    ];
    const off = paletteEligibility("organization", [], false, {
      ...ready,
      modules: [{ id: "music_library", enabled: false }],
    });
    expect(entries.filter(off.allowed)).toEqual([]);
    const on = paletteEligibility("organization", [], true, ready);
    expect(entries.filter(on.allowed)).toHaveLength(3);
    expect(
      on.resolveRecent(
        entries[0] ?? { id: "missing", category: "navigation", title: "missing", timestamp: 1 },
      ).title,
    ).toBe("Music Library");
    expect(entries[0]?.title).toBe("Old title");
    expect(
      paletteEligibility("member", [], false, ready).allowed(
        entries[0] ?? { id: "missing", category: "navigation", title: "missing", timestamp: 1 },
      ),
    ).toBe(false);
  });
});

it("keeps every registered canonical route and alias attached to an existing dispatcher destination", () => {
  for (const feature of organizationFeatures) {
    for (const href of [feature.href, ...(feature.aliases ?? [])]) {
      const url = new URL(href, "https://registry.invalid");
      if (url.pathname === "/directory") continue; // Existing member destination, explicit admin return query in sidebar.
      const result = renderOrganizationPage(
        { pathname: url.pathname, search: url.search },
        true,
        true,
        () => undefined,
        () => "missing registry route",
      );
      expect(result, href).not.toBe("missing registry route");
    }
  }
});
