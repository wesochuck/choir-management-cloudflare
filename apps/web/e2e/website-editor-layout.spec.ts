import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { publicWebsiteSettingsResponseSchema } from "@choir/contracts";
import { installOrganizationApi } from "./fixtures/apiMocks";

const settings = publicWebsiteSettingsResponseSchema.parse({
  aboutUsText: "",
  bodyFont: "system",
  contactEmail: "",
  enabledNavigation: [],
  headerFont: "system",
  heroFileId: null,
  heroHeadline: "Welcome to Our Choir",
  heroSubtitle: "Voices united in harmony.",
  historyText: "",
  logoFileId: null,
  organizationName: "Example Chorus",
  publicationVersion: 4,
  publishedAt: "2026-08-11T12:00:00.000Z",
  requestId: "11111111-1111-4111-8111-111111111111",
  showBrandingHeaderFooter: false,
  updatedAt: "2026-08-11T12:00:00.000Z",
});

for (const theme of ["light", "dark"] as const) {
  test(`website summary and editor tabs have room in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, mode);
    }, theme);
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.route("**/api/organization/website", (route) => route.fulfill({ json: settings }));
    await page.goto("/admin/website");
    const readiness = page.getByRole("region", { name: "Website publication readiness" });
    await expect(readiness).toContainText("Live version 4");
    await expect(readiness.getByText("About Us:", { exact: true })).toBeVisible();
    await expect(readiness.getByText("Contact email:", { exact: true })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Public website sections" });
    const home = tabs.getByRole("tab", { name: "Home", exact: true });
    await expect(home).toHaveAttribute("aria-selected", "true");
    for (const tab of await tabs.getByRole("tab").all()) {
      const box = await tab.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(40);
      expect(box?.width).toBeGreaterThanOrEqual(90);
    }
    await home.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "History", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: "Appearance", exact: true }).click();
    await expect(page.locator("#website-header-font")).toBeVisible();
    await tabs.getByRole("tab", { name: "Navigation", exact: true }).click();
    await home.click();
    await expect(page.locator("#website-hero-headline")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({ path: testInfo.outputPath("website-editor.png"), fullPage: true });
    const accessibility = await new AxeBuilder({ page })
      .include(".website-readiness")
      .include(".website-editor-controls")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    api.assertNoUnexpectedRequests();
  });
}
