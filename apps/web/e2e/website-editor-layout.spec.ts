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

for (const theme of ["light", "dark"] as const) {
  test(`edits and saves Organization footer embeds in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, mode);
    }, theme);
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    let saved = settings;
    await page.route("**/api/organization/website", async (route) => {
      if (route.request().method() === "PUT")
        saved = publicWebsiteSettingsResponseSchema.parse({
          ...settings,
          ...route.request().postDataJSON(),
        });
      await route.fulfill({ json: saved });
    });
    await page.route("https://widgets.example.test/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="silver"/><text x="30" y="75">Silver Seal</text></svg>',
      }),
    );
    await page.route("https://partner.example.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>Community partner</title></head><body><main><h1>Partner widget</h1></main></body></html>',
      }),
    );
    await page.goto("/admin/website");
    await page.getByRole("tab", { name: "Footer", exact: true }).click();
    await page
      .getByLabel("Footer text (Markdown)", { exact: true })
      .fill("**Supported by our community**");
    await page
      .getByLabel("Import embed code", { exact: true })
      .fill(
        '<a href="https://app.candid.org/profile/123"><img src="https://widgets.example.test/seal.svg" alt="Our silver seal"></a><iframe src="https://partner.example.test/widget" title="Community partner"></iframe>',
      );
    await page.getByRole("button", { name: "Import embed", exact: true }).click();
    await expect(page.getByLabel("Accessible description", { exact: true }).first()).toHaveValue(
      "Our silver seal",
    );
    await expect(
      page.getByRole("button", { name: "Publish saved draft", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Publish saved draft", exact: true }),
    ).toBeEnabled();
    expect(saved.footerEmbeds).toHaveLength(2);
    expect(saved.footerText).toBe("**Supported by our community**");
    await page.reload();
    await page.getByRole("tab", { name: "Footer", exact: true }).click();
    await expect(page.getByLabel("Footer text (Markdown)", { exact: true })).toHaveValue(
      "**Supported by our community**",
    );
    const preview = page.getByRole("region", { name: "Public website draft preview" });
    const previewToggle = page.getByRole("button", { name: "Preview", exact: true });
    if (await previewToggle.isVisible()) await previewToggle.click();
    await expect(preview.getByRole("img", { name: "Our silver seal" })).toBeVisible();
    await expect(preview.getByTitle("Community partner")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    await preview.getByTitle("Community partner").scrollIntoViewIfNeeded();
    await expect(
      page
        .frameLocator('iframe[title="Community partner"]')
        .getByRole("heading", { name: "Partner widget" }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({ path: testInfo.outputPath("website-footer.png"), fullPage: true });
    const accessibility = await new AxeBuilder({ page })
      .include(".website-editor-controls")
      .include(".public-site-footer")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    api.assertNoUnexpectedRequests();
  });
}

test("publishes an image-only hero without an empty text overlay", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const fileId = "77777777-7777-4777-8777-777777777777";
  let saved = publicWebsiteSettingsResponseSchema.parse({ ...settings, heroFileId: fileId });
  let published = saved;
  const image =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#327b86"/></svg>';
  await page.route(`**/api/organization/files/${fileId}`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: image }),
  );
  await page.route(`**/api/public/media/*/${fileId}`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: image }),
  );
  await page.route("**/api/organization/website", async (route) => {
    if (route.request().method() === "PUT")
      saved = {
        ...saved,
        ...publicWebsiteSettingsResponseSchema.parse({
          ...saved,
          ...route.request().postDataJSON(),
        }),
      };
    await route.fulfill({ json: saved });
  });
  await page.route("**/api/organization/website/publish", async (route) => {
    published = saved;
    await route.fulfill({
      json: { version: 5, publishedAt: new Date().toISOString(), requestId: settings.requestId },
    });
  });
  await page.route("**/api/public/projection*", (route) =>
    route.fulfill({
      json: {
        version: 5,
        generatedAt: new Date().toISOString(),
        organizationId: "organization-alpha",
        payload: {
          settings: published,
          mediaFileIds: [fileId],
          organizationName: settings.organizationName,
          timezone: "America/New_York",
          performances: [],
          ticketBundles: [],
        },
      },
    }),
  );
  await page.goto("/admin/website");
  await page.getByLabel("Hero headline", { exact: true }).fill("");
  await page.getByLabel("Hero subtitle", { exact: true }).fill("");
  const previewToggle = page.getByRole("button", { name: "Preview", exact: true });
  if (await previewToggle.isVisible()) await previewToggle.click();
  const preview = page.getByRole("region", { name: "Public website draft preview" });
  await expect(preview.locator(".public-hero > div")).toHaveCount(0);
  await expect(preview.locator(".public-hero")).toHaveClass(/public-hero--image/);
  const editToggle = page.getByRole("button", { name: "Edit", exact: true });
  if (await editToggle.isVisible()) await editToggle.click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Publish saved draft", exact: true }),
  ).toBeEnabled();
  expect(saved.heroHeadline).toBe("");
  await page.getByRole("button", { name: "Publish saved draft", exact: true }).click();
  await expect(page.getByText("Version 5 is live.", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".public-hero")).toBeVisible();
  await expect(page.locator(".public-hero > div")).toHaveCount(0);
  await expect(page.locator(".public-hero")).toHaveCSS(
    "background-image",
    new RegExp(`/api/public/media/5/${fileId}`),
  );
  await expect(
    page.getByRole("heading", { name: settings.organizationName, exact: true }),
  ).toHaveClass("sr-only");
  api.assertNoUnexpectedRequests();
});
