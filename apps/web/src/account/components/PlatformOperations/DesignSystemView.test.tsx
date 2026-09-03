import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pageTitle, platformGroups } from "../AuthenticatedShell/utils";
import {
  DESIGN_SYSTEM_COLOR_TOKENS,
  DESIGN_SYSTEM_RADII,
  DESIGN_SYSTEM_SECTIONS,
  DESIGN_SYSTEM_SHADOWS,
  DESIGN_SYSTEM_SPACING,
  DESIGN_SYSTEM_TYPE_SCALE,
  DesignSystemView,
  filterAutocompleteOptions,
} from "./DesignSystemView";

describe("DesignSystemView", () => {
  it("renders every showcase section with anchor navigation", () => {
    const html = renderToString(<DesignSystemView />);
    expect(html).toContain("Design system");
    for (const section of DESIGN_SYSTEM_SECTIONS) {
      expect(html).toContain(section.label.replaceAll("&", "&amp;"));
      expect(html).toContain(section.href);
    }
    expect(html).toContain("Foundations");
    expect(html).toContain("Buttons &amp; actions");
    expect(html).toContain("Notices &amp; status");
    expect(html).toContain("Forms");
    expect(html).toContain("UI primitives");
    expect(html).toContain("Patterns");
  });

  it("exposes the shared token scales", () => {
    expect(DESIGN_SYSTEM_COLOR_TOKENS.map((token) => token.cssVar)).toContain("--color-primary");
    expect(DESIGN_SYSTEM_COLOR_TOKENS.map((token) => token.cssVar)).toContain("--color-accent");
    expect(DESIGN_SYSTEM_TYPE_SCALE.map((token) => token.cssVar)).toContain("--font-size-base");
    expect(DESIGN_SYSTEM_RADII.map((token) => token.cssVar)).toContain("--radius-control");
    expect(DESIGN_SYSTEM_SHADOWS.map((token) => token.cssVar)).toContain("--shadow-lg");
    expect(DESIGN_SYSTEM_SPACING.map((token) => token.cssVar)).toContain("--spacing-md");

    const html = renderToString(<DesignSystemView />);
    expect(html).toContain("var(--color-primary)");
    expect(html).toContain("var(--radius-control)");
    expect(html).toContain("var(--shadow-lg)");
    expect(html).toContain("var(--spacing-md)");
  });

  it("renders production button, notice, and form markers", () => {
    const html = renderToString(<DesignSystemView />);
    expect(html).toContain("button--primary");
    expect(html).toContain("button--secondary");
    expect(html).toContain("button--danger");
    expect(html).toContain("button--control-height");
    expect(html).toContain("notice--info");
    expect(html).toContain("notice--success");
    expect(html).toContain("notice--warning");
    expect(html).toContain("notice--error");
    expect(html).toContain("form-stack");
  });

  it("renders interactive primitive triggers without opening overlays", () => {
    const html = renderToString(<DesignSystemView />);
    expect(html).toContain("Open dialog");
    expect(html).toContain("Request destructive confirmation");
    expect(html).toContain("Sort by Name");
    expect(html).toContain("Sort by Voice part");
    expect(html).toContain("Open menu");
    expect(html).toContain("Open sheet");
    expect(html).toContain("Sample details");
    expect(html).toContain("Start typing…");
  });

  it("filters autocomplete options case-insensitively", () => {
    expect(filterAutocompleteOptions("").length).toBeGreaterThan(0);
    expect(filterAutocompleteOptions("sopr").map((option) => option.label)).toContain("Soprano");
    expect(filterAutocompleteOptions("ALTO").map((option) => option.label)).toContain("Alto");
    expect(filterAutocompleteOptions("no-such-part")).toEqual([]);
  });
});

describe("platform design-system route", () => {
  it("appears in platform navigation with the expected title", () => {
    const items = platformGroups.flatMap((group) => group.items);
    expect(items.map((item) => item.href)).toContain("/platform/design-system");
    expect(pageTitle("/platform/design-system")).toBe("Design system");
  });
});
