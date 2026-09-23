import { expect, test, type Page } from "@playwright/test";
import { futureDateString, futureIsoDate, pastIsoDate } from "@choir/testkit";

const requestId = "1f2e3d4c-5b6a-4789-8901-234567890abc";

const sessionResponse = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: futureIsoDate({ days: 7 }),
    id: "session-ticketing-admin",
    ipAddress: "192.0.2.30",
    token: "ticketing-admin-session-token",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-ticketing-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "tickets.admin@example.test",
    emailVerified: true,
    id: "user-ticketing-admin",
    image: null,
    name: "Ticket Admin",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T20:00:00.000Z",
  },
};

const organizationsResponse = {
  organizations: [
    {
      canonicalHostname: "tickets.example.test",
      canonicalStatus: "active",
      lifecycleState: "active",
      name: "Ticket Choir",
      organizationId: "org-ticket-test",
      profileId: null,
      role: "administrator",
      slug: "tickets",
    },
  ],
};

const authStatusResponse = {
  mfaRequired: false,
  mfaVerifiedUntil: null,
  organizationId: "org-ticket-test",
  requestId,
  role: "administrator",
  twoFactorEnabled: false,
  twoFactorVerified: false,
};

const organizationContextResponse = {
  organizationId: "org-ticket-test",
  requestId,
  role: "administrator",
  userId: "user-ticketing-admin",
};

const sessionsListResponse = [
  {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: futureIsoDate({ days: 7 }),
    id: "session-ticketing-admin",
    ipAddress: "192.0.2.30",
    token: "ticketing-admin-session-token",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-ticketing-admin",
  },
];

const eventId = "74e47064-75b9-47e9-97e6-c28f5430bee0";
const bundleId = "6ab6bf88-c618-4bcd-b452-3aadebd28aa6";
const purchaseId = "8de2c455-72c5-4117-92a0-b2bc77b05706";
const newBundleId = "25fd0bbd-2438-458b-877b-5e5032e31cde";
const secondPerformanceId = "0dc9043e-09b7-41f1-bcde-7f26c3f03dc1";
const futureDate = futureIsoDate({ days: 300 });
const saleEndDate = futureIsoDate({ days: 280 });
const saleEndInputValue = `${futureDateString({ days: 280 })}T00:00`;
const successToken = "ticket-receipt-token-for-e2e-test";
const scanToken = "ticket-scan-token-for-e2e-test";

const ticketingProjection = {
  generatedAt: "2026-07-24T00:00:00.000Z",
  organizationId: "org-ticket-test",
  payload: {
    mediaFileIds: [],
    organizationName: "Ticket Choir",
    performances: [
      {
        advancePriceCents: 1500,
        dayOfPriceCents: 2000,
        doorsOpenTime: "19:00",
        graphicFileId: null,
        id: eventId,
        isTicketingEnabled: true,
        location: "Concert Hall",
        publicDetails: "A wonderful evening of music.",
        startsAt: futureDate,
        ticketCapacity: 200,
        title: "Spring Concert",
        venueName: "Grand Auditorium",
      },
      {
        advancePriceCents: 0,
        dayOfPriceCents: 0,
        doorsOpenTime: "",
        graphicFileId: null,
        id: secondPerformanceId,
        isTicketingEnabled: false,
        location: "",
        publicDetails: "",
        startsAt: pastIsoDate({ days: 30 }),
        ticketCapacity: null,
        title: "Past Rehearsal",
        venueName: "",
      },
    ],
    settings: {
      aboutUsText: "We sing.",
      bodyFont: "system",
      contactEmail: "",
      enabledNavigation: ["tickets"],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: "Welcome",
    },
    ticketBundles: [
      {
        capacity: 100,
        eventIds: [eventId],
        id: bundleId,
        priceCents: 2500,
        saleEndAt: saleEndDate,
        title: "Season Pass",
      },
    ],
    timezone: "America/New_York",
  },
  version: 1,
};

