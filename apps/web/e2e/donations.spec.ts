import { expect, test } from "@playwright/test";

const requestId = "88888888-8888-4888-8888-888888888888";
const profileId = "11111111-1111-4111-8111-111111111111";
const stripeDonationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const manualDonationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const createdDonationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const currentSession = {
  activeOrganizationId: "organization-alpha",
  createdAt: "2026-07-20T20:00:00.000Z",
  expiresAt: "2026-07-27T20:00:00.000Z",
  id: "session-current",
  ipAddress: "192.0.2.10",
  token: "browser-session-token-not-displayed",
  updatedAt: "2026-07-20T20:00:00.000Z",
  userAgent: "Chromium browser",
  userId: "user-browser-admin",
} as const;

const currentUser = {
  createdAt: "2026-07-20T19:00:00.000Z",
  email: "browser.admin@example.test",
  emailVerified: true,
  id: "user-browser-admin",
  image: null,
  name: "Browser Administrator",
  twoFactorEnabled: false,
  updatedAt: "2026-07-20T19:00:00.000Z",
} as const;

function donation(overrides: {
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly id: string;
  readonly paymentMethod: string;
  readonly paymentReference: string;
  readonly thankYouSentAt: string | null;
}) {
  return {
    amountCents: 2500,
    anonymous: false,
    buyerEmail: overrides.buyerEmail,
    buyerName: overrides.buyerName,
    createdAt: "2026-07-21T20:00:00.000Z",
    expiredAt: null,
    feeCents: 50,
    id: overrides.id,
    marketingConsent: false,
    patronId: null,
    paymentMethod: overrides.paymentMethod,
    paymentReference: overrides.paymentReference,
    refundRequested: false,
    status: "paid",
    thankYouSentAt: overrides.thankYouSentAt,
    tributeName: "",
    tributeNotifyEmail: "",
    tributeType: "none",
    updatedAt: "2026-07-21T20:00:00.000Z",
  };
}

const listedDonations = [
  donation({
    buyerEmail: "",
    buyerName: "Marcus Meadows",
    id: manualDonationId,
    paymentMethod: "check",
    paymentReference: "Check #1042",
    thankYouSentAt: "2026-07-23T15:00:00.000Z",
  }),
  donation({
    buyerEmail: "dana.donor@example.test",
    buyerName: "Dana Donor",
    id: stripeDonationId,
    paymentMethod: "stripe",
    paymentReference: "",
    thankYouSentAt: null,
  }),
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        baseHostname: "127.0.0.1",
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
    await route.fulfill({
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        organizations: [
          {
            canonicalHostname: "alpha.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Alpha",
            organizationId: "organization-alpha",
            profileId,
            role: "administrator",
            slug: "alpha",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "organization-alpha",
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/module-state", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        modules: [
          { enabled: true, id: "events" },
          { enabled: true, id: "people" },
          { enabled: true, id: "programs" },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/setup/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        allModulesConfigured: true,
        completedSteps: [],
        currentStep: null,
        launched: true,
        organizationId: "organization-alpha",
        organizationName: "Organization Alpha",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/calendar-settings", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ requestId, timezone: "America/New_York" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/donation-settings", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        buttonText: "Give now",
        description: "Support our choir.",
        levels: [],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/patrons", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ patrons: [], requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/donations", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ donations: listedDonations, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
});

test("records a manual donation from the history tab", async ({ page }) => {
  let manualPayload: unknown = null;
  await page.route("**/api/organization/donations/manual", async (route) => {
    manualPayload = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        donation: donation({
          buyerEmail: "",
          buyerName: "Nora Noble",
          id: createdDonationId,
          paymentMethod: "cash",
          paymentReference: "Hat proceeds",
          thankYouSentAt: null,
        }),
        requestId,
      }),
      contentType: "application/json",
      status: 201,
    });
  });

  await page.goto("/admin/donations");
  const historyPanel = page.getByRole("tabpanel", { name: /history/i });
  await expect(historyPanel.getByText("Dana Donor")).toBeVisible();
  await expect(historyPanel.getByText("Check #1042")).toBeVisible();

  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Amount (USD)").fill("75");
  await dialog.getByLabel("Donor name", { exact: true }).fill("Nora Noble");
  await dialog.getByLabel(/Payment method/).selectOption({ label: "Cash" });
  await dialog.getByLabel(/Check # \/ Reference note/).fill("Hat proceeds");

  await dialog.getByRole("button", { name: "Record donation" }).click();

  expect(manualPayload).toMatchObject({
    amountCents: 7500,
    anonymous: false,
    buyerEmail: "",
    buyerName: "Nora Noble",
    paymentMethod: "cash",
    paymentReference: "Hat proceeds",
    thankYouSent: false,
    tributeType: "none",
  });
  expect(
    typeof manualPayload === "object" &&
      manualPayload !== null &&
      "receivedAt" in manualPayload &&
      typeof manualPayload.receivedAt === "string",
  ).toBe(true);

  await expect(page.getByRole("status")).toHaveText("Manual donation recorded.");
  await expect(dialog).toBeHidden();
  await expect(historyPanel.getByText("Nora Noble")).toBeVisible();
});

test("filters donations by thank-you status and payment source", async ({ page }) => {
  await page.goto("/admin/donations");
  const historyPanel = page.getByRole("tabpanel", { name: /history/i });
  await expect(historyPanel.getByText("Dana Donor")).toBeVisible();
  await expect(historyPanel.getByText("Marcus Meadows")).toBeVisible();

  await historyPanel.getByLabel("Thank you letter").selectOption({ label: "Thank you pending" });
  await expect(historyPanel.getByText("Dana Donor")).toBeVisible();
  await expect(historyPanel.getByText("Marcus Meadows")).toBeHidden();

  await historyPanel.getByLabel("Thank you letter").selectOption({ label: "Thank you sent" });
  await expect(historyPanel.getByText("Dana Donor")).toBeHidden();
  await expect(historyPanel.getByText("Marcus Meadows")).toBeVisible();

  await historyPanel.getByLabel("Thank you letter").selectOption({ label: "All" });
  await historyPanel.getByLabel("Payment source").selectOption({ label: "Online (Stripe)" });
  await expect(historyPanel.getByText("Dana Donor")).toBeVisible();
  await expect(historyPanel.getByText("Marcus Meadows")).toBeHidden();

  await historyPanel.getByLabel("Payment source").selectOption({ label: "Manual / Offline" });
  await expect(historyPanel.getByText("Dana Donor")).toBeHidden();
  await expect(historyPanel.getByText("Marcus Meadows")).toBeVisible();
});

test("toggles thank-you letter status", async ({ page }) => {
  let thankYouPayload: unknown = null;
  await page.route("**/api/organization/donations/thank-you", async (route) => {
    thankYouPayload = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        donation: donation({
          buyerEmail: "dana.donor@example.test",
          buyerName: "Dana Donor",
          id: stripeDonationId,
          paymentMethod: "stripe",
          paymentReference: "",
          thankYouSentAt: "2026-08-22T12:00:00.000Z",
        }),
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/donations");
  const danaRow = page.getByRole("row", { name: /Dana Donor/ });
  await expect(danaRow.getByText("Pending")).toBeVisible();

  await danaRow.getByRole("button", { name: "Mark sent" }).click();

  expect(thankYouPayload).toEqual({ donationId: stripeDonationId, thankYouSent: true });
  await expect(page.getByRole("status")).toHaveText("Thank-you letter marked as sent.");
  await expect(danaRow.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(danaRow.getByText(/^Sent/)).toBeVisible();
});
