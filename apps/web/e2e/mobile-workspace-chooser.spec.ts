import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

for (const theme of ["light", "dark"] as const) {
  test(`mobile More switches authorized workspaces in ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !["127.0.0.1", "localhost"].includes(url.hostname)
      ) {
        errors.push(`Unexpected external request: ${url.origin}`);
        await route.abort();
        return;
      }
      await route.fallback();
    });
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.route("**/api/organization/dashboard-summary", async (route) => {
      await fulfillJson(route, {
        activeProfileCount: 2,
        doNotEmailCount: 0,
        nextEvents: [],
        recentBounceCount: 0,
        requestId: "11111111-1111-4111-8111-111111111111",
        upcomingEventCount: 0,
      });
    });
    await page.route("**/api/organization/auditions", async (route) => {
      await fulfillJson(route, {
        auditions: [],
        requestId: "11111111-1111-4111-8111-111111111111",
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, value);
    }, theme);
    await page.goto("/admin");
    const dropdown = page.getByRole("combobox", { name: "Workspace", exact: true });
    await expect(dropdown).toBeHidden();
    const bar = page.getByRole("navigation", { name: "Mobile workspace navigation" });
    await bar.getByRole("button", { name: "More", exact: true }).click();
    let more = page.getByRole("dialog", { name: "More", exact: true });
    const chooser = more.getByRole("region", { name: "Switch workspace" });
    await expect(chooser.getByRole("button", { name: /Organization Admin/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(chooser.getByRole("button", { name: /Platform Admin/ })).toHaveCount(0);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await chooser
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
          ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const audit = await new AxeBuilder({ page }).include(".mobile-bottom-sheet").analyze();
    expect(
      audit.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`workspace-more-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(bar.getByRole("button", { name: "More", exact: true })).toBeFocused();
    await bar.getByRole("button", { name: "More", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".mobile-bottom-sheet")).toHaveCount(0);
    await expect(dropdown).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await bar.getByRole("button", { name: "More", exact: true }).click();
    more = page.getByRole("dialog", { name: "More", exact: true });
    await more.getByRole("button", { name: /Member workspace/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("dialog", { name: "More", exact: true })).toHaveCount(0);
    const memberBar = page.getByRole("navigation", { name: "Mobile Member navigation" });
    await memberBar.getByRole("button", { name: "More", exact: true }).click();
    more = page.getByRole("dialog", { name: "More", exact: true });
    await expect(more.getByRole("button", { name: /Member workspace/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await more.getByRole("button", { name: /^Account/ }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .locator(".signed-in-header")
      .getByRole("button", { name: "More", exact: true })
      .click();
    more = page.getByRole("dialog", { name: "More", exact: true });
    await expect(more.getByRole("button", { name: /^Account/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(more).toHaveCount(0);
    await expect(dropdown).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator(".signed-in-header")
      .getByRole("button", { name: "More", exact: true })
      .click();
    await more.getByRole("button", { name: /Organization Admin/ }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(dropdown).toBeVisible();
    await expect(dropdown).toHaveValue("organization");
    await dropdown.selectOption("member");
    await expect(page).toHaveURL(/\/dashboard$/);
    // Exercise zoom in a separate final state; normal-size journeys above also
    // cover the background page, while this check targets the modal's controls.
    await page.goto("/admin/contacts");
    await page.setViewportSize({ width: 768, height: 844 });
    await bar.getByRole("button", { name: "More", exact: true }).click();
    await page.evaluate(() => {
      document.body.style.zoom = "200%";
    });
    more = page.getByRole("dialog", { name: "More", exact: true });
    await expect(more.getByRole("button", { name: "Close More", exact: true })).toBeInViewport();
    expect(await more.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    expect(
      await page
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        ),
    ).toBe(true);
    api.assertNoUnexpectedRequests();
  });
}

test("Member More does not offer unapproved administrative workspaces", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "member", strict: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page
    .getByRole("navigation", { name: "Mobile Member navigation" })
    .getByRole("button", { name: "More" })
    .click();
  const more = page.getByRole("dialog", { name: "More", exact: true });
  await expect(more.getByRole("button", { name: /Organization Admin|Platform Admin/ })).toHaveCount(
    0,
  );
  await expect(more.getByRole("button", { name: /^Account/ })).toBeVisible();
  api.assertNoUnexpectedRequests();
});
