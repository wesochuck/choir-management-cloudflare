import { expect, test } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";
import {
  bundleId,
  checkoutResponse,
  eventId,
  futureDate,
  purchaseResponse,
  receiptResponse,
  routeAnonymousSession,
  routeHealth,
  routePublicBasics,
  scanToken,
  secondPerformanceId,
  successToken,
  ticketingProjection,
} from "./support/ticketingFixtures";

test.describe("public ticket pages", () => {
  test("shows available events and bundles in standalone transaction shell by default", async ({
    page,
  }) => {
    await routePublicBasics(page);

    await page.goto("/tickets");

    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
    await expect(page.getByText("Spring Concert")).toBeVisible();
    await expect(page.getByText("Season Pass")).toBeVisible();
    await expect(page.getByText("Multi-performance pass")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ticket Choir" })).toBeVisible();

    // Standalone shell must not show hosted website navigation or sign in
    await expect(page.getByRole("navigation", { name: "Public website" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Performances" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "History" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).not.toBeVisible();
  });

  test("shows hosted website header, footer, and navigation when showBrandingHeaderFooter is enabled", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAnonymousSession(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ...ticketingProjection,
          payload: {
            ...ticketingProjection.payload,
            settings: {
              ...ticketingProjection.payload.settings,
              enabledNavigation: ["tickets"],
              historyText: "Lancaster Community Chorus was founded in 1995.",
              showBrandingHeaderFooter: true,
            },
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/tickets");

    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Public website" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("link", { name: "Performances" })).toBeVisible();
    await expect(page.getByRole("link", { name: "History" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    const ticketsLink = nav.getByRole("link", { exact: true, name: "Tickets" });
    await expect(ticketsLink).toHaveAttribute("aria-current", "page");
    await expect(ticketsLink).toHaveClass(/is-active/);
  });

  test("loads standalone ticketing from commerce projection when published website is 404", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAnonymousSession(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/public/commerce-projection", async (route) => {
      await route.fulfill({
        body: JSON.stringify(ticketingProjection),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/tickets");

    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
    await expect(page.getByText("Spring Concert")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public website" })).not.toBeVisible();
  });

  test("purchases an event ticket", async ({ page }) => {
    await routePublicBasics(page);

    let checkoutBody: unknown = null;
    await page.route("**/api/public/tickets/checkout", async (route) => {
      checkoutBody = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify(checkoutResponse),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/tickets/${eventId}`);

    await expect(page.getByRole("heading", { name: "Spring Concert" })).toBeVisible();
    await expect(page.getByText("Grand Auditorium")).toBeVisible();
    await expect(page.getByText("Doors open at 7:00 PM.")).toBeVisible();

    await page.getByLabel("Name on order").fill("Jane Buyer");
    await page.getByLabel("Email", { exact: true }).fill("jane@example.test");
    await page.getByLabel("Confirm email").fill("jane@example.test");
    await page
      .getByLabel("I would like to receive updates about future events and programs")
      .check();
    await expect(page.getByText("You won't be charged yet.")).toBeVisible();
    await page.getByRole("button", { name: "Continue to secure payment" }).click();

    await page.waitForURL("**/tickets/order/success*");
    expect(checkoutBody).toBeTruthy();
    expect(
      typeof checkoutBody === "object" &&
        checkoutBody !== null &&
        "buyerName" in checkoutBody &&
        checkoutBody.buyerName === "Jane Buyer",
    ).toBe(true);
  });

  test("purchases a bundle pass", async ({ page }) => {
    await routePublicBasics(page);

    const bundleCheckoutResponse = {
      checkoutMode: "fake",
      purchase: {
        ...purchaseResponse,
        amountPaidCents: 2573,
        bundleId,
        bundleTitle: "Season Pass",
        feeCents: 73,
        unitPriceCents: 2500,
      },
      successToken,
      url: `http://127.0.0.1:4173/tickets/order/success?token=${successToken}`,
    };

    await page.route("**/api/public/tickets/checkout", async (route) => {
      await route.fulfill({
        body: JSON.stringify(bundleCheckoutResponse),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/tickets/bundles/${bundleId}`);

    await expect(page.getByRole("heading", { name: "Season Pass" })).toBeVisible();
    await expect(page.getByText("Spring Concert")).toBeVisible();
    await expect(page.getByText("One pass includes admission to:")).toBeVisible();
    await expect(page.locator("ul.public-bundle-event-list")).toBeVisible();

    await page.getByLabel("Name on order").fill("Bundle Buyer");
    await page.getByLabel("Email", { exact: true }).fill("bundle@example.test");
    await page.getByLabel("Confirm email").fill("bundle@example.test");
    await page.getByRole("button", { name: "Continue to secure payment" }).click();

    await page.waitForURL("**/tickets/order/success*");
  });

  test("shows eligible discount entry and submits the authoritative code", async ({ page }) => {
    await routePublicBasics(page);
    let checkoutBody: unknown = null;
    await page.route("**/api/public/tickets/discount-availability*", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ hasRedeemableCode: true }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/public/tickets/quote", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          discountAmountCents: 150,
          discountCode: "SPRING10",
          discountType: "percentage",
          discountValue: 10,
          discountedSubtotalCents: 1350,
          feeCents: 69,
          originalSubtotalCents: 1500,
          originalUnitPriceCents: 1500,
          quantity: 1,
          totalCents: 1419,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/public/tickets/checkout", async (route) => {
      checkoutBody = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify(checkoutResponse),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/tickets/" + eventId);
    const discountDisclosure = page.getByRole("button", { name: "Have a discount code?" });
    await expect(discountDisclosure).toBeVisible();
    await expect(discountDisclosure).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Discount code (optional)")).not.toBeVisible();

    await discountDisclosure.click();
    await expect(discountDisclosure).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Discount code (optional)")).toBeVisible();

    await page.getByLabel("Discount code (optional)").fill(" spring10 ");
    await page.getByRole("button", { name: "Apply code" }).click();
    await expect(page.getByText("SPRING10 applied")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
    await expect(page.getByLabel("Discount code (optional)")).not.toBeVisible();
    await expect(page.getByText("Discount (SPRING10): -$1.50")).toBeVisible();

    await page.getByLabel("Name on order").fill("Discount Buyer");
    await page.getByLabel("Email", { exact: true }).fill("discount@example.test");
    await page.getByLabel("Confirm email").fill("discount@example.test");
    await page.getByRole("button", { name: "Continue to secure payment" }).click();
    await page.waitForURL("**/tickets/order/success*");
    expect(checkoutBody).toMatchObject({ discountCode: "spring10" });
  });

  test("shows ticket receipt after purchase", async ({ page }) => {
    await routePublicBasics(page);
    await page.route("**/api/public/tickets/order*", async (route) => {
      await route.fulfill({
        body: JSON.stringify(receiptResponse),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/tickets/order/success?token=${successToken}`);

    await expect(page.getByRole("heading", { name: "Your tickets are confirmed" })).toBeVisible();
    await expect(page.getByText("Staging simulation: no payment card was charged.")).toBeVisible();
    await expect(page.getByText("Jane Buyer")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spring Concert", level: 2 })).toBeVisible();
    await expect(page.getByText("$15.74")).toBeVisible();
    await expect(page.getByRole("img", { name: /Admission QR code/ })).toBeVisible();
    await expect(page.locator("code.ticket-credential")).not.toBeVisible();
  });

  test("shows the full bundle pass on the receipt without mobile or print overflow", async ({
    page,
  }) => {
    await routePublicBasics(page);
    await page.route("**/api/public/tickets/order*", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ...receiptResponse,
          bundleId,
          bundleTitle: "Season Pass",
          includedEvents: [
            {
              id: secondPerformanceId,
              location: "Riverfront Hall",
              startsAt: futureIsoDate({ days: 360 }),
              title: "Winter Choral Concert",
              venueAddress: "200 State Street, Dayton, OH",
              venueName: "Cathedral Hall",
            },
            {
              id: eventId,
              location: "Concert Hall",
              startsAt: futureDate,
              title: "Spring Concert",
              venueAddress: "100 Church Street, Dayton, OH",
              venueName: "Grace Chapel",
            },
          ],
          scanToken,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/tickets/order/success?token=${successToken}`);

    const passCard = page.getByRole("article", { name: "Bundle pass admission credential" });
    await expect(passCard.getByRole("heading", { name: "Your bundle pass" })).toBeVisible();
    await expect(passCard.getByRole("heading", { name: "Season Pass" })).toBeVisible();
    await expect(passCard.getByText("Includes 2 concerts")).toBeVisible();
    await expect(passCard.getByRole("heading", { name: "Spring Concert", level: 4 })).toBeVisible();
    await expect(
      passCard.getByRole("heading", { name: "Winter Choral Concert", level: 4 }),
    ).toBeVisible();
    await expect(
      passCard.getByRole("img", {
        name: /Bundle pass QR code .* valid for all 2 included concerts/,
      }),
    ).toBeVisible();
    const summary = page.getByRole("region", { name: "Purchase summary" });
    await expect(summary).toBeVisible();
    await expect(summary.getByText("Season Pass")).not.toBeVisible();
    await expect(summary.getByRole("list")).toHaveCount(0);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.emulateMedia({ media: "print" });
    await expect(passCard).toBeVisible();
    await expect(summary).toBeVisible();
  });

  test("shows pending receipt and transitions to confirmed after polling", async ({ page }) => {
    await routePublicBasics(page);
    let pollCount = 0;
    await page.route("**/api/public/tickets/order*", async (route) => {
      pollCount++;
      if (pollCount === 1) {
        await route.fulfill({
          body: JSON.stringify({
            ...receiptResponse,
            scanToken: null,
            status: "pending",
          }),
          contentType: "application/json",
          status: 200,
        });
      } else {
        await route.fulfill({
          body: JSON.stringify(receiptResponse),
          contentType: "application/json",
          status: 200,
        });
      }
    });

    await page.goto(`/tickets/order/success?token=${successToken}`);

    await expect(page.getByRole("heading", { name: "Ticket order processing" })).toBeVisible();
    await expect(page.locator("code.ticket-credential")).not.toBeVisible();

    await expect(page.getByRole("heading", { name: "Your tickets are confirmed" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Admission QR code/ })).toBeVisible();
    await expect(page.locator("code.ticket-credential")).not.toBeVisible();
  });

  test("shows unavailable state when projection is missing", async ({ page }) => {
    await routeHealth(page);
    await routeAnonymousSession(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/public/commerce-projection", async (route) => {
      await route.fulfill({ status: 404 });
    });

    await page.goto("/tickets");

    await expect(page.getByText("Tickets are unavailable.")).toBeVisible();
  });
});
