import { expect, test, type Page } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";
import { fulfillJson, mockAnonymousSession, mockHealth } from "./support/testWorld";

const shortEventStartsAt = futureIsoDate({ days: 60 });
const longEventStartsAt = futureIsoDate({ days: 90 });
const bundleSaleEndAt = futureIsoDate({ days: 120 });

const ticketCardProjection = {
  generatedAt: "2026-09-20T00:00:00Z",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  payload: {
    mediaFileIds: [],
    organizationName: "Ticket Card Choir",
    performances: [
      {
        advancePriceCents: 1500,
        dayOfPriceCents: 2000,
        doorsOpenTime: "18:30",
        graphicFileId: null,
        id: "11111111-1111-4111-8111-111111111111",
        isTicketingEnabled: true,
        location: "",
        publicDetails: "",
        startsAt: shortEventStartsAt,
        ticketCapacity: 100,
        title: "Spring Concert",
        venueAddress: "",
        venueName: "",
      },
      {
        advancePriceCents: 1800,
        dayOfPriceCents: 2200,
        doorsOpenTime: "18:30",
        graphicFileId: null,
        id: "22222222-2222-4222-8222-222222222222",
        isTicketingEnabled: true,
        location: "",
        publicDetails: "",
        startsAt: longEventStartsAt,
        ticketCapacity: 100,
        title:
          "A Deliberately Long Performance Title That Wraps Across Several Lines in the Ticket Grid",
        venueAddress: "456 Choir Boulevard, Columbus, Ohio 43215",
        venueName: "Grace Chapel for the Performing Arts and Community Music",
      },
    ],
    settings: {
      aboutUsText: "",
      bodyFont: "system",
      contactEmail: "",
      enabledNavigation: ["tickets"],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: "Ticket Card Choir",
      heroSubtitle: "",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [
      {
        capacity: 50,
        eventIds: ["11111111-1111-4111-8111-111111111111"],
        id: "33333333-3333-4333-8333-333333333333",
        priceCents: 3000,
        saleEndAt: bundleSaleEndAt,
        title: "Season Pass",
      },
    ],
    timezone: "America/New_York",
  },
  version: 1,
};

async function mockTicketCardPage(page: Page): Promise<void> {
  await mockHealth(page);
  await mockAnonymousSession(page);
  await page.route("**/api/public/projection", async (route) => {
    await fulfillJson(route, ticketCardProjection);
  });
}

test.describe("public ticket card layout", () => {
  test("aligns variable-height purchase areas at the lower desktop card edge", async ({ page }) => {
    await mockTicketCardPage(page);
    await page.setViewportSize({ height: 900, width: 1280 });
    await page.goto("/tickets");

    const cards = page.locator(".public-performance-card--ticket");
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Buy pass" })).toHaveAttribute(
      "href",
      "/tickets/bundles/33333333-3333-4333-8333-333333333333",
    );
    await expect(page.getByRole("link", { name: "Buy tickets" }).nth(1)).toHaveAttribute(
      "href",
      "/tickets/22222222-2222-4222-8222-222222222222",
    );

    const geometry = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const card = element.getBoundingClientRect();
        const purchase = element.querySelector<HTMLElement>(".public-performance-card__purchase");
        const purchaseBox = purchase?.getBoundingClientRect();
        return {
          cardBottom: card.bottom,
          cardTop: card.top,
          purchaseBottom: purchaseBox?.bottom ?? Number.NaN,
        };
      }),
    );

    expect(geometry).toHaveLength(3);
    const cardBottoms = geometry.map(({ cardBottom }) => cardBottom);
    const purchaseBottoms = geometry.map(({ purchaseBottom }) => purchaseBottom);
    expect(Math.max(...cardBottoms) - Math.min(...cardBottoms)).toBeLessThan(2);
    expect(Math.max(...purchaseBottoms) - Math.min(...purchaseBottoms)).toBeLessThan(2);
    expect(
      Math.max(...geometry.map(({ cardBottom, purchaseBottom }) => cardBottom - purchaseBottom)) -
        Math.min(...geometry.map(({ cardBottom, purchaseBottom }) => cardBottom - purchaseBottom)),
    ).toBeLessThan(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test("keeps single-column mobile cards compact and free of horizontal overflow", async ({
    page,
  }) => {
    await mockTicketCardPage(page);
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/tickets");

    const cards = page.locator(".public-performance-card--ticket");
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Buy pass" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Buy tickets" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "View on Google Maps" })).toBeVisible();

    const geometry = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const card = element.getBoundingClientRect();
        const content = element.querySelector<HTMLElement>(".public-performance-card__content");
        const purchase = element.querySelector<HTMLElement>(".public-performance-card__purchase");
        const contentBox = content?.getBoundingClientRect();
        const purchaseBox = purchase?.getBoundingClientRect();
        return {
          cardBottom: card.bottom,
          cardRight: card.right,
          cardTop: card.top,
          contentBottom: contentBox?.bottom ?? Number.NaN,
          purchaseBottom: purchaseBox?.bottom ?? Number.NaN,
          purchaseTop: purchaseBox?.top ?? Number.NaN,
        };
      }),
    );

    expect(geometry).toHaveLength(3);
    expect(new Set(geometry.map(({ cardTop }) => cardTop)).size).toBe(3);
    for (const { cardBottom, cardRight, contentBottom, purchaseBottom, purchaseTop } of geometry) {
      expect(cardRight).toBeLessThanOrEqual(390);
      expect(purchaseTop).toBeGreaterThanOrEqual(contentBottom);
      expect(purchaseTop).toBeLessThanOrEqual(purchaseBottom);
      expect(cardBottom - purchaseBottom).toBeLessThan(64);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
