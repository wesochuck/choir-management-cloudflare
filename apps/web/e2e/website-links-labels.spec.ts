import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  publicWebsiteSettingsResponseSchema,
  publishedOrganizationProjectionSchema,
} from "@choir/contracts";
import { futureIsoDate } from "@choir/testkit";
import { installOrganizationApi } from "./fixtures/apiMocks";

const requestId = "11111111-1111-4111-8111-111111111111";
const logoId = "33333333-3333-4333-8333-333333333333";
const eventId = "22222222-2222-4222-8222-222222222222";
for (const theme of ["light", "dark"] as const) {
  test(`publishes safe links and custom public page names in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((mode) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, mode);
    }, theme);
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    let saved = publicWebsiteSettingsResponseSchema.parse({
      organizationName: "Community Chorus",
      publicationVersion: 4,
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestId,
      aboutUsText: "Support our music",
      historyText: "Our original history.",
      footerText: "Come sing with our community.",
      enabledNavigation: ["tickets", "donations", "auditions"],
      showBrandingHeaderFooter: true,
    });
    let published = saved;
    await page.route("**/api/organization/website", async (route) => {
      if (route.request().method() === "PUT")
        saved = publicWebsiteSettingsResponseSchema.parse({
          ...saved,
          ...route.request().postDataJSON(),
        });
      await route.fulfill({ json: saved });
    });
    await page.route("**/api/organization/website/publish", async (route) => {
      published = saved;
      await route.fulfill({
        json: { version: 5, publishedAt: new Date().toISOString(), requestId },
      });
    });
    const projection = () =>
      publishedOrganizationProjectionSchema.parse({
        version: 5,
        generatedAt: new Date().toISOString(),
        organizationId: "organization-alpha",
        payload: {
          settings: { ...published, logoFileId: logoId },
          organizationName: "Community Chorus",
          timezone: "UTC",
          mediaFileIds: [logoId],
          ticketBundles: [],
          performances: [
            {
              id: eventId,
              title: "Winter Concert",
              ticketSlug: "winter-concert",
              startsAt: futureIsoDate({ days: 30 }),
              isTicketingEnabled: true,
              publicDetails: '[Read our story](/history){target="_self"}',
              venueName: "",
              venueAddress: "",
              location: "",
              graphicFileId: null,
              ticketCapacity: null,
              advancePriceCents: 1500,
              dayOfPriceCents: 2000,
              doorsOpenTime: "",
            },
          ],
        },
      });
    await page.route(`**/api/public/media/*/${logoId}`, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="#456789"/></svg>',
      }),
    );
    await page.route("**/api/public/projection*", (route) => route.fulfill({ json: projection() }));
    await page.route("**/api/public/commerce-projection", (route) =>
      route.fulfill({ json: projection() }),
    );
    await page.route("**/api/public/audition-settings", (route) =>
      route.fulfill({
        json: {
          enabled: true,
          mode: "open_inquiry",
          confirmationMessage: "Thanks",
          defaultPerformanceId: null,
          slots: [],
          voiceParts: [],
          sections: [],
          timezone: "UTC",
          performance: null,
          venue: null,
          rehearsalSchedule: [],
          rehearsalNotes: "",
          startDate: null,
        },
      }),
    );
    await page.route("**/api/public/tickets/discount-availability*", (route) =>
      route.fulfill({ json: { hasRedeemableCode: false } }),
    );
    await page.route("**/api/public/donation-settings", (route) =>
      route.fulfill({
        json: { buttonText: "Donate", description: "Support our music", levels: [], requestId },
      }),
    );
    await page.route("**/api/public/transaction-fee-settings", (route) =>
      route.fulfill({ status: 404 }),
    );
    await page
      .context()
      .route("https://partner.example.test/notes", (route) =>
        route.fulfill({ contentType: "text/html", body: "Program notes" }),
      );
    await page.goto("/admin/website");
    const about = page.getByLabel("About Us (Markdown)", { exact: true });
    await about.evaluate((element) => {
      if (element instanceof HTMLTextAreaElement) element.setSelectionRange(0, 7);
    });
    await about.locator("..").getByRole("button", { name: "Insert link" }).click();
    let dialog = page.getByRole("dialog", { name: "Insert link", exact: true });
    await expect(dialog.getByLabel("Link text")).toHaveValue("Support");
    await dialog.getByLabel("Link address").fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Apply link" }).click();
    await expect(dialog.getByRole("alert")).toContainText("valid website address");
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
    ).toEqual([]);
    await dialog.getByLabel("Link address").fill("https://partner.example.test/notes");
    await dialog.getByRole("checkbox", { name: "Open in new tab" }).check();
    await dialog.screenshot({ path: testInfo.outputPath("link-editor.png") });
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Apply link" }).click();
    await expect(about).toBeFocused();
    await expect(about).toHaveValue(
      '[Support](https://partner.example.test/notes){target="_blank"} our music',
    );
    await about.evaluate((element) => {
      if (element instanceof HTMLTextAreaElement) element.setSelectionRange(3, 3);
    });
    await about.locator("..").getByRole("button", { name: "Insert link" }).click();
    dialog = page.getByRole("dialog", { name: "Edit link", exact: true });
    await expect(dialog.getByRole("checkbox", { name: "Open in new tab" })).toBeChecked();
    await dialog.getByLabel("Link text").fill("Our story");
    await dialog.getByLabel("Link address").fill("/history");
    await dialog.getByRole("checkbox", { name: "Open in new tab" }).uncheck();
    await dialog.getByRole("button", { name: "Apply link" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(about).toBeFocused();
    await expect(about).toHaveValue('[Our story](/history){target="_self"} our music');
    const markdown =
      '[Our story](/history){target="_self"} our music\nSing together.\n\nhttps://partner.example.test/notes';
    await about.fill(markdown);
    await expect(about).toHaveValue(markdown);
    await page.getByRole("tab", { name: "Navigation", exact: true }).click();
    const moduleFieldset = page.locator(
      "fieldset:has(legend:has-text('Public modules navigation links'))",
    );
    await expect(moduleFieldset).toBeVisible();
    for (const label of await moduleFieldset.locator("label.choice-field").all()) {
      const input = label.locator("input[type='checkbox']");
      const content = label.locator(".choice-field__content");
      const inputBox = await input.boundingBox();
      const contentBox = await content.boundingBox();
      expect(inputBox).not.toBeNull();
      expect(contentBox).not.toBeNull();
      if (!inputBox || !contentBox) {
        throw new Error("Expected bounding boxes for checkbox and label content");
      }
      expect(inputBox.height).toBeLessThanOrEqual(20);
      const inputMidline = inputBox.y + inputBox.height / 2;
      const contentMidline = contentBox.y + contentBox.height / 2;
      expect(Math.abs(inputMidline - contentMidline)).toBeLessThanOrEqual(2.5);
    }
    for (const [field, value] of [
      ["History navigation label", "Our story"],
      ["History page heading", "Our beginnings"],
      ["Auditions page heading", "Join"],
      ["Performances navigation label", "Concerts"],
      ["Performances page heading", "Concert schedule"],
      ["Tickets navigation label", "Book seats"],
      ["Tickets page heading", "Tickets and passes"],
      ["Donate navigation label", "Support"],
      ["Donate page heading", "Support our chorus"],
    ] as const)
      await page.getByLabel(field, { exact: true }).fill(value);
    await expect(
      page.getByRole("button", { name: "Publish saved draft", exact: true }),
    ).toBeDisabled();
    expect(published.pageLabels).toBeUndefined();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Publish saved draft", exact: true }),
    ).toBeEnabled();
    await page.reload();
    await page.getByRole("tab", { name: "Navigation", exact: true }).click();
    await expect(page.getByLabel("History page heading", { exact: true })).toHaveValue(
      "Our beginnings",
    );
    await page.getByRole("button", { name: "Publish saved draft", exact: true }).click();
    await expect(page.getByText("Version 5 is live.", { exact: true })).toBeVisible();
    await page.goto("/");
    const paragraphs = page.locator("#about-us .public-copy > p");
    await expect(paragraphs).toHaveCount(2);
    const firstParagraph = paragraphs.nth(0);
    await expect(firstParagraph).toHaveCSS("white-space", "pre-wrap");
    const firstBounds = await firstParagraph.boundingBox();
    const secondBounds = await paragraphs.nth(1).boundingBox();
    const lineHeight = await firstParagraph.evaluate((element) =>
      parseFloat(getComputedStyle(element).lineHeight),
    );
    expect(firstBounds).not.toBeNull();
    expect(secondBounds).not.toBeNull();
    if (!firstBounds || !secondBounds) throw new Error("Expected visible public paragraphs");
    expect(firstBounds.height).toBeGreaterThanOrEqual(lineHeight * 2 - 1);
    expect(secondBounds.y - firstBounds.y - firstBounds.height).toBeGreaterThanOrEqual(16);
    await page
      .locator("#about-us")
      .screenshot({ path: testInfo.outputPath("public-paragraphs.png") });
    const link = page
      .locator("#about-us .public-copy")
      .getByRole("link", { name: "Our story", exact: true });
    await expect(link).toHaveCSS("font-weight", "700");
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    await expect(link).not.toHaveAttribute("target");
    const popupPromise = page.waitForEvent("popup");
    await page
      .locator("#about-us .public-copy")
      .getByRole("link", { name: "https://partner.example.test/notes", exact: true })
      .click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("https://partner.example.test/notes");
    await popup.close();
    await link.screenshot({ path: testInfo.outputPath("public-link.png") });
    await link.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(link).toBeFocused();
    expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
      "none",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByRole("heading", { name: "Our beginnings", exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Public website" })
      .getByRole("link", { name: "Concerts", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Concert schedule", exact: true }),
    ).toBeVisible();
    await page.goto("/tickets/winter-concert");
    await page.getByRole("link", { name: "Read our story", exact: true }).click();
    await expect(page).toHaveURL(/\/history$/);
    await page.goto("/tickets");
    await expect(
      page.getByRole("heading", { name: "Tickets and passes", exact: true }),
    ).toBeVisible();
    await page.goto("/donate");
    await expect(
      page.getByRole("heading", { name: "Support our chorus", exact: true }),
    ).toBeVisible();
    await page.goto("/");
    const joinLink = page
      .getByRole("navigation", { name: "Public website" })
      .getByRole("link", { name: "Join", exact: true });
    await expect(joinLink).toHaveAttribute("href", "/auditions");
    await joinLink.click();
    for (const path of ["/auditions", "/join"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Join", exact: true })).toBeVisible();
      const logo = page.getByRole("banner").locator(".public-site-brand img");
      await expect(logo).toBeVisible();
      await expect
        .poll(() =>
          logo.evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
        )
        .toBe(true);
      const bounds = await logo.boundingBox();
      expect(bounds?.width).toBeLessThanOrEqual(48);
      expect(bounds?.height).toBeLessThanOrEqual(48);
      await expect(
        page.getByRole("banner").getByRole("link", { name: "Community Chorus", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Public website" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Join", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("contentinfo")).toContainText("Come sing with our community.");
      await expect(page.getByRole("main")).toHaveCount(1);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`join-header-${path.slice(1)}.png`) });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.route("**/api/public/audition-details", (route) =>
      route.fulfill({ status: 404, json: { error: "not_found", requestId } }),
    );
    await page.goto("/auditions?token=expired-audition-link");
    await expect(page.getByRole("heading", { name: "Link Not Found" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public website" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("Come sing with our community.");
    await expect(page).toHaveURL(/token=expired-audition-link$/);

    published = { ...published, showBrandingHeaderFooter: false };
    for (const path of ["/auditions", "/join"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Join", exact: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Public website" })).toHaveCount(0);
      await expect(page.getByRole("contentinfo")).not.toContainText(
        "Come sing with our community.",
      );
    }
    api.assertNoUnexpectedRequests();
  });
}
