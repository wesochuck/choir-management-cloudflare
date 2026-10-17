import type { Page } from "@playwright/test";
import { futureDateString, futureIsoDate, pastIsoDate } from "@choir/testkit";

export const requestId = "1f2e3d4c-5b6a-4789-8901-234567890abc";

export const sessionResponse = {
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

export const organizationsResponse = {
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

export const authStatusResponse = {
  mfaRequired: false,
  mfaVerifiedUntil: null,
  organizationId: "org-ticket-test",
  requestId,
  role: "administrator",
  twoFactorEnabled: false,
  twoFactorVerified: false,
};

export const organizationContextResponse = {
  organizationId: "org-ticket-test",
  requestId,
  role: "administrator",
  userId: "user-ticketing-admin",
};

export const sessionsListResponse = [
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

export const eventId = "74e47064-75b9-47e9-97e6-c28f5430bee0";
export const bundleId = "6ab6bf88-c618-4bcd-b452-3aadebd28aa6";
export const purchaseId = "8de2c455-72c5-4117-92a0-b2bc77b05706";
export const newBundleId = "25fd0bbd-2438-458b-877b-5e5032e31cde";
export const secondPerformanceId = "0dc9043e-09b7-41f1-bcde-7f26c3f03dc1";
export const futureDate = futureIsoDate({ days: 300 });
export const saleEndDate = futureIsoDate({ days: 280 });
export const saleEndInputValue = `${futureDateString({ days: 280 })}T00:00`;
export const successToken = "ticket-receipt-token-for-e2e-test";
export const scanToken = "ticket-scan-token-for-e2e-test";

export const ticketingProjection = {
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

export const purchaseResponse = {
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

export const receiptResponse = {
  ...purchaseResponse,
  requestId,
  scanToken,
};

export const checkoutResponse = {
  checkoutMode: "fake",
  purchase: purchaseResponse,
  successToken,
  url: `http://127.0.0.1:4173/tickets/order/success?token=${successToken}`,
};

export const adminOrder = {
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

export const bundleAdminOrder = {
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

export const sortableAdminOrder = {
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

export const adminBundle = {
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

export const adminDiscountCode = {
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

export const redeemedAdminDiscountCode = {
  ...adminDiscountCode,
  firstRedeemedAt: "2026-07-23T13:00:00.000Z",
  redemptionCount: 3,
};

export const adminEvent = {
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
  venueId: "33333333-3333-4333-8333-333333333333",
};

export const secondAdminEvent = {
  ...adminEvent,
  id: secondPerformanceId,
  startsAt: futureIsoDate({ days: 320 }),
  title: "Winter Concert",
};

export const refundedDiscountAdminOrder = {
  ...adminOrder,
  buyerEmail: "refunded.discount@example.test",
  buyerName: "Refunded Discount Buyer",
  createdAt: "2026-07-23T13:00:00.000Z",
  id: "1ab2c3d4-e5f6-4789-8abc-0123456789ab",
  status: "refunded",
};

export const pendingDiscountAdminOrder = {
  ...adminOrder,
  buyerEmail: "pending.discount@example.test",
  buyerName: "Pending Discount Buyer",
  createdAt: "2026-07-23T12:00:00.000Z",
  id: "2ab2c3d4-e5f6-4789-8abc-0123456789ab",
  status: "pending",
};

export const secondPerformanceDiscountAdminOrder = {
  ...adminOrder,
  buyerEmail: "winter.discount@example.test",
  buyerName: "Winter Discount Buyer",
  createdAt: "2026-07-23T11:00:00.000Z",
  eventId: secondPerformanceId,
  eventStartsAt: secondAdminEvent.startsAt,
  eventTitle: secondAdminEvent.title,
  id: "3ab2c3d4-e5f6-4789-8abc-0123456789ab",
};

export function routeHealth(page: Page) {
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

export function routeAnonymousSession(page: Page) {
  return page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
}

export function routeProjection(page: Page) {
  return page.route("**/api/public/projection", async (route) => {
    await route.fulfill({
      body: JSON.stringify(ticketingProjection),
      contentType: "application/json",
      status: 200,
    });
  });
}

export async function routePublicBasics(page: Page) {
  await page.route("**/api/public/logo", (route) => route.fulfill({ status: 404 }));
  await routeHealth(page);
  await routeAnonymousSession(page);
  await routeProjection(page);
}

export async function routeAdminAuth(page: Page) {
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
