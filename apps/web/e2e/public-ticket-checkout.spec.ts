import { expect, test } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";

const requestId = "0a4d96b2-58d2-4f24-a5c4-3ebf1fd6c721";
const eventId = "691684c6-7568-47e4-81ce-55fb0d638e29";
const purchaseId = "31b98689-cac1-4485-a1ed-6eb2bc76560e";
const startsAt = futureIsoDate({ days: 180 });

const projection = {
  generatedAt: "2026-09-23T00:00:00.000Z",
  organizationId: "public-ticket-checkout-org",
  payload: {
    mediaFileIds: [],
    organizationName: "Checkout Choir",
    performances: [
      {
        advancePriceCents: 1500,
        dayOfPriceCents: 1500,
        doorsOpenTime: "19:00",
        graphicFileId: null,
        id: eventId,
        isTicketingEnabled: true,
        location: "Main Hall",
        publicDetails: "",
        startsAt,
        ticketCapacity: 100,
        title: "Minimum charge concert",
        venueAddress: "",
        venueName: "Main Hall",
      },
    ],
    settings: {
      aboutUsText: "",
      bodyFont: "system",
      contactEmail: "",
      enabledNavigation: ["tickets"],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: "Checkout Choir",
      heroSubtitle: "",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [],
    timezone: "America/New_York",
  },
  version: 1,
};

test("rejects a discounted sub-fifty-cent ticket before checkout and permits a corrected attempt", async ({
  page,
}) => {
  let checkoutCalls = 0;
  let checkoutRequestId: string | null = null;

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({
      body: JSON.stringify(projection),
      contentType: "application/json",
      status: 200,
    });
  });
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
        discountAmountCents: 1489,
        discountCode: "MIN43",
        discountType: "fixed",
        discountValue: 1489,
        discountedSubtotalCents: 11,
        feeCents: 32,
        originalSubtotalCents: 1500,
        originalUnitPriceCents: 1500,
        quantity: 1,
        totalCents: 43,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/tickets/checkout", async (route) => {
    checkoutCalls += 1;
    const body: unknown = route.request().postDataJSON();
    if (typeof body === "object" && body !== null && "checkoutRequestId" in body) {
      checkoutRequestId =
        typeof body.checkoutRequestId === "string" ? body.checkoutRequestId : null;
    }
    await route.fulfill({
      body: JSON.stringify({
        checkoutMode: "fake",
        purchase: {
          amountPaidCents: 1574,
          bundleId: null,
          bundleTitle: "",
          buyerName: "Minimum Buyer",
          checkoutMode: "fake",
          currency: "usd",
          eventId,
          eventStartsAt: startsAt,
          eventTitle: "Minimum charge concert",
          feeCents: 74,
          id: purchaseId,
          includedEvents: [],
          quantity: 1,
          status: "paid",
          timezone: "America/New_York",
          unitPriceCents: 1500,
        },
        successToken: "public-ticket-checkout-token",
        url: "http://127.0.0.1:4173/tickets/order/success?token=public-ticket-checkout-token",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/tickets/${eventId}`);
  await page.getByRole("button", { name: "Have a discount code?" }).click();
  await page.getByLabel("Discount code (optional)").fill("min43");
  await page.getByRole("button", { name: "Apply code" }).click();

  await expect(page.getByText("MIN43 applied")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Card payments must total at least $0.50");
  await expect(page.getByRole("button", { name: "Complete ticket order" })).toBeDisabled();
  expect(checkoutCalls).toBe(0);
  await expect(page).toHaveURL(new RegExp(`/tickets/${eventId}$`));

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete ticket order" })).toBeEnabled();

  await page.getByLabel("Name on order").fill("Minimum Buyer");
  await page.getByLabel("Email", { exact: true }).fill("minimum@example.test");
  await page.getByLabel("Confirm email").fill("minimum@example.test");
  await page.getByRole("button", { name: "Complete ticket order" }).click();

  await page.waitForURL("**/tickets/order/success?token=public-ticket-checkout-token");
  expect(checkoutCalls).toBe(1);
  expect(checkoutRequestId).toMatch(/^[0-9a-f-]{36}$/i);
});
