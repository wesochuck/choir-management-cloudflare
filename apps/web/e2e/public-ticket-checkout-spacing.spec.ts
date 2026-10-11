import { expect, test, type Page } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";
import { fulfillJson, mockAnonymousSession, mockHealth } from "./support/testWorld";

const eventId = "aa47e064-75b9-47e9-97e6-c28f5430bee0";
const bundleId = "bb6b6bf8-c618-4bcd-b452-3aadebd28aa6";

const spacingProjection = {
  generatedAt: "2026-09-20T00:00:00Z",
  organizationId: "org-spacing-test",
  payload: {
    mediaFileIds: ["d47e0640-75b9-47e9-97e6-c28f5430bee2", "c47e0640-75b9-47e9-97e6-c28f5430bee1"],
    organizationName: "Lancaster Community Chorus",
    performances: [
      {
        advancePriceCents: 1500,
        dayOfPriceCents: 2000,
        doorsOpenTime: "19:00",
        graphicFileId: "c47e0640-75b9-47e9-97e6-c28f5430bee1",
        id: eventId,
        isTicketingEnabled: true,
        location: "",
        publicDetails: "",
        startsAt: futureIsoDate({ days: 300 }),
        ticketCapacity: 200,
        title: "Singing the 70s: A Deliberately Long Concert Title for Layout Coverage",
        venueAddress: "123 Main Street",
        venueName: "Grand Auditorium",
      },
    ],
    settings: {
      aboutUsText: "",
      bodyFont: "system",
      contactEmail: "",
      enabledNavigation: ["tickets"],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: "Lancaster Community Chorus",
      heroSubtitle: "",
      historyText: "",
      logoFileId: "d47e0640-75b9-47e9-97e6-c28f5430bee2",
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [
      {
        capacity: 100,
        eventIds: [eventId],
        graphicFileId: null,
        id: bundleId,
        priceCents: 2500,
        saleEndAt: futureIsoDate({ days: 280 }),
        title: "Season Pass",
      },
    ],
    timezone: "America/New_York",
  },
  version: 1,
};

const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWxsjtQAAAABJRU5ErkJggg==";

async function mockSpacingPage(page: Page): Promise<void> {
  await mockHealth(page);
  await mockAnonymousSession(page);
  await page.route("**/api/public/projection", async (route) => {
    await fulfillJson(route, spacingProjection);
  });
  // Keep the page hermetic: live commerce data would merge over the fixture.
  await page.route("**/api/public/commerce-projection", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 404 });
  });
  await page.route("**/api/public/media/**", async (route) => {
    await route.fulfill({
      body: Buffer.from(PIXEL_PNG_BASE64, "base64"),
      contentType: "image/png",
      status: 200,
    });
  });
}

async function headerToContentGap(page: Page, contentSelector: string): Promise<number> {
  return page.evaluate((selector) => {
    const header = document.querySelector(".public-site-header");
    const content = document.querySelector(selector);
    if (!(header instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      throw new Error("Missing checkout landmarks");
    }
    return content.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  }, contentSelector);
}

test.describe("public ticket checkout top spacing", () => {
  for (const viewport of [
    { height: 900, width: 1280 },
    { height: 844, width: 390 },
  ]) {
    test(`keeps a compact header gap on event and bundle pages at ${viewport.width}px`, async ({
      page,
    }) => {
      await mockSpacingPage(page);
      await page.setViewportSize(viewport);

      await page.goto(`/tickets/${eventId}`);
      const breadcrumb = page.getByRole("link", { name: "← All tickets" });
      await expect(breadcrumb).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue to secure payment" })).toBeVisible();
      const eventGap = await headerToContentGap(
        page,
        ".public-section--ticket-checkout > a[href='/tickets']",
      );
      expect(eventGap).toBeGreaterThan(0);
      expect(eventGap).toBeLessThan(40);

      await page.goto(`/tickets/bundles/${bundleId}`);
      await expect(breadcrumb).toBeVisible();
      const bundleGap = await headerToContentGap(
        page,
        ".public-section--ticket-checkout > a[href='/tickets']",
      );
      expect(bundleGap).toBeGreaterThan(0);
      expect(bundleGap).toBeLessThan(40);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    });
  }

  test("matches the tickets landing page top spacing", async ({ page }) => {
    await mockSpacingPage(page);
    await page.setViewportSize({ height: 900, width: 1280 });

    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
    const landingGap = await headerToContentGap(page, ".public-section--tickets > h1");

    await page.goto(`/tickets/${eventId}`);
    await expect(page.getByRole("link", { name: "← All tickets" })).toBeVisible();
    const checkoutGap = await headerToContentGap(
      page,
      ".public-section--ticket-checkout > a[href='/tickets']",
    );

    expect(Math.abs(checkoutGap - landingGap)).toBeLessThanOrEqual(8);
  });
});
