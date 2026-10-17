import AxeBuilder from "@axe-core/playwright";
import { organizationEventSchema } from "@choir/contracts";
import { expect, test } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { adminBundle, adminEvent, requestId, secondAdminEvent } from "./support/ticketingFixtures";

for (const theme of ["light", "dark"] as const) {
  test(`season bundle cards are usable in ${theme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((mode) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, mode);
    }, theme);
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    api.events.set(
      [adminEvent, secondAdminEvent].map((event) => organizationEventSchema.parse(event)),
    );
    await page.route("**/api/organization/tickets/orders", (route) =>
      route.fulfill({ json: { orders: [], requestId } }),
    );
    await page.route("**/api/organization/tickets/bundles", (route) =>
      route.fulfill({
        json: {
          bundles: [
            {
              ...adminBundle,
              title: "LCC 2026–2027 Season",
              priceCents: 3000,
              capacity: null,
              eventIds: [adminEvent.id, secondAdminEvent.id],
              saleEndAt: futureIsoDate({ days: 30 }),
              ticketSlug: "lcc-2026-2027-season",
            },
          ],
          requestId,
        },
      }),
    );
    await page.route("**/api/organization/ticket-confirmation-settings", (route) =>
      route.fulfill({ status: 404 }),
    );
    let deleted = false;
    await page.route("**/api/organization/tickets/bundles/*", (route) => {
      if (route.request().method() === "DELETE") deleted = true;
      return route.fulfill({ json: { deleted: true, requestId } });
    });
    await page.goto("/admin/tickets");
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    const panel = page.locator("#ticketing-bundles-panel");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const card = panel.getByRole("article", { name: "LCC 2026–2027 Season" });
    await expect(card.getByText("$30.00")).toBeVisible();
    await expect(card.getByText("Active", { exact: true })).toBeVisible();
    await expect(card.getByText("Unlimited passes")).toBeVisible();
    await expect(card.getByText("Spring Concert", { exact: true })).toBeVisible();
    await expect(card.getByText("Winter Concert", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "View ticket page" })).toHaveAttribute(
      "href",
      "/tickets/bundles/lcc-2026-2027-season",
    );
    await page.screenshot({ path: testInfo.outputPath("season-bundles.png"), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await card.getByRole("button", { name: "Edit bundle" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Edit ticket bundle" })).toBeVisible();
    await page.keyboard.press("Escape");
    await card.getByRole("button", { name: "Delete LCC 2026–2027 Season" }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Delete LCC 2026–2027 Season?",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    expect(deleted).toBe(false);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Delete LCC 2026–2027 Season" }).click();
    await confirmation.getByRole("button", { name: "Delete bundle", exact: true }).click();
    await expect(card).not.toBeVisible();
    expect(deleted).toBe(true);
    await expect(panel.getByRole("heading", { name: "Your season starts here" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "New ticket bundle" })).toBeEnabled();
    const longTitle =
      "A full season of choral music, candlelight concerts, and community celebrations";
    await page.route("**/api/organization/tickets/bundles", (route) =>
      route.fulfill({
        json: {
          requestId,
          bundles: [
            adminBundle,
            {
              ...adminBundle,
              id: "55555555-5555-4555-8555-555555555555",
              title: longTitle,
              isActive: false,
              capacity: 80,
            },
          ],
        },
      }),
    );
    await page.reload();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    const inactive = panel.getByRole("article", { name: longTitle });
    await expect(inactive.getByText("Inactive", { exact: true })).toBeVisible();
    await expect(inactive.getByText("Up to 80 passes")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("multiple-season-bundles.png"),
      fullPage: true,
    });
    const accessibility = await new AxeBuilder({ page })
      .include("#ticketing-bundles-panel")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    api.assertNoUnexpectedRequests();
  });
}
