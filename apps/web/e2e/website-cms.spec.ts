import AxeBuilder from "@axe-core/playwright";
import { publicWebsiteSettingsResponseSchema } from "@choir/contracts";
import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

for (const theme of ["light", "dark"] as const) {
  test(`creates, links, saves, and publishes a content page in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, mode);
    }, theme);
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    let saved = publicWebsiteSettingsResponseSchema.parse({
      organizationName: "Example Chorus",
      publicationVersion: 0,
      draftRevision: 0,
      publishedAt: null,
      updatedAt: "2026-10-31T12:00:00Z",
      requestId: "11111111-1111-4111-8111-111111111111",
      historyText: "For 60 years, we have brought the joy of singing to our community.",
    });
    let published = saved;
    await page.route("**/api/organization/website", async (route) => {
      if (route.request().method() === "PUT") {
        const body: unknown = route.request().postDataJSON();
        saved = publicWebsiteSettingsResponseSchema.parse({
          ...saved,
          ...(typeof body === "object" ? body : {}),
          draftRevision: (saved.draftRevision ?? 0) + 1,
        });
      }
      await route.fulfill({ json: saved });
    });
    const hostedDocument = {
      id: "22222222-2222-4222-8222-222222222222",
      fileId: "33333333-3333-4333-8333-333333333333",
      title: "Scholarship application",
      downloadPath: "/documents/scholarship-application.pdf",
      fileName: "application.pdf",
      slug: "scholarship-application",
      sizeBytes: 245760,
      contentType: "application/pdf",
      sortOrder: 0,
      createdAt: "2026-10-31T12:00:00Z",
      updatedAt: "2026-10-31T12:00:00Z",
    };
    await page.route("**/api/organization/website/documents", (route) =>
      route.fulfill({ json: { documents: [hostedDocument], requestId: saved.requestId } }),
    );
    await page.route("**/api/organization/website/publish", async (route) => {
      published = { ...saved, publicationVersion: 1 };
      await route.fulfill({
        json: { version: 1, publishedAt: "2026-10-31T13:00:00Z", requestId: saved.requestId },
      });
    });
    await page.route("**/api/public/projection*", (route) =>
      route.fulfill({
        json: {
          organizationId: "organization-alpha",
          version: published.publicationVersion || 1,
          generatedAt: "2026-10-31T13:00:00Z",
          payload: {
            settings: published,
            organizationName: published.organizationName,
            timezone: "UTC",
            mediaFileIds: [],
            performances: [],
            ticketBundles: [],
          },
        },
      }),
    );
    await page.goto("/admin/website");
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    const title = page.getByLabel("Page title", { exact: true });
    await expect(title).toBeFocused();
    await title.fill("Scholarships");
    await expect(page.getByLabel("Page URL")).toHaveValue("scholarships");
    const body = page.getByLabel("Content (Markdown)");
    await body.fill("Support our next generation of singers.\n\n");
    await body.evaluate((element) => {
      if (element instanceof HTMLTextAreaElement)
        element.setSelectionRange(element.value.length, element.value.length);
    });
    await page.getByRole("button", { name: "Insert document", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Insert document" });
    await expect(picker).toContainText("PDF · 240 KB");
    const documentRow = picker.getByRole("button", { name: /Scholarship application/ });
    const alignment = await documentRow.evaluate((element) => {
      const title = element.querySelector("strong");
      const metadata = element.querySelector("span");
      if (!title || !metadata) throw new Error("Document title and metadata must be visible");
      const style = getComputedStyle(element);
      const contentLeft =
        element.getBoundingClientRect().left +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft);
      return {
        titleInset: Math.abs(title.getBoundingClientRect().left - contentLeft),
        metadataInset: Math.abs(metadata.getBoundingClientRect().left - contentLeft),
      };
    });
    expect(alignment.titleInset).toBeLessThanOrEqual(1);
    expect(alignment.metadataInset).toBeLessThanOrEqual(1);

    await page.getByRole("searchbox").fill("scholarship");
    await page.screenshot({
      path: testInfo.outputPath(`document-picker-${theme}.png`),
      fullPage: true,
    });
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
    ).toEqual([]);
    await picker.getByRole("button", { name: "Manage documents", exact: true }).click();
    const documentsConfirmation = page.getByRole("dialog", { name: "Open website documents?" });
    await expect(documentsConfirmation).toContainText("unsaved page text will be kept");
    await documentsConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(picker.getByRole("searchbox")).toHaveValue("scholarship");
    await picker.getByRole("button", { name: /Scholarship application/ }).click();
    await expect(body).toBeFocused();
    await expect(body).toHaveValue(
      /\[Scholarship application\]\(\/documents\/scholarship-application.pdf\)/,
    );
    await expect(page.getByRole("button", { name: "Publish saved draft" })).toBeDisabled();
    const selector = page.getByRole("combobox", { name: "Page", exact: true });
    await selector.selectOption("home");
    await selector.selectOption({ label: "Scholarships" });
    await expect(body).toHaveValue(/Support our next generation/);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByLabel("Page URL")).toBeDisabled();
    await page.getByRole("button", { name: "Publish saved draft" }).click();
    await expect(page.getByLabel("Publication state")).toContainText("Live · Published");
    const previewToggle = page.getByRole("button", { name: "Preview", exact: true });
    if (await previewToggle.isVisible()) await previewToggle.click();
    const preview = page.getByRole("region", { name: "Public website draft preview" });
    await expect(preview.getByRole("heading", { name: "Scholarships" })).toBeVisible();
    await expect(preview.getByRole("button", { name: "Scholarships", exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({
      path: testInfo.outputPath(`website-cms-${theme}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    if (await edit.isVisible()) await edit.click();
    await page.getByRole("button", { name: "Remove page", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Remove page?" });
    await expect(confirmation).toContainText("live page will disappear only after");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(title).toHaveValue("Scholarships");
    api.assertNoUnexpectedRequests();
  });
}

test("bounded long page menus reflow at narrow widths and enlarged text", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const settings = publicWebsiteSettingsResponseSchema.parse({
    organizationName: "Example Chorus",
    publicationVersion: 1,
    draftRevision: 1,
    publishedAt: "2026-10-31T12:00:00Z",
    updatedAt: "2026-10-31T12:00:00Z",
    requestId: "11111111-1111-4111-8111-111111111111",
    pages: Array.from({ length: 50 }, (_, index) => ({
      id: `page-${String(index)}`,
      slug: `page-${String(index)}`,
      title: index === 0 ? "L".repeat(120) : `Page ${String(index)} with a longer navigation label`,
      body: "Published page text",
      showInNavigation: true,
    })),
  });
  await page.route("**/api/public/projection*", (route) =>
    route.fulfill({
      json: {
        organizationId: "organization-alpha",
        version: 1,
        generatedAt: "2026-10-31T12:00:00Z",
        payload: {
          organizationName: settings.organizationName,
          timezone: "UTC",
          settings,
          performances: [],
          ticketBundles: [],
          mediaFileIds: [],
        },
      },
    }),
  );
  await page.goto("/page-0");
  await expect(page.getByRole("heading", { name: "L".repeat(120), exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Public website", exact: true });
  await expect(navigation.getByRole("link")).toHaveCount(51);
  for (const width of [1280, 640, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  api.assertNoUnexpectedRequests();
});
