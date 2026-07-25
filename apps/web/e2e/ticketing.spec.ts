import { expect, test, type Page } from "@playwright/test";

const requestId = "1f2e3d4c-5b6a-4789-8901-234567890abc";

const sessionResponse = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
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
    expiresAt: "2026-07-27T20:00:00.000Z",
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
const futureDate = "2027-06-15T19:30:00.000Z";
const saleEndDate = "2027-06-01T00:00:00.000Z";
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
        startsAt: "2026-08-01T14:00:00.000Z",
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
  marketingOptIn: true,
  providerPaymentId: "fake_payment_001",
  providerSessionId: "fake_session_001",
  updatedAt: "2026-07-23T15:00:00.000Z",
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
  test("shows available events and bundles", async ({ page }) => {
    await routePublicBasics(page);

    await page.goto("/tickets");

    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
    await expect(page.getByText("Spring Concert")).toBeVisible();
    await expect(page.getByText("Season Pass")).toBeVisible();
    await expect(page.getByText("Multi-performance pass")).toBeVisible();
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

    await page.getByLabel("Name for will call").fill("Jane Buyer");
    await page.getByLabel("Email", { exact: true }).fill("jane@example.test");
    await page.getByLabel("Confirm email").fill("jane@example.test");
    await page.getByLabel("Keep me informed about future Organization events").check();
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

    await page.getByLabel("Name for will call").fill("Bundle Buyer");
    await page.getByLabel("Email", { exact: true }).fill("bundle@example.test");
    await page.getByLabel("Confirm email").fill("bundle@example.test");
    await page.getByRole("button", { name: "Complete bundle order" }).click();

    await page.waitForURL("**/tickets/order/success*");
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
    await expect(page.getByText("Spring Concert")).toBeVisible();
    await expect(page.getByText("$15.74")).toBeVisible();
    await expect(page.locator("code.ticket-credential")).toContainText(scanToken);
  });

  test("shows unavailable state when projection is missing", async ({ page }) => {
    await routeHealth(page);
    await routeAnonymousSession(page);
    await page.route("**/api/public/projection", async (route) => {
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
  await page.route("**/api/auth/list-sessions", async (route) => {
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

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Jane Buyer" })).toBeVisible();
    await expect(page.getByText("jane@example.test")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Spring Concert" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$15.74" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "paid (simulation)" })).toBeVisible();
  });

  test("refunds a paid order via danger confirmation", async ({ page }) => {
    const refundedOrder = { ...adminOrder, status: "refunded" };
    let refundCalled = false;

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
    await page.route(`**/api/organization/tickets/${purchaseId}/refund`, async (route) => {
      refundCalled = true;
      await route.fulfill({
        body: JSON.stringify(refundedOrder),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
    await page.getByRole("button", { name: "Refund" }).click({ force: true });
    await expect(page.getByText("Refund this complete order?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click({ force: true });
    await expect(page.getByText("Refund this complete order?")).not.toBeVisible();

    await page.getByRole("button", { name: "Refund" }).click({ force: true });
    await expect(page.getByText("Refund this complete order?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm refund" }).click({ force: true });

    await expect(page.getByText("Ticket order refunded.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "refunded (simulation)" })).toBeVisible();
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

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
    await page.getByRole("button", { name: "Resend confirmation" }).click({ force: true });

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

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
    await expect(page.getByText("New ticket bundle")).toBeVisible();

    await page.getByLabel("Bundle title").fill("VIP Pass");
    await page.getByLabel("Price (USD)").fill("30.00");
    await page.getByLabel("Capacity (blank is unlimited)").fill("50");
    await page.getByLabel("Sale ends").fill("2027-06-01T00:00");
    await page.getByLabel("Active for public sale").check();
    await page.getByRole("checkbox", { name: "Spring Concert" }).check();
    await page.getByRole("button", { name: "Save bundle" }).click();

    await expect(
      page.getByText("Ticket bundle saved. Publish the public website to make it visible."),
    ).toBeVisible();
    await expect(page.getByText("VIP Pass")).toBeVisible();
    expect(bundleSaved).toBe(true);
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

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
    await expect(page.getByText("Season Pass")).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click({ force: true });

    await expect(page.getByText("Edit ticket bundle")).toBeVisible();
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

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
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

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
    await expect(page.getByText("Door validation")).toBeVisible();

    await page
      .getByRole("combobox", { name: "Performance" })
      .selectOption({ label: "Spring Concert" });
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

    await expect(page.getByRole("heading", { name: "Ticket Orders" })).toBeVisible();
    await expect(page.getByText("No ticket orders yet.")).toBeVisible();
    await expect(page.getByText("No bundles yet.")).toBeVisible();
  });
});