const purchaseResponse = {
  amountPaidCents: 1574,
  bundleId: null,
  bundleTitle: "",
  buyerName: "Jane Buyer",
  checkoutMode: "fake",
  currency: "usd",
  eventId,
  eventStartsAt: futureDate,
  eventTitle: "Spring Concert",
  feeCents: 74,
  id: purchaseId,
  includedEvents: [],
  quantity: 1,
  status: "paid",
  timezone: "America/New_York",
  unitPriceCents: 1500,
};

const receiptResponse = {
  ...purchaseResponse,
  requestId,
  scanToken,
};

const checkoutResponse = {
  checkoutMode: "fake",
  purchase: purchaseResponse,
  successToken,
  url: `http://127.0.0.1:4173/tickets/order/success?token=${successToken}`,
};

const adminOrder = {
  ...purchaseResponse,
  buyerEmail: "jane@example.test",
  createdAt: "2026-07-23T15:00:00.000Z",
  discountAmountCents: 150,
  discountCode: "SPRING10",
  discountType: "percentage",
  discountValue: 10,
  marketingOptIn: true,
  providerPaymentId: "fake_payment_001",
  providerSessionId: "fake_session_001",
  updatedAt: "2026-07-23T15:00:00.000Z",
};

const bundleAdminOrder = {
  ...adminOrder,
  buyerEmail: "bundle.buyer@example.test",
  buyerName: "Bundle Buyer",
  bundleId,
  bundleTitle: "Season Pass",
  discountAmountCents: 0,
  discountCode: null,
  discountType: null,
  discountValue: null,
  id: "cf6226fc-5c0c-4957-8735-5c72b1c68d31",
};

const sortableAdminOrder = {
  ...adminOrder,
  amountPaidCents: 900,
  buyerEmail: "alex@example.test",
  buyerName: "Alex Anderson",
  createdAt: "2026-07-23T14:00:00.000Z",
  discountAmountCents: 0,
  discountCode: null,
  discountType: null,
  discountValue: null,
  feeCents: 0,
  id: "f1d0c8b4-0a67-4c12-a6a4-5db0d4d4b9d4",
  status: "pending",
  unitPriceCents: 900,
  updatedAt: "2026-07-23T14:00:00.000Z",
};

