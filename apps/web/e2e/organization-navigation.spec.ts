import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { moduleIdSchema } from "@choir/contracts";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildSingerDashboardResponse } from "./fixtures/builders";
import { fulfillJson } from "./fixtures/session";

// These mocked API journeys reload the shell. Block SW interception so WebKit
// continues through Playwright's route fixtures instead of the unrelated local Worker.
test.use({ serviceWorkers: "block" });

for (const theme of ["dark", "light"] as const) {
  test(`Organization accordion, rail and mobile drawer in ${theme} @webkit-smoke`, async ({
    page,
  }, info) => {
    await installOrganizationApi(page, { role: "owner", modules: moduleIdSchema.options });
    await page.route("**/api/organization/dashboard-summary", async (route) => {
      await fulfillJson(route, {
        activeProfileCount: 88,
        doNotEmailCount: 0,
        nextEvents: [],
        recentBounceCount: 0,
        upcomingEventCount: 8,
        requestId: "11111111-1111-4111-8111-111111111111",
      });
    });
    await page.route("**/api/organization/auditions", async (route) => {
      await fulfillJson(route, {
        auditions: [],
        requestId: "11111111-1111-4111-8111-111111111111",
      });
    });
    await page.addInitScript((theme) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, theme);
    }, theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin");
    await expect(page.locator(".admin-overview__card")).toHaveCount(22);
    const sidebar = page.locator(".signed-in-sidebar");
    await expect(
      sidebar.getByRole("button", { name: "People & membership", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      sidebar.getByRole("button", { name: "Events & attendance", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
    await expect(sidebar.locator(".sidebar-context")).toHaveCount(0);
    await expect(page.locator(".signed-in-header__brand > a")).toHaveCount(1);
    await sidebar.getByRole("button", { name: "Events & attendance", exact: true }).click();
    await expect(
      sidebar.getByRole("button", { name: "People & membership", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    const shot = async (name: string) => {
      const path = info.outputPath(`${name}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await info.attach(name, { path, contentType: "image/png" });
    };
    await shot(`expanded-${theme}`);
    await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Expand navigation", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-organization-navigation",
      "compact",
    );

    const people = sidebar.getByRole("button", { name: "People & membership", exact: true });
    await expect(people).toBeVisible();
    await people.click();
    const popup = page.locator(".organization-nav__flyout:popover-open");
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
    const rect = await popup.boundingBox();
    expect(rect).not.toBeNull();
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(1440);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(people).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(popup).toBeVisible();
    await page.locator("#admin-overview-greeting").click();
    await expect(popup).toHaveCount(0);
    await people.focus();
    await page.keyboard.press("Space");
    await expect(popup).toBeVisible();
    await popup.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/contacts$/);
    await expect(popup).toHaveCount(0);

    // The sidebar remains compact after flyout navigation. Clicking the rail background expands it.
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-organization-navigation",
      "compact",
    );
    await page.locator(".signed-in-sidebar").click({ position: { x: 20, y: 600 } });
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-organization-navigation",
      "expanded",
    );

    await sidebar.getByRole("link", { name: /^Dashboard/ }).click();
    await expect(page.locator(".admin-overview__card")).toHaveCount(22);

    await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
    await shot(`compact-${theme}`);
    await sidebar.getByRole("button", { name: "Quick search", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command Palette" })).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-organization-navigation",
      "compact",
    );
    await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
    await expect(
      sidebar.getByRole("button", { name: "Events & attendance", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 375, height: 812 });
    // Verify phone viewport reclaims full content width (no persistent rail)
    await expect(page.locator(".signed-in-sidebar")).toBeHidden();
    const bottomNav = page.locator(".mobile-bottom-nav:not(.mobile-bottom-nav--in-sheet)");
    await expect(bottomNav).toBeVisible();

    // Verify touch targets >= 44x44px for the 4 bottom controls
    for (const name of ["Home", "People", "Events", "More"]) {
      const btn = bottomNav.getByRole("button", { name, exact: true });
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    await shot(`mobile-nav-bar-${theme}`);

    // Tap People to open bottom sheet
    await bottomNav.getByRole("button", { name: "People", exact: true }).click();
    const peopleSheet = page.getByRole("dialog");
    await expect(peopleSheet).toBeVisible();
    await expect(peopleSheet.getByRole("heading", { name: "People & membership" })).toBeVisible();
    await shot(`people-sheet-${theme}`);

    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const sheetBox = await peopleSheet.boundingBox();
      expect(sheetBox).not.toBeNull();
      expect(sheetBox?.width).toBe(width);
      expect((sheetBox?.y ?? 0) + (sheetBox?.height ?? 0)).toBe(812);

      const target = await peopleSheet
        .getByRole("link", { name: "Contacts", exact: true })
        .boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }

    // Navigate to Contacts via sheet link
    await peopleSheet.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(peopleSheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin\/contacts$/);
    await expect(page.locator(".signed-in-sidebar")).toBeHidden();
    await expect(bottomNav.getByRole("button", { name: "People", exact: true })).toHaveAttribute(
      "data-active",
      "true",
    );

    // Open Events sheet and check switching to More from within sheet footer
    await bottomNav.getByRole("button", { name: "Events", exact: true }).click();
    const eventsSheet = page.getByRole("dialog");
    await expect(eventsSheet).toBeVisible();
    await expect(eventsSheet.getByRole("heading", { name: "Events & attendance" })).toBeVisible();
    await shot(`events-sheet-${theme}`);

    // Switch to More directly from sheet footer
    await eventsSheet.locator('.mobile-bottom-nav--in-sheet button[aria-label="More"]').click();
    const moreSheet = page.getByRole("dialog");
    await expect(moreSheet.getByRole("heading", { name: "More" })).toBeVisible();
    await shot(`more-sheet-${theme}`);

    // Drill into Music & content category
    await moreSheet.getByRole("button", { name: /Music & content/ }).click();
    await expect(moreSheet.getByRole("heading", { name: "Music & content" })).toBeVisible();
    await expect(moreSheet.getByRole("button", { name: "Back to More" })).toBeVisible();
    await shot(`more-category-${theme}`);

    // Back to More categories
    await moreSheet.getByRole("button", { name: "Back to More" }).click();
    await expect(moreSheet.getByRole("heading", { name: "More" })).toBeVisible();

    // Dismiss sheet via close button
    await moreSheet.getByRole("button", { name: "Close More" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Axe audit on mobile bottom nav
    const audit = await new AxeBuilder({ page })
      .include(".mobile-bottom-nav")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      audit.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`reduced modules preserve parity and empty-group filtering in ${theme} @webkit-smoke`, async ({
    page,
  }, info) => {
    await installOrganizationApi(page, { role: "administrator" });
    const enabled = new Set(["roster", "events", "music_library", "public_website"]);
    await page.route("**/api/organization/module-state", async (route) => {
      await fulfillJson(route, {
        modules: moduleIdSchema.options.map((id) => ({ id, enabled: enabled.has(id) })),
      });
    });
    await page.route("**/api/organization/dashboard-summary", async (route) => {
      await fulfillJson(route, {
        activeProfileCount: 88,
        doNotEmailCount: 0,
        nextEvents: [],
        recentBounceCount: 0,
        upcomingEventCount: 8,
        requestId: "11111111-1111-4111-8111-111111111111",
      });
    });
    await page.addInitScript((theme) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, theme);
    }, theme);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/admin");
    await expect(page.locator(".admin-overview__card")).toHaveCount(7);
    await page.getByRole("button", { name: "Open workspace navigation" }).click();
    const nav = page.getByRole("dialog", { name: "Workspace navigation" }).getByRole("navigation");
    await expect(nav.getByRole("button", { name: "Communications", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Finance", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
    await expect(page.locator('.admin-overview__cards a[href="/admin/contacts"]')).toBeVisible();
    await expect(
      page.locator('.admin-overview__cards a[href="/admin/settings/invitations"]'),
    ).toBeVisible();
    await expect(page.locator('.admin-overview__cards a[href="/admin/reports"]')).toHaveCount(0);
    const path = info.outputPath(`reduced-${theme}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await info.attach(`reduced-${theme}`, { path, contentType: "image/png" });
    await nav.getByRole("button", { name: "Music & content", exact: true }).click();
    await expect(nav.locator('a[href="/admin/library"] svg')).toHaveAttribute(
      "data-feature-icon",
      "music",
    );
    await expect(
      page.locator('.admin-overview__cards a[href="/admin/library"] svg'),
    ).toHaveAttribute("data-feature-icon", "music");
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`Member workspace expanded and compact rail navigation in ${theme} @webkit-smoke`, async ({
    page,
  }, info) => {
    const api = await installOrganizationApi(page, {
      modules: moduleIdSchema.options,
      role: "member",
    });
    api.setSingerDashboard(
      buildSingerDashboardResponse({
        organizationName: "Test Chorus",
      }),
    );
    await page.addInitScript((theme) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, theme);
    }, theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/dashboard");

    const sidebar = page.locator(".signed-in-sidebar");
    await expect(sidebar.getByRole("link", { name: /^Dashboard/ })).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "Your membership", exact: true }),
    ).toBeVisible();

    const shot = async (name: string) => {
      const path = info.outputPath(`${name}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await info.attach(name, { path, contentType: "image/png" });
    };

    await shot(`member-expanded-${theme}`);

    await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Expand navigation", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-navigation-mode",
      "compact",
    );
    await shot(`member-compact-${theme}`);

    const memberBtn = sidebar.getByRole("button", {
      name: "Your membership",
      exact: true,
    });
    await expect(memberBtn).toBeVisible();
    await memberBtn.click();
    const popup = page.locator(".organization-nav__flyout:popover-open");
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("link", { name: "My schedule", exact: true })).toBeVisible();

    await popup.getByRole("link", { name: "My schedule", exact: true }).click();
    await expect(page).toHaveURL(/\/schedule$/);
    await expect(popup).toHaveCount(0);

    // The sidebar remains compact after flyout navigation. Clicking the rail background expands it.
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-navigation-mode",
      "compact",
    );
    await page.locator(".signed-in-sidebar").click({ position: { x: 20, y: 350 } });
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-navigation-mode",
      "expanded",
    );

    await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
    await page.reload();
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-navigation-mode",
      "compact",
    );

    await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-navigation-mode",
      "expanded",
    );
  });
}
