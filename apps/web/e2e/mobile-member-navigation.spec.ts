import { expect, test } from "@playwright/test";
import { moduleIdSchema } from "@choir/contracts";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildSingerDashboardResponse } from "./fixtures/builders";
import { fulfillJson } from "./fixtures/session";

test.use({ serviceWorkers: "block" });

for (const theme of ["light", "dark"] as const) {
  test(`Member bottom menus, geometry, focus and desktop preferences in ${theme}`, async ({
    page,
  }, info) => {
    const api = await installOrganizationApi(page, {
      role: "member",
      modules: moduleIdSchema.options,
      strict: true,
    });
    api.setSingerDashboard(buildSingerDashboardResponse({ organizationName: "Alpha Choir" }));
    await page.addInitScript((value) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, value);
    }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/schedule");
    const bar = page.getByRole("navigation", { name: "Mobile Member navigation" });
    await expect(bar).toBeVisible();
    await expect(page.locator(".signed-in-sidebar")).toBeHidden();
    await expect(bar.getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const shot = async (name: string) => {
      const path = info.outputPath(`${name}-${theme}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await info.attach(name, { path, contentType: "image/png" });
    };
    await shot("schedule-closed");
    for (const width of [320, 375, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const bounds = await page.locator(".signed-in-body").boundingBox();
      expect(bounds?.x).toBe(0);
      for (const control of await bar.locator("a,button").all()) {
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("checkbox", { name: "Show past events" }).check();
    await page.evaluate(() => {
      window.scrollTo({ top: 160, behavior: "instant" });
    });
    const scroll = await page.evaluate(() => scrollY);
    const practice = bar.getByRole("button", { name: "Practice", exact: true });
    await practice.click();
    const dialog = page.getByRole("dialog", { name: "Practice & resources" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Practice", exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Resources" })).toBeVisible();
    expect((await dialog.boundingBox())?.height).toBeLessThan(450);
    await shot("practice-open");
    await dialog.getByRole("button", { name: "More", exact: true }).click();
    const more = page.getByRole("dialog", { name: "Your membership" });
    await expect(more).toBeVisible();
    await expect(more.getByRole("link", { name: "My Profile" })).toBeVisible();
    await expect(more.getByRole("link", { name: "Directory" })).toBeVisible();
    await expect(more.getByRole("link", { name: "Season dues" })).toBeVisible();
    await expect(more.getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await shot("more-open");
    // Focus stays in the modal, including its bottom controls.
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press("Tab");
      expect(await more.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(practice).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await expect(page.getByRole("checkbox", { name: "Show past events" })).toBeChecked();
    await practice.click();
    await page.locator(".dialog__overlay").click({ position: { x: 5, y: 5 } });
    await expect(more).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    const sidebar = page.locator(".signed-in-sidebar");
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("button", { name: "Collapse navigation" }).click();
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-navigation-mode",
      "compact",
    );
    await shot("desktop-compact");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await practice.click();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    await page.keyboard.press("Escape");
    // 200% zoom at 768px retains a supported >=320px effective layout.
    await page.setViewportSize({ width: 768, height: 844 });
    await page.evaluate(() => {
      document.body.style.zoom = "200%";
    });
    await practice.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeInViewport();
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
        .map((node) => `${node.tagName}.${node.className}`)
        .slice(0, 12),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      JSON.stringify(overflow),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.body.style.zoom = "";
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await practice.click();
    await page.setViewportSize({ width: 834, height: 600 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open workspace navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Open workspace navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(bar).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".signed-in-shell")).toHaveAttribute(
      "data-navigation-mode",
      "compact",
    );
    api.assertNoUnexpectedRequests();
  });
}

test("Member dirty Profile guards Home, Schedule and sheet destinations", async ({ page }) => {
  await installOrganizationApi(page, { role: "member", modules: moduleIdSchema.options });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/profile");
  const name = page.getByLabel("Display name", { exact: true });
  await expect(name).toBeVisible();
  await name.fill("Draft member name");
  const save = page.getByRole("region", { name: "Unsaved changes" });
  await expect(save).toBeVisible();
  const bar = page.getByRole("navigation", { name: "Mobile Member navigation" });
  const saveBounds = await save.boundingBox();
  const barBounds = await bar.boundingBox();
  if (!saveBounds || !barBounds) throw new Error("SaveBar and navigation must have bounds");
  expect(saveBounds.y + saveBounds.height).toBeLessThanOrEqual(barBounds.y);
  for (const destination of ["Home", "Schedule", "Directory"]) {
    await bar.getByRole("button", { name: "More" }).click();
    const more = page.getByRole("dialog", { name: "Your membership" });
    await more.getByRole("link", { name: destination, exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Leave with unsaved changes?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(more).toBeVisible();
    await expect(name).toHaveValue("Draft member name");
    await expect(page).toHaveURL(/\/profile$/);
    await page.keyboard.press("Escape");
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`Member resources-only projection omits empty controls in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((value) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, value);
    }, theme);
    await installOrganizationApi(page, { role: "administrator" });
    await page.route("**/api/organization/module-state", async (route) =>
      fulfillJson(route, {
        modules: moduleIdSchema.options.map((id) => ({ id, enabled: id === "resources" })),
      }),
    );
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/member/resources");
    const bar = page.getByRole("navigation", { name: "Mobile Member navigation" });
    await expect(bar.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Schedule" })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "More" })).toHaveCount(0);
    await bar.getByRole("button", { name: "Practice" }).click();
    const dialog = page.getByRole("dialog", { name: "Practice & resources" });
    await expect(dialog.getByRole("link", { name: "Resources" })).toBeVisible();
    await expect(dialog.locator('a[href^="/admin"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`resources-only-${theme}.png`) });
    await page.setViewportSize({ width: 667, height: 320 });
    await expect(dialog.getByRole("link", { name: "Resources" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeInViewport();
  });
}
