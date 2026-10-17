import { expect, test } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";
import { publishedOrganizationProjectionSchema } from "@choir/contracts";
import { mockAnonymousSession, mockHealth } from "./support/testWorld";

const firstId = "11111111-1111-4111-8111-111111111111";
const legacyId = "22222222-2222-4222-8222-222222222222";
const freeId = "33333333-3333-4333-8333-333333333333";
const graphicId = "44444444-4444-4444-8444-444444444444";
const performance = {
  advancePriceCents: 1500,
  dayOfPriceCents: 2000,
  doorsOpenTime: "",
  graphicFileId: null,
  isTicketingEnabled: true,
  location: "Community Hall",
  publicDetails: "",
  startsAt: futureIsoDate({ days: 60 }),
  ticketCapacity: null,
  venueAddress: "",
  venueName: "",
};
const projection = publishedOrganizationProjectionSchema.parse({
  version: 1,
  organizationId: "organization-alpha",
  generatedAt: new Date().toISOString(),
  payload: {
    organizationName: "Community Chorus",
    timezone: "America/New_York",
    mediaFileIds: [graphicId],
    settings: {},
    ticketBundles: [],
    performances: [
      {
        ...performance,
        id: firstId,
        title: "Winter Concert",
        ticketSlug: "winter-concert",
        graphicFileId: graphicId,
        publicDetails: "[Program notes](https://partner.example.test/notes)",
      },
      { ...performance, id: legacyId, title: "Legacy Concert", ticketSlug: null },
      { ...performance, id: freeId, title: "Free Community Concert", isTicketingEnabled: false },
    ],
  },
});

for (const pathname of ["/", "/performances"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${pathname} performance cards navigate by pointer and keyboard in ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await mockHealth(page);
      await mockAnonymousSession(page);
      await page.route("**/api/public/logo", (route) => route.fulfill({ status: 404 }));
      await page.route("**/api/public/projection", (route) => route.fulfill({ json: projection }));
      await page.route("**/api/public/commerce-projection", (route) =>
        route.fulfill({ json: projection }),
      );
      await page.route("**/api/public/transaction-fee-settings", (route) =>
        route.fulfill({ status: 404 }),
      );
      await page.route(`**/api/public/media/1/${graphicId}`, (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="240"><rect width="500" height="240" fill="#397a81"/></svg>',
        }),
      );
      await page
        .context()
        .route("https://partner.example.test/notes", (route) =>
          route.fulfill({ contentType: "text/html", body: "Program notes" }),
        );
      await page.goto(pathname);
      const card = page.locator(`#performance-${firstId}`);
      const title = card.getByRole("link", { name: "Winter Concert", exact: true });
      await expect(title).toHaveAttribute("href", "/tickets/winter-concert");
      await expect(card).toContainText("View tickets");
      await title.focus();
      await expect(title).toBeFocused();
      expect(await card.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
        "none",
      );
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/tickets\/winter-concert$/);
      await page.goto(pathname);
      // The image and empty card area are covered by the native title link.
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole("img")).toBeVisible();
      await card.click({ position: { x: 30, y: 30 } });
      await expect(page).toHaveURL(/\/tickets\/winter-concert$/);
      await page.goto(pathname);
      const popupEvent = page.waitForEvent("popup");
      await card.getByRole("link", { name: "Program notes", exact: true }).click();
      const popup = await popupEvent;
      await expect(popup).toHaveURL("https://partner.example.test/notes");
      await popup.close();
      await expect(page).toHaveURL(new RegExp(`${pathname}$`));
      const legacy = page.locator(`#performance-${legacyId}`);
      await expect(
        legacy.getByRole("link", { name: "Legacy Concert", exact: true }),
      ).toHaveAttribute("href", `/tickets/${legacyId}`);
      await legacy.click({ position: { x: 10, y: 10 } });
      await expect(page).toHaveURL(new RegExp(`/tickets/${legacyId}$`));
      await page.goto(pathname);
      const free = page.getByRole("link", { name: "Free Community Concert", exact: true });
      await expect(free).toHaveAttribute("href", `/performances#performance-${freeId}`);
      await free.click();
      await expect(page).toHaveURL(new RegExp(`/performances#performance-${freeId}$`));
      await expect(page.locator(`#performance-${freeId}`)).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
