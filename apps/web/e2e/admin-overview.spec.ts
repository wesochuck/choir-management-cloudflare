import { moduleIdSchema } from "@choir/contracts";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fulfillJson } from "./fixtures/session";
import { installOrganizationApi } from "./fixtures/apiMocks";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

async function mockAdminOverviewApis(page: Page) {
  await installOrganizationApi(page, {
    modules: moduleIdSchema.options,
    role: "administrator",
  });

  await page.route("**/api/organization/dashboard-summary", async (route) => {
    await fulfillJson(route, {
      activeProfileCount: 88,
      doNotEmailCount: 1,
      nextEvents: [],
      recentBounceCount: 0,
      requestId: REQUEST_ID,
      upcomingEventCount: 8,
    });
  });

  await page.route("**/api/organization/auditions", async (route) => {
    await fulfillJson(route, {
      auditions: [
        {
          createdAt: "2026-10-01T00:00:00Z",
          email: "singer@example.com",
          id: "aud-1",
          name: "Test Singer",
          phone: "555-0100",
          requestedSlots: [],
          slots: [],
          status: "pending",
          updatedAt: "2026-10-01T00:00:00Z",
        },
      ],
      requestId: REQUEST_ID,
    });
  });
}

test.describe("Organization Admin Overview", () => {
  test("renders approved 3-column layout, prominent typography, and command search", async ({
    page,
  }) => {
    await mockAdminOverviewApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin");

    // Welcome hero banner
    const heading = page.locator("#admin-overview-greeting");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/Good (morning|afternoon|evening)/);

    // "Ready when you are." is removed from Admin Overview
    await expect(page.getByRole("heading", { name: "Ready when you are." })).toHaveCount(0);

    // Prominent search trigger
    const searchTrigger = page.locator(".admin-overview__search-trigger button");
    await expect(searchTrigger).toBeVisible();
    await expect(searchTrigger).toContainText("Search pages, tools, and features...");

    // Clicking search opens command palette
    await searchTrigger.click();
    await expect(page.locator(".command-palette-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".command-palette-modal")).not.toBeVisible();

    // Command palette opens with shortcut
    await page.keyboard.press("ControlOrMeta+KeyK");
    await expect(page.locator(".command-palette-modal")).toBeVisible();
    await page.keyboard.press("Escape");

    // 5 prominent KPI metrics in banner
    const kpiGrid = page.locator(".admin-overview__kpi-grid");
    await expect(kpiGrid).toBeVisible();
    await expect(kpiGrid.getByRole("link", { name: /88\s*Active Performers/i })).toBeVisible();
    await expect(kpiGrid.getByRole("link", { name: /8\s*Upcoming Events/i })).toBeVisible();
    await expect(kpiGrid.getByRole("link", { name: /1\s*Pending Inquiries/i })).toBeVisible();
    await expect(kpiGrid.getByRole("link", { name: /0\s*Recent Email Bounces/i })).toBeVisible();
    await expect(kpiGrid.getByRole("link", { name: /1\s*Email Disabled/i })).toBeVisible();

    // Quick actions
    const quickActions = page.locator(".admin-overview__quick-actions");
    await expect(quickActions).toBeVisible();
    await expect(quickActions.getByRole("link", { name: "Take Attendance" })).toHaveAttribute(
      "href",
      "/admin/attendance",
    );
    await expect(quickActions.getByRole("link", { name: "Send Announcement" })).toHaveAttribute(
      "href",
      "/admin/communications",
    );
    await expect(quickActions.getByRole("link", { name: "Add Performer" })).toHaveAttribute(
      "href",
      "/admin/roster?add=true",
    );
    await expect(quickActions.getByRole("link", { name: "New Event" })).toHaveAttribute(
      "href",
      "/admin/events?add=true",
    );
    await expect(quickActions.getByRole("link", { name: "Add Music" })).toHaveAttribute(
      "href",
      "/admin/library",
    );

    // Section headings & 3-column cards
    const peopleSection = page.locator(".admin-overview__section--green");
    await expect(peopleSection).toBeVisible();
    await expect(peopleSection.getByRole("heading", { name: "People & membership" })).toBeVisible();
    await expect(
      peopleSection.getByText("Profiles, communications, and supporter relationships"),
    ).toBeVisible();
    await expect(peopleSection.getByText("7 tools")).toBeVisible();

    // Verify 3 columns grid on desktop
    const cardsGrid = peopleSection.locator(".admin-overview__cards");
    const gridStyle = await cardsGrid.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.gridTemplateColumns.split(" ").length;
    });
    expect(gridStyle).toBe(3);

    // Verify card layout has icon alongside text (horizontally arranged)
    const firstCard = peopleSection.locator(".admin-overview__card").first();
    const cardFlex = await firstCard.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        display: style.display,
        flexDirection: style.flexDirection,
      };
    });
    expect(cardFlex.display).toBe("flex");
    expect(cardFlex.flexDirection).toBe("row");

    // Accessibility check
    const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
    const results = await axe.analyze();
    const blocking = results.violations.flatMap((violation) =>
      violation.nodes
        .filter(
          (node) =>
            (violation.impact === "serious" || violation.impact === "critical") &&
            !(
              violation.id === "color-contrast" &&
              `${node.target.join(" ")} ${node.html}`.includes("quick-search-kbd")
            ),
        )
        .map(
          (node) => `${violation.id} (${violation.impact ?? "unknown"}): ${node.target.join(" ")}`,
        ),
    );
    expect(blocking).toHaveLength(0);
  });

  test("maintains responsive 3 -> 2 -> 1 column flow without horizontal scroll", async ({
    page,
  }) => {
    await mockAdminOverviewApis(page);
    await page.goto("/admin");

    const breakpoints = [
      { cols: 3, width: 1440 },
      { cols: 2, width: 900 },
      { cols: 1, width: 375 },
      { cols: 1, width: 320 },
    ];

    for (const { cols, width } of breakpoints) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);

      // Verify no horizontal overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 1;
      });
      expect(overflow, `Horizontal overflow detected at ${String(width)}px`).toBe(false);

      // Verify card grid columns
      const peopleGrid = page.locator(".admin-overview__section--green .admin-overview__cards");
      const computedCols = await peopleGrid.evaluate((el) => {
        return window.getComputedStyle(el).gridTemplateColumns.split(" ").length;
      });
      expect(computedCols, `Expected ${String(cols)} columns at ${String(width)}px`).toBe(cols);

      // Verify typography readability at mobile
      if (width <= 480) {
        const titleFontSize = await page
          .locator(".admin-overview__card-title")
          .first()
          .evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
        const descFontSize = await page
          .locator(".admin-overview__card-description")
          .first()
          .evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));

        // Must remain readable on mobile (>=16px title, >=13.5px description)
        expect(titleFontSize).toBeGreaterThanOrEqual(16);
        expect(descFontSize).toBeGreaterThanOrEqual(13.5);
      }
    }
  });

  test("navigates on card click", async ({ page }) => {
    await mockAdminOverviewApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin");

    // Click Take Attendance card in Events & attendance
    const takeAttendanceCard = page
      .locator(".admin-overview__section--amber")
      .getByRole("link", { name: /Take Attendance/i });
    await takeAttendanceCard.click();
    await expect(page).toHaveURL(/\/admin\/attendance$/);
  });

  test("hides disabled modules across the sidebar and dashboard", async ({ page }) => {
    await mockAdminOverviewApis(page);
    const disabled = new Set([
      "auditions",
      "directory",
      "communications",
      "polls",
      "donations",
      "ticketing",
      "attendance",
      "resources",
      "public_website",
    ]);
    await page.route("**/api/organization/module-state", async (route) => {
      await fulfillJson(route, {
        modules: moduleIdSchema.options.map((id) => ({ id, enabled: !disabled.has(id) })),
      });
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "People & membership" })).toBeVisible();
    const overview = page.locator(".admin-overview");
    for (const path of [
      "/admin/auditions",
      "/directory",
      "/admin/communications",
      "/admin/polls",
      "/admin/donations",
      "/admin/tickets",
      "/admin/attendance",
      "/admin/resources",
      "/admin/website",
    ]) {
      await expect(overview.locator(`a[href^="${path}"]`)).toHaveCount(0);
      await expect(page.locator(`nav a[href="${path}"]`)).toHaveCount(0);
    }
    await expect(overview.getByRole("link", { name: "New Event" })).toBeVisible();
    await expect(overview.getByRole("link", { name: /Manage Roster/ })).toBeVisible();
    await expect(
      overview.getByRole("region", { name: "People & membership" }).getByText("1 tool"),
    ).toBeVisible();
    await expect(overview.getByText("Pending Inquiries")).toHaveCount(0);
    await expect(overview.getByText("Active Performers")).toBeVisible();
  });

  test("renders setup checklist guide when no operational modules are enabled", async ({
    page,
  }) => {
    await installOrganizationApi(page, {
      role: "administrator",
    });
    await page.route("**/api/organization/module-state", async (route) => {
      await fulfillJson(route, {
        modules: moduleIdSchema.options.map((id) => ({ id, enabled: false })),
      });
    });
    await page.goto("/admin");

    // Onboarding guide is shown
    await expect(
      page.getByRole("heading", { name: "Next steps for your organization" }),
    ).toBeVisible();
    await expect(page.getByText("Configure Modules", { exact: true })).toBeVisible();
    await expect(page.getByText("Complete Setup Checklist")).toBeVisible();
  });

  test("passes axe and keeps key visuals in dark theme", async ({ page }) => {
    await mockAdminOverviewApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin");
    await expect(page.locator("#admin-overview-greeting")).toBeVisible();
    await expect(page.locator(".admin-overview__kpi-grid")).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });

    // Hero keeps readable text on the dark gradient
    const banner = page.locator(".admin-overview__banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveCSS(
      "background-image",
      /linear-gradient.*rgb\(24, 66, 50\).*rgb\(35, 84, 64\)/i,
    );
    await expect(page.locator(".admin-overview__kpi-grid")).toBeVisible();
    await expect(
      page.locator(".admin-overview__section--green .admin-overview__card").first(),
    ).toBeVisible();

    const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
    const results = await axe.analyze();
    const blocking = results.violations.flatMap((violation) =>
      violation.nodes
        .filter(
          (node) =>
            (violation.impact === "serious" || violation.impact === "critical") &&
            !(
              violation.id === "color-contrast" &&
              `${node.target.join(" ")} ${node.html}`.includes("quick-search-kbd")
            ),
        )
        .map(
          (node) => `${violation.id} (${violation.impact ?? "unknown"}): ${node.target.join(" ")}`,
        ),
    );
    expect(blocking).toHaveLength(0);
  });

  test("wraps long display names and survives 125% root text scaling", async ({ page }) => {
    await installOrganizationApi(page, {
      modules: moduleIdSchema.options,
      role: "administrator",
      user: { name: "Alexandria Constantopoulos Papadopoulos-Smith" },
    });
    await page.route("**/api/organization/dashboard-summary", async (route) => {
      await fulfillJson(route, {
        activeProfileCount: 88,
        doNotEmailCount: 1,
        nextEvents: [],
        recentBounceCount: 0,
        requestId: REQUEST_ID,
        upcomingEventCount: 8,
      });
    });
    await page.route("**/api/organization/auditions", async (route) => {
      await fulfillJson(route, { auditions: [], requestId: REQUEST_ID });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin");

    const heading = page.locator("#admin-overview-greeting");
    await expect(heading).toContainText("Alexandria Constantopoulos Papadopoulos-Smith");
    // Metrics stay visible alongside the long greeting without overlap
    await expect(page.locator(".admin-overview__kpi-grid")).toBeVisible();

    // Simulate 125% browser text scaling via root font size
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 1;
    });
    expect(overflow, "Horizontal overflow at 125% root text scaling").toBe(false);
    await expect(heading).toBeVisible();
    await expect(page.locator(".admin-overview__kpi-grid")).toBeVisible();
  });
});
