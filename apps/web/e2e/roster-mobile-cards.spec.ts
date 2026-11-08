import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildOrganizationProfile } from "./fixtures/builders";

test.use({ serviceWorkers: "block" });

for (const theme of ["light", "dark"] as const) {
  test(`compact roster cards preserve selection, details and editing in ${theme}`, async ({
    page,
  }, info) => {
    const api = await installOrganizationApi(page, { role: "administrator" });
    await page.route("**/api/organization/members", async (route) => {
      await route.fulfill({
        json: {
          memberships: [],
          truncated: false,
          requestId: "99999999-9999-4999-8999-999999999999",
        },
      });
    });
    api.profiles.set([
      buildOrganizationProfile({ displayName: "Abby Tolliver", email: "", voicePart: "A1" }),
      buildOrganizationProfile({
        id: "22222222-1111-4111-8111-111111111111",
        displayName: "Jordan Lee",
        email: "jordan.lee@example.org",
        voicePart: "T2",
        doNotEmail: true,
      }),
      buildOrganizationProfile({
        id: "33333333-1111-4111-8111-111111111111",
        displayName: "Morgan Chen",
        email: "morgan.chen@example.org",
        voicePart: "S1",
        providerEmailSuppressed: true,
      }),
    ]);
    await page.addInitScript((value) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, value);
    }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/roster");
    const cards = page.locator(".roster-directory-panel .data-table-cards");
    const abby = cards.locator(".data-table-card").filter({ hasText: "Abby Tolliver" });
    const jordan = cards.locator(".data-table-card").filter({ hasText: "Jordan Lee" });
    const morgan = cards.locator(".data-table-card").filter({ hasText: "Morgan Chen" });
    await expect(abby).toContainText("No email");
    await expect(abby.locator(".roster-card-metadata")).toContainText("A1");
    await expect(
      abby.locator(".roster-card-details").getByText("Login account", { exact: true }),
    ).toBeHidden();
    await expect(jordan.getByText("Email blocked", { exact: true }).first()).toBeVisible();
    await expect(morgan.getByText("Email suppressed", { exact: true }).first()).toBeVisible();
    for (const width of [320, 390, 640]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const box = await abby.boundingBox();
      expect(box?.height).toBeLessThan(240);
      const edit = await abby.getByRole("button", { name: "Edit", exact: true }).boundingBox();
      expect(edit?.height).toBeGreaterThanOrEqual(44);
      expect(edit?.width).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await abby.getByRole("checkbox", { name: "Select Abby Tolliver", exact: true }).check();
    await expect(page.getByText("1 selected", { exact: false })).toBeVisible();
    await abby.getByRole("checkbox", { name: "Select Abby Tolliver", exact: true }).uncheck();
    const details = abby.locator("summary");
    await details.focus();
    await page.keyboard.press("Enter");
    await expect(
      abby.locator(".roster-card-details").getByText("Unlinked", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(
      abby.locator(".roster-card-details").getByText("Unlinked", { exact: true }),
    ).toBeHidden();
    await abby.evaluate((node) => {
      const headerBottom =
        document.querySelector(".signed-in-header")?.getBoundingClientRect().bottom ?? 0;
      window.scrollBy({
        top: node.getBoundingClientRect().top - headerBottom - 12,
        behavior: "instant",
      });
    });
    await page.screenshot({ path: info.outputPath(`roster-cards-${theme}.png`) });
    await morgan.locator("summary").click();
    await expect(
      morgan.locator(".roster-card-details").getByText("Unlinked", { exact: true }),
    ).toBeVisible();
    await morgan.evaluate((node) => {
      node.scrollIntoView({ block: "end", behavior: "instant" });
      window.scrollBy({ top: 80, behavior: "instant" });
    });
    const directoryBounds = await morgan
      .locator(".roster-card-details dl > div")
      .last()
      .boundingBox();
    const navBounds = await page
      .getByRole("navigation", { name: "Mobile workspace navigation" })
      .boundingBox();
    expect(directoryBounds).not.toBeNull();
    expect(navBounds).not.toBeNull();
    expect((directoryBounds?.y ?? 0) + (directoryBounds?.height ?? 0)).toBeLessThanOrEqual(
      navBounds?.y ?? 0,
    );
    await page.screenshot({ path: info.outputPath(`roster-details-${theme}.png`) });
    const audit = await new AxeBuilder({ page })
      .include(".roster-directory-panel .data-table-cards")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await abby.getByRole("button", { name: "More actions for Abby Tolliver" }).click();
    await page.getByRole("menuitem", { name: "Edit profile", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}
