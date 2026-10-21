import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { moduleIdSchema } from "@choir/contracts";
import { installOrganizationApi } from "./fixtures/apiMocks";
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
    const people = sidebar.getByRole("button", { name: "People & membership", exact: true });
    await people.focus();
    await page.keyboard.press("Enter");
    const popup = page.locator(".organization-nav__flyout:popover-open");
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
    const rect = await popup.boundingBox();
    expect(rect).not.toBeNull();
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(1440);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(people).toBeFocused();
    await people.click();
    await expect(popup).toBeVisible();
    await page.locator("#admin-overview-greeting").click();
    await expect(popup).toHaveCount(0);
    await people.focus();
    await page.keyboard.press("Space");
    await expect(popup).toBeVisible();
    await popup.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/contacts$/);
    await expect(popup).toHaveCount(0);
    await sidebar.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.locator(".admin-overview__card")).toHaveCount(22);
    await shot(`compact-${theme}`);
    await sidebar.getByRole("button", { name: "Quick search", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible();
    await page.keyboard.press("Escape");
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
    await page.getByRole("button", { name: "Open workspace navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(".organization-nav--compact")).toHaveCount(0);
    await expect(drawer.locator(".sidebar-context")).toHaveCount(0);
    await shot(`drawer-${theme}`);
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const target = await drawer
        .getByRole("link", { name: "Contacts", exact: true })
        .boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }

    await drawer.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin\/contacts$/);
    await page.getByRole("button", { name: "Open workspace navigation" }).click();
    await expect(drawer.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(drawer.getByRole("link", { name: "Contacts", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const audit = await new AxeBuilder({ page })
      .include(".sheet .organization-nav")
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
    const nav = page.locator(".signed-in-sidebar").getByRole("navigation");
    await expect(
      nav.getByRole("button", { name: "Communications & finance", exact: true }),
    ).toHaveCount(0);
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
