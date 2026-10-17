import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  publicWebsiteSettingsResponseSchema,
  publishedOrganizationProjectionSchema,
} from "@choir/contracts";
import { futureIsoDate } from "@choir/testkit";
import { installOrganizationApi } from "./fixtures/apiMocks";

const requestId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
for (const theme of ["light", "dark"] as const) {
  test(`publishes safe links and custom public page names in ${theme} theme`, async ({
    page,
  }, testInfo) => {
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
          settings: published,
          organizationName: "Community Chorus",
          timezone: "UTC",
          mediaFileIds: [],
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
    const markdown =
      '[Our story](/history){target="_self"} our music\n\nhttps://partner.example.test/notes';
    await about.fill(markdown);
    await page.getByRole("tab", { name: "Navigation", exact: true }).click();
    for (const [field, value] of [
      ["History navigation label", "Our story"],
      ["History page heading", "Our beginnings"],
      ["Auditions navigation label", "Join the chorus"],
      ["Auditions page heading", "Sing with us"],
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
    const link = page.locator(".public-copy").getByRole("link", { name: "Our story", exact: true });
    await expect(link).toHaveCSS("font-weight", "700");
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    await expect(link).not.toHaveAttribute("target");
    const popupPromise = page.waitForEvent("popup");
    await page
      .locator(".public-copy")
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
    await page.goto("/auditions");
    await expect(page.getByRole("heading", { name: "Sing with us", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    api.assertNoUnexpectedRequests();
  });
}
