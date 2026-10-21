import { moduleIdSchema } from "@choir/contracts";
import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

for (const theme of ["light", "dark"] as const) {
  test(`Organization feature projections preserve ${theme} desktop/mobile appearance`, async ({
    page,
    isMobile,
  }, testInfo) => {
    await installOrganizationApi(page, { modules: moduleIdSchema.options, role: "administrator" });
    await page.clock.setFixedTime(new Date("2026-10-21T14:00:00Z"));
    await page.addInitScript((theme) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, theme);
    }, theme);
    await page.route("**/api/organization/dashboard-summary", async (route) => {
      await fulfillJson(route, {
        activeProfileCount: 88,
        doNotEmailCount: 1,
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
    await page.goto("/admin");
    await expect(page.locator(".admin-overview__card")).toHaveCount(22);
    await expect(page.locator(".admin-overview__kpi").first()).toContainText("88");
    await expect(page.locator(".admin-overview__kpi").nth(2)).toContainText("0");
    await expect(page.getByText("Loading Organization modules…")).toHaveCount(0);
    await page.mouse.move(0, 0);
    const save = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await testInfo.attach(name, { path, contentType: "image/png" });
    };
    await save(`overview-${theme}`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (isMobile) {
      await page.getByRole("button", { name: "Open workspace navigation" }).click();
      await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
      await save(`drawer-${theme}`);
    }
  });
}