const adminBundle = {
  capacity: 100,
  createdAt: "2026-07-01T00:00:00.000Z",
  eventIds: [eventId],
  id: bundleId,
  isActive: true,
  priceCents: 2500,
  saleEndAt: saleEndDate,
  title: "Season Pass",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const adminDiscountCode = {
  active: true,
  bundleId: null,
  code: "SPRING10",
  createdAt: "2026-07-01T00:00:00.000Z",
  deactivatedAt: null,
  discountAmountCents: 0,
  discountType: "percentage",
  discountValue: 10,
  editable: true,
  eventId,
  firstRedeemedAt: null,
  id: "b5cba6a0-6c8f-44a8-8c6e-20a1b1c6b3a1",
  itemTitle: "Spring Concert",
  itemType: "performance",
  originalRevenueCents: 0,
  pendingReservationCount: 0,
  redemptionCount: 0,
  redemptionLimit: 10,
  revenueCents: 0,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const redeemedAdminDiscountCode = {
  ...adminDiscountCode,
  firstRedeemedAt: "2026-07-23T13:00:00.000Z",
  redemptionCount: 3,
};

const adminEvent = {
  advancePriceCents: 1500,
  callTime: "",
  createdAt: "2025-01-01T00:00:00.000Z",
  dayOfPriceCents: 2000,
  details: "",
  doorsOpenTime: "19:00",
  durationMinutes: null,
  id: eventId,
  isTicketingEnabled: true,
  location: "Concert Hall",
  parentPerformanceId: null,
  publicDetails: "",
  publicGraphicFileId: null,
  publishOnWebsite: true,
  setList: [],
  setListApproved: false,
  startsAt: futureDate,
  ticketCapacity: 200,
  title: "Spring Concert",
  type: "Performance",
  updatedAt: "2026-07-01T00:00:00.000Z",
  venueId: null,
};

const secondAdminEvent = {
  ...adminEvent,
  id: secondPerformanceId,
  startsAt: futureIsoDate({ days: 320 }),
  title: "Winter Concert",
};

const refundedDiscountAdminOrder = {
  ...adminOrder,
  buyerEmail: "refunded.discount@example.test",
  buyerName: "Refunded Discount Buyer",
  createdAt: "2026-07-23T13:00:00.000Z",
  id: "1ab2c3d4-e5f6-4789-8abc-0123456789ab",
  status: "refunded",
};

const pendingDiscountAdminOrder = {
  ...adminOrder,
  buyerEmail: "pending.discount@example.test",
  buyerName: "Pending Discount Buyer",
  createdAt: "2026-07-23T12:00:00.000Z",
  id: "2ab2c3d4-e5f6-4789-8abc-0123456789ab",
  status: "pending",
};

const secondPerformanceDiscountAdminOrder = {
  ...adminOrder,
  buyerEmail: "winter.discount@example.test",
  buyerName: "Winter Discount Buyer",
  createdAt: "2026-07-23T11:00:00.000Z",
  eventId: secondPerformanceId,
  eventStartsAt: secondAdminEvent.startsAt,
  eventTitle: secondAdminEvent.title,
  id: "3ab2c3d4-e5f6-4789-8abc-0123456789ab",
};

function routeHealth(page: Page) {
  return page.route("**/api/health", async (route) => {
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
}

function routeAnonymousSession(page: Page) {
  return page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
}

function routeProjection(page: Page) {
  return page.route("**/api/public/projection", async (route) => {
    await route.fulfill({
      body: JSON.stringify(ticketingProjection),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function routePublicBasics(page: Page) {
  await routeHealth(page);
  await routeAnonymousSession(page);
  await routeProjection(page);
}

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
    await expect(page.getByText("Doors open at 19:00.")).toBeVisible();

    await page.getByLabel("Name on order").fill("Jane Buyer");
    await page.getByLabel("Email", { exact: true }).fill("jane@example.test");
    await page.getByLabel("Confirm email").fill("jane@example.test");
    await page
      .getByLabel("I would like to receive updates about future events and programs")
      .check();
    await page.getByRole("button", { name: "Complete ticket order" }).click();

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
    await page.getByRole("button", { name: "Complete bundle order" }).click();

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
    await page.getByRole("button", { name: "Complete ticket order" }).click();
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

async function routeAdminAuth(page: Page) {
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessionResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify(organizationsResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessionsListResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify(authStatusResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/context", async (route) => {
    await route.fulfill({
      body: JSON.stringify(organizationContextResponse),
      contentType: "application/json",
      status: 200,
    });
  });
}

test.describe("admin ticket management", () => {
  test("lists orders with buyer, performance, quantity, total, and status", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [adminOrder, sortableAdminOrder, bundleAdminOrder],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const performanceSummary = page.getByRole("group", { name: "Performance summary" });
    await expect(performanceSummary).toBeVisible();
    await expect(performanceSummary.locator("legend")).toHaveText("Performance summary");
    await expect(performanceSummary.locator("h3")).toHaveCount(0);
    const willCallChecklist = page.getByRole("group", { name: "Will call checklist" });
    await expect(willCallChecklist).toBeVisible();
    await expect(willCallChecklist.locator("legend")).toHaveText("Will call checklist");
    await expect(willCallChecklist.locator("h3")).toHaveCount(0);
    const visibleOrders = page.locator(".data-table:visible, .data-table-cards:visible");
    await expect(visibleOrders.getByText("Jane Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("jane@example.test", { exact: true })).toBeVisible();
    await expect(visibleOrders.locator(".ticket-discount-code-pill")).toHaveText("SPRING10");
    await expect(page.getByRole("status")).toContainText("Updates automatically every 5 seconds.");
    await expect(
      page.locator(".ticket-dashboard__metric--sold").getByText("Spring Concert", { exact: true }),
    ).toBeVisible();
    await expect(visibleOrders.getByText("$15.74", { exact: true }).first()).toBeVisible();
    await expect(
      visibleOrders.getByText("Paid (simulation)", { exact: true }).first(),
    ).toBeVisible();

    const orderRows = visibleOrders.locator("tbody tr, .data-table-card");
    await expect(orderRows).toHaveCount(3);
    const bundleRow = orderRows.filter({ hasText: "Bundle Buyer" });
    await expect(bundleRow).toHaveCount(1);
    await expect(bundleRow.locator(".ticketing-bundle-order-pill")).toHaveText("Bundle");
    const standaloneRow = orderRows.filter({ hasText: "Jane Buyer" });
    await expect(standaloneRow.locator(".ticketing-bundle-order-pill")).toHaveCount(0);
    const regularRow = orderRows.filter({ hasText: "Alex Anderson" });
    await expect(regularRow.locator('[aria-label="No discount code"]')).toHaveText("—");
    const buyerSortButton = page.getByRole("button", { name: "Sort by Buyer name" });
    if ((await buyerSortButton.count()) > 0 && (await buyerSortButton.isVisible())) {
      await buyerSortButton.click();
      await expect(orderRows.first().getByText("Alex Anderson", { exact: true })).toBeVisible();
      await buyerSortButton.click();
      await expect(orderRows.first().getByText("Jane Buyer", { exact: true })).toBeVisible();
    }
    const discountSortButton = page.getByRole("button", { name: "Sort by Discount code" });
    if ((await discountSortButton.count()) > 0 && (await discountSortButton.isVisible())) {
      await discountSortButton.click();
      await expect(discountSortButton.locator("xpath=ancestor::th")).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
    }
    if ((page.viewportSize()?.width ?? 0) <= 600) {
      const discountedCard = visibleOrders.locator(".data-table-card").filter({
        hasText: "Jane Buyer",
      });
      await expect(discountedCard.getByText("Discount code", { exact: true })).toBeVisible();
      await expect(discountedCard.locator(".ticket-discount-code-pill")).toHaveText("SPRING10");
    }
    if ((page.viewportSize()?.width ?? 0) <= 600) {
      const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
    }
  });

  test("drills into confirmed discount redemptions and restores the normal list", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [
            adminOrder,
            refundedDiscountAdminOrder,
            pendingDiscountAdminOrder,
            secondPerformanceDiscountAdminOrder,
            sortableAdminOrder,
          ],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent, secondAdminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/discount-codes", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ codes: [redeemedAdminDiscountCode], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const willCallSearch = page.getByRole("searchbox", { name: "Search", exact: true });
    await willCallSearch.fill("Pending Discount Buyer");
    await page.getByRole("tab", { name: "Discount Codes" }).click();

    const discountPanel = page.locator("#ticketing-discounts-panel");
    const redemptionButton = discountPanel.getByRole("button", {
      name: "View 3 redemptions for SPRING10",
    });
    await expect(redemptionButton).toBeVisible();
    await expect(redemptionButton.locator("..")).toContainText("/10");
    await redemptionButton.press("Enter");

    await expect(page.getByRole("tab", { name: "Concert Will Call" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("Select performance")).toHaveValue("all");
    await expect(willCallSearch).toHaveValue("");
    await expect(page.locator(".ticket-dashboard__active-filter")).toContainText(
      "Filtering by discount code: SPRING10",
    );
    await expect(page.getByRole("checkbox", { name: "Show refunded" })).toBeChecked();

    const visibleOrders = page.locator(".data-table:visible, .data-table-cards:visible");
    await expect(visibleOrders.getByText("Jane Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Refunded Discount Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Winter Discount Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Pending Discount Buyer", { exact: true })).toHaveCount(0);
    await expect(visibleOrders.getByText("Alex Anderson", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page.locator(".ticket-dashboard__active-filter")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Show refunded" })).not.toBeChecked();
    await expect(visibleOrders.getByText("Refunded Discount Buyer", { exact: true })).toHaveCount(
      0,
    );
    await expect(visibleOrders.getByText("Pending Discount Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Alex Anderson", { exact: true })).toBeVisible();
  });

  test("shows a bundle pill beside bundle buyers without page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const archivedBundleOrder = {
      ...sortableAdminOrder,
      bundleId: newBundleId,
      bundleTitle: "Archived Bundle",
      buyerEmail: "zara@example.test",
      buyerName: "Zara Anderson",
      createdAt: "2026-07-23T16:00:00.000Z",
    };
    const currentBundleOrder = {
      ...bundleAdminOrder,
      bundleTitle: "Former Season Pass title",
      buyerName: "Alex Zulu",
      createdAt: "2026-07-23T15:00:00.000Z",
    };
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [currentBundleOrder, archivedBundleOrder, adminOrder],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Bundle Orders" }).click();

    const bundleOrdersPanel = page.locator("#ticketing-orders-panel");
    const orderTable = bundleOrdersPanel.locator("table.data-table");
    await expect(orderTable).toBeVisible();
    await expect(orderTable.locator("thead th")).toHaveCount(8);
    await expect(orderTable.locator("thead th")).toHaveText([
      "Buyer ↕",
      "Email ↕",
      "Sale date ↓",
      "Bundle ↕",
      "Qty ↕",
      "Amount paid ↕",
      "Status ↕",
      "Actions",
    ]);
    for (const header of [
      "Buyer",
      "Email",
      "Sale date",
      "Bundle",
      "Qty",
      "Amount paid",
      "Status",
    ]) {
      await expect(orderTable.getByRole("button", { name: `Sort by ${header}` })).toBeVisible();
    }
    await expect(orderTable.getByRole("button", { name: "Sort by Actions" })).toHaveCount(0);

    const orderRows = orderTable.locator("tbody tr");
    await expect(orderRows).toHaveCount(2);
    await expect(orderRows.first().locator("td").first()).toContainText("Zara Anderson");
    await expect(orderTable.locator("thead th").nth(2)).toHaveAttribute("aria-sort", "descending");

    const bundleRow = orderRows.filter({ hasText: "Alex Zulu" });
    const archivedRow = orderRows.filter({ hasText: "Zara Anderson" });
    await expect(bundleRow.locator("td")).toHaveCount(8);
    await expect(bundleRow.locator("td").first()).toContainText("Alex Zulu");
    await expect(bundleRow.locator(".ticketing-bundle-order-pill")).toHaveText("Bundle");
    await expect(bundleRow.locator("td").nth(3)).toHaveText("Season Pass");
    await expect(archivedRow.locator("td").nth(3)).toHaveText("Archived Bundle");
    await expect(bundleRow.locator("td").nth(6)).toContainText("Paid (simulation)");
    await expect(archivedRow.locator("td").nth(6)).toContainText("pending (simulation)");

    await orderTable.getByRole("button", { name: "Sort by Buyer" }).click();
    await expect(orderTable.locator("thead th").first()).toHaveAttribute("aria-sort", "ascending");
    await expect(orderRows.first().locator("td").first()).toContainText("Zara Anderson");

    const bundleSortButton = orderTable.getByRole("button", { name: "Sort by Bundle" });
    await bundleSortButton.focus();
    await bundleSortButton.press("Enter");
    await expect(bundleSortButton).toBeFocused();
    await expect(orderTable.locator("thead th").nth(3)).toHaveAttribute("aria-sort", "ascending");
    await expect(orderRows.first().locator("td").nth(3)).toHaveText("Archived Bundle");

    await orderTable.getByRole("button", { name: "Sort by Status" }).click();
    await expect(orderRows.first().locator("td").nth(6)).toContainText("Paid (simulation)");

    const checkPageLayout = async () =>
      page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#ticketing-orders-panel");
        const scrollArea = panel?.querySelector<HTMLElement>(".table-scroll");
        if (!panel || !scrollArea) {
          throw new Error("Bundle orders layout is missing its panel or table scroll area.");
        }
        return {
          pageClientWidth: document.documentElement.clientWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
          panelClientWidth: panel.clientWidth,
          scrollAreaClientWidth: scrollArea.clientWidth,
          scrollAreaOverflowX: getComputedStyle(scrollArea).overflowX,
        };
      });

    for (const viewport of [
      { height: 900, width: 1280 },
      { height: 844, width: 390 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await checkPageLayout();
      expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageClientWidth);
      expect(layout.scrollAreaClientWidth).toBeLessThanOrEqual(layout.panelClientWidth);
      expect(layout.scrollAreaOverflowX).toBe("auto");
    }

    await expect(bundleOrdersPanel.locator(".data-table-cards")).toBeVisible();
    const bundleCards = bundleOrdersPanel.locator(".data-table-card");
    await expect(bundleCards).toHaveCount(2);
    const currentBundleCard = bundleCards.filter({ hasText: "Alex Zulu" });
    await expect(currentBundleCard.locator(".data-table-card__field")).toHaveCount(8);
    await expect(currentBundleCard.locator(".ticketing-bundle-order-pill")).toHaveText("Bundle");
    await expect(currentBundleCard.getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(currentBundleCard.getByRole("button", { name: "Refund" })).toBeVisible();
  });

  test("keeps bundle order resend and refund confirmation actions working", async ({ page }) => {
    let currentOrder = { ...bundleAdminOrder };
    let resendCalled = false;
    let refundCalled = false;

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [currentOrder], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(
      `**/api/organization/tickets/${bundleAdminOrder.id}/confirmation`,
      async (route) => {
        resendCalled = true;
        await route.fulfill({
          body: JSON.stringify({ status: "queued" }),
          contentType: "application/json",
          status: 200,
        });
      },
    );
    await page.route(`**/api/organization/tickets/${bundleAdminOrder.id}/refund`, async (route) => {
      refundCalled = true;
      currentOrder = { ...currentOrder, status: "refunded" };
      await route.fulfill({
        body: JSON.stringify(currentOrder),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Bundle Orders" }).click();

    const bundleOrdersPanel = page.locator("#ticketing-orders-panel");
    const visibleOrders = bundleOrdersPanel.locator(
      ".data-table:visible, .data-table-cards:visible",
    );
    await expect(visibleOrders.getByText("Paid (simulation)", { exact: true })).toBeVisible();

    const resendButton = visibleOrders.getByRole("button", { name: "Resend" });
    await resendButton.focus();
    await resendButton.press("Enter");
    await expect(page.getByText("Ticket confirmation queued.")).toBeVisible();
    expect(resendCalled).toBe(true);

    await visibleOrders.getByRole("button", { name: "Refund" }).click();
    await expect(
      visibleOrders.getByText("Refund this complete order?", { exact: true }),
    ).toBeVisible();
    await visibleOrders.getByRole("button", { name: "Cancel" }).click();
    await expect(
      visibleOrders.getByText("Refund this complete order?", { exact: true }),
    ).not.toBeVisible();

    await visibleOrders.getByRole("button", { name: "Refund" }).click();
    await expect(
      visibleOrders.getByText("Refund this complete order?", { exact: true }),
    ).toBeVisible();
    await visibleOrders.getByRole("button", { name: "Confirm refund" }).click();

    await expect(page.getByText("Ticket order refunded.")).toBeVisible();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toHaveCount(0);
    await bundleOrdersPanel.getByRole("checkbox", { name: "Show refunded" }).check();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toBeVisible();
    expect(refundCalled).toBe(true);
  });

  test("auto-selects the performance closest to today in will call", async ({ page }) => {
    const nearEvent = {
      ...adminEvent,
      id: "33333333-3333-4333-8333-333333333333",
      startsAt: futureIsoDate({ days: 2 }),
      title: "Nearest Concert",
    };
    const farEvent = {
      ...adminEvent,
      id: "44444444-4444-4444-8444-444444444444",
      startsAt: futureIsoDate({ days: 90 }),
      title: "Singing the 70s",
    };

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [farEvent, nearEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const performanceSelect = page.getByLabel("Select performance");
    await expect(performanceSelect).toHaveValue(nearEvent.id);
    await expect(
      page.locator(".ticket-dashboard__metric--sold").getByText("Nearest Concert", { exact: true }),
    ).toBeVisible();
  });

  test("refunds a paid order via danger confirmation", async ({ page }) => {
    let currentOrder = { ...adminOrder };
    let refundCalled = false;

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [currentOrder], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/${purchaseId}/refund`, async (route) => {
      refundCalled = true;
      currentOrder = { ...currentOrder, status: "refunded" };
      await route.fulfill({
        body: JSON.stringify(currentOrder),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const visibleOrders = page.locator(".data-table:visible, .data-table-cards:visible");
    await visibleOrders.getByRole("button", { name: "Refund" }).click({ force: true });
    await expect(
      visibleOrders.getByText("Refund this complete order?", { exact: true }),
    ).toBeVisible();
    await visibleOrders.getByRole("button", { name: "Cancel" }).click({ force: true });
    await expect(
      visibleOrders.getByText("Refund this complete order?", { exact: true }),
    ).not.toBeVisible();

    await visibleOrders.getByRole("button", { name: "Refund" }).click({ force: true });
    await expect(
      visibleOrders.getByText("Refund this complete order?", { exact: true }),
    ).toBeVisible();
    await visibleOrders.getByRole("button", { name: "Confirm refund" }).click({ force: true });

    await expect(page.getByText("Ticket order refunded.")).toBeVisible();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Show refunded" }).check();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toBeVisible();
    expect(refundCalled).toBe(true);
  });

  test("resends ticket confirmation for a paid order", async ({ page }) => {
    let resendCalled = false;

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [adminOrder], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/${purchaseId}/confirmation`, async (route) => {
      resendCalled = true;
      await route.fulfill({
        body: JSON.stringify({ status: "queued" }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("button", { name: "Resend" }).click({ force: true });

    await expect(page.getByText("Ticket confirmation queued.")).toBeVisible();
    expect(resendCalled).toBe(true);
  });

  test("creates a new ticket bundle", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let bundleSaved = false;
    const createdBundleId = newBundleId;
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      if (route.request().method() === "POST") {
        bundleSaved = true;
        await route.fulfill({
          body: JSON.stringify({
            capacity: 50,
            createdAt: "2026-07-24T00:00:00.000Z",
            eventIds: [eventId],
            id: createdBundleId,
            isActive: true,
            priceCents: 3000,
            saleEndAt: saleEndDate,
            title: "VIP Pass",
            updatedAt: "2026-07-24T00:00:00.000Z",
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ bundles: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("New ticket bundle")).toBeVisible();
    await page.getByRole("button", { name: "New ticket bundle" }).click();

    await page.getByLabel("Bundle title").fill("VIP Pass");
    await page.getByLabel("Price (USD)").fill("30.00");
    await page.getByLabel("Capacity (blank is unlimited)").fill("50");
    await page.getByLabel("Sale ends").fill(saleEndInputValue);
    await page.getByLabel("Active for public sale").check();
    await page.getByRole("checkbox", { name: "Spring Concert" }).check();
    await page.getByRole("button", { name: "Save bundle" }).click();

    await expect(
      page.getByText("Ticket bundle saved. Publish the public website to make it visible."),
    ).toBeVisible();
    await expect(page.getByText("VIP Pass")).toBeVisible();
    expect(bundleSaved).toBe(true);
  });

  test("creates a discount code and clears its saved notice when leaving the tab", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    let savedBody: unknown = null;
    let discountCodeSaved = false;
    await page.route("**/api/organization/tickets/discount-codes", async (route) => {
      if (route.request().method() === "POST") {
        savedBody = route.request().postDataJSON();
        discountCodeSaved = true;
        await route.fulfill({
          body: JSON.stringify({ ...adminDiscountCode, requestId }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ codes: discountCodeSaved ? [adminDiscountCode] : [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await page.getByRole("tab", { name: "Discount Codes" }).click();
    await expect(page.getByText("No discount codes yet.")).toBeVisible();
    await page.getByRole("button", { name: "New discount code" }).click();
    const dialog = page.getByRole("dialog", { name: "New discount code" });
    await dialog.getByRole("textbox", { name: "Code" }).fill("SPRING10");
    await dialog.getByLabel("Eligible item").selectOption({ label: "Spring Concert" });
    await dialog.getByLabel("Percentage (1–100)").fill("10");
    await dialog.getByLabel("Redemption limit (blank is unlimited)").fill("10");
    await page.clock.install();
    await dialog.getByRole("button", { name: "Save discount code" }).click();

    await expect(page.getByText("Discount code saved.")).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("Discount code saved.")).toHaveCount(0);
    await page.getByRole("tab", { name: "Discount Codes" }).click();
    await expect(page.getByText("Discount code saved.")).toHaveCount(0);
    const discountResults = page.locator(".data-table:visible, .data-table-cards:visible");
    await expect(discountResults.getByText("SPRING10", { exact: true }).first()).toBeVisible();
    await expect(discountResults.getByText("10%", { exact: true }).first()).toBeVisible();
    expect(savedBody).toMatchObject({
      code: "SPRING10",
      discountType: "percentage",
      discountValue: 10,
      eventId,
    });
  });

  test("edits an existing ticket bundle", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let putReceived = false;
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/bundles/${bundleId}`, async (route) => {
      if (route.request().method() === "PUT") {
        putReceived = true;
        await route.fulfill({
          body: JSON.stringify({
            ...adminBundle,
            priceCents: 3500,
            title: "Updated Season Pass",
            updatedAt: "2026-07-24T00:00:00.000Z",
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("Season Pass")).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click({ force: true });

    await expect(page.getByRole("dialog", { name: "Edit ticket bundle" })).toBeVisible();
    await expect(page.getByLabel("Bundle title")).toHaveValue("Season Pass");
    await expect(page.getByLabel("Price (USD)")).toHaveValue("25.00");

    await page.getByLabel("Bundle title").fill("Updated Season Pass");
    await page.getByLabel("Price (USD)").fill("35.00");
    await page.getByRole("button", { name: "Save bundle" }).click();

    await expect(
      page.getByText("Ticket bundle saved. Publish the public website to make it visible."),
    ).toBeVisible();
    await expect(page.getByText("Updated Season Pass")).toBeVisible();
    await expect(page.getByText("$35.00")).toBeVisible();
    expect(putReceived).toBe(true);
  });

  test("deletes a ticket bundle", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let deleteCalled = false;
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/bundles/${bundleId}`, async (route) => {
      if (route.request().method() === "DELETE") {
        deleteCalled = true;
      }
      await route.fulfill({ status: 200 });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("Season Pass")).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click({ force: true });

    await expect(page.getByText("Ticket bundle deleted.")).toBeVisible();
    await expect(page.getByText("Season Pass")).not.toBeVisible();
    expect(deleteCalled).toBe(true);
  });

  test("validates a ticket scan at the door", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let scanBody: unknown = null;
    await page.route("**/api/organization/tickets/scan", async (route) => {
      scanBody = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({
          buyerName: "Jane Buyer",
          eventId,
          eventStartsAt: futureDate,
          eventTitle: "Spring Concert",
          purchaseId,
          quantity: 1,
          requestId,
          valid: true,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets/scan");

    await expect(page.getByRole("heading", { name: "Scan tickets" })).toBeVisible();

    await page.getByRole("combobox", { name: "Performance" }).selectOption(eventId);
    await page.getByLabel("Ticket credential").fill(scanToken);
    await page.getByRole("button", { name: "Validate ticket" }).click();

    await expect(page.getByText("Valid: Jane Buyer, 1 ticket.")).toBeVisible();
    expect(scanBody).toBeTruthy();
    expect(
      typeof scanBody === "object" &&
        scanBody !== null &&
        "token" in scanBody &&
        scanBody.token === scanToken,
    ).toBe(true);
  });

  test("shows empty state when no ticket orders exist", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await expect(page.getByText("No ticket orders yet.")).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("No bundles yet.")).toBeVisible();
  });
});
