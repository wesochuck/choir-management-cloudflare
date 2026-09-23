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

const refundedRegisterDonation = {
  ...donation({
    buyerEmail: "refunded.donor@example.test",
    buyerName: "Refunded Donor",
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    paymentMethod: "check",
    paymentReference: "Check #1043",
    thankYouSentAt: null,
  }),
  status: "refunded",
};
const refundRequestedRegisterDonation = {
  ...donation({
    buyerEmail: "requested.donor@example.test",
    buyerName: "Refund Requested Donor",
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef",
    paymentMethod: "stripe",
    paymentReference: "",
    thankYouSentAt: null,
  }),
  refundRequested: true,
};

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
  const visibleRegister = historyPanel.locator(".data-table:visible, .data-table-cards:visible");
  await expect(visibleRegister.getByText("Dana Donor")).toBeVisible();
  await expect(visibleRegister.getByText("Check #1042")).toBeVisible();

  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Amount (USD)").fill("75");
  await dialog.getByLabel("Donor name", { exact: true }).fill("Nora Noble");
  await dialog.getByLabel(/Payment method/).selectOption({ label: "Cash" });
  await dialog.getByLabel(/Check # \/ Reference note/).fill("Hat proceeds");

  const manualRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/api/organization/donations/manual"),
  );
  await dialog.getByRole("button", { name: "Record donation" }).click();
  await manualRequestPromise;

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
  await expect(visibleRegister.getByText("Nora Noble")).toBeVisible();
});

test("filters donations by thank-you status and payment source", async ({ page }) => {
  await page.goto("/admin/donations");
  const historyPanel = page.getByRole("tabpanel", { name: /history/i });
  const visibleRegister = historyPanel.locator(".data-table:visible, .data-table-cards:visible");
  await expect(visibleRegister.getByText("Dana Donor")).toBeVisible();
  await expect(visibleRegister.getByText("Marcus Meadows")).toBeVisible();

  await historyPanel.getByLabel("Thank you letter").selectOption({ label: "Thank you pending" });
  await expect(visibleRegister.getByText("Dana Donor")).toBeVisible();
  await expect(visibleRegister.getByText("Marcus Meadows")).toBeHidden();

  await historyPanel.getByLabel("Thank you letter").selectOption({ label: "Thank you sent" });
  await expect(visibleRegister.getByText("Dana Donor")).toBeHidden();
  await expect(visibleRegister.getByText("Marcus Meadows")).toBeVisible();

  await historyPanel.getByLabel("Thank you letter").selectOption({ label: "All" });
  await historyPanel.getByLabel("Payment source").selectOption({ label: "Online (Stripe)" });
  await expect(visibleRegister.getByText("Dana Donor")).toBeVisible();
  await expect(visibleRegister.getByText("Marcus Meadows")).toBeHidden();

  await historyPanel.getByLabel("Payment source").selectOption({ label: "Manual / Offline" });
  await expect(visibleRegister.getByText("Dana Donor")).toBeHidden();
  await expect(visibleRegister.getByText("Marcus Meadows")).toBeVisible();
});

test("hides refunded donations by default without changing summary totals or the full CSV", async ({
  page,
}) => {
  await page.route("**/api/organization/donations", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        donations: [...listedDonations, refundedRegisterDonation, refundRequestedRegisterDonation],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/donations");
  const historyPanel = page.getByRole("tabpanel", { name: /history/i });
  const visibleRegister = historyPanel.locator(".data-table:visible, .data-table-cards:visible");
  const refundedToggle = historyPanel.getByRole("checkbox", { name: "Show refunded" });
  await expect(refundedToggle).not.toBeChecked();
  await expect(visibleRegister.getByText("Refunded Donor")).toHaveCount(0);
  await expect(visibleRegister.getByText("Refund Requested Donor")).toBeVisible();
  await expect(visibleRegister.getByText("Refund requested", { exact: true })).toBeVisible();

  const summaryCount = historyPanel.locator(".donation-dashboard__metrics .summary-card").first();
  await expect(summaryCount.locator("strong")).toHaveText("3");
  const exportLink = historyPanel.getByRole("link", { name: "Export CSV" });
  const exportHref = await exportLink.getAttribute("href");
  expect(exportHref).not.toBeNull();
  const exportPayload = decodeURIComponent(exportHref?.split(",", 2)[1] ?? "");
  expect(exportPayload).toContain("Refunded Donor");

  await refundedToggle.check();
  await expect(visibleRegister.getByText("Refunded Donor")).toBeVisible();
  await expect(summaryCount.locator("strong")).toHaveText("3");
  await expect(exportLink).toHaveAttribute("href", exportHref ?? "");

  await page.setViewportSize({ height: 844, width: 390 });
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
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
  const visibleRegister = page.locator(".data-table:visible, .data-table-cards:visible");
  const danaRow = visibleRegister.locator("tr, .data-table-card").filter({ hasText: "Dana Donor" });
  await expect(danaRow.getByText("Pending", { exact: true })).toBeVisible();

  const thankYouRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/api/organization/donations/thank-you"),
  );
  await danaRow.getByRole("button", { name: "Mark sent" }).click();
  await thankYouRequestPromise;

  expect(thankYouPayload).toEqual({ donationId: stripeDonationId, thankYouSent: true });
  await expect(page.getByRole("status")).toHaveText("Thank-you letter marked as sent.");
  await expect(danaRow.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(danaRow.getByText(/^Sent/)).toBeVisible();
});

test("suggests known patrons, buyers, and members while typing", async ({ page }) => {
  await page.route("**/api/organization/patrons", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        patrons: [
          {
            donationCount: 2,
            email: "marcus@example.test",
            firstDonatedAt: "2026-01-05T12:00:00.000Z",
            id: "abababab-abab-4aba-8aba-abababababab",
            lastDonatedAt: "2026-07-01T12:00:00.000Z",
            name: "Marcus Meadows",
            totalDonatedCents: 7500,
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/tickets/orders", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        orders: [
          {
            amountPaidCents: 3000,
            bundleId: null,
            bundleTitle: "",
            buyerEmail: "marcus@example.test",
            buyerName: "Marcus Meadows",
            checkoutMode: "fake",
            createdAt: "2026-07-22T20:00:00.000Z",
            currency: "usd",
            discountAmountCents: 0,
            discountCode: null,
            discountType: null,
            discountValue: null,
            discountedSubtotalCents: 3000,
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            eventStartsAt: "2026-05-01T23:00:00.000Z",
            eventTitle: "Spring Concert",
            feeCents: 75,
            id: "bcbcbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
            includedEvents: [],
            marketingOptIn: false,
            originalSubtotalCents: 3000,
            originalUnitPriceCents: 1500,
            providerPaymentId: "payment-test",
            providerSessionId: "session-test",
            quantity: 2,
            refundRequested: false,
            status: "paid",
            timezone: "America/New_York",
            unitPriceCents: 1500,
            updatedAt: "2026-07-22T20:00:00.000Z",
          },
          {
            amountPaidCents: 1500,
            bundleId: null,
            bundleTitle: "",
            buyerEmail: "nora@example.test",
            buyerName: "Nora Noble",
            checkoutMode: "fake",
            createdAt: "2026-07-23T20:00:00.000Z",
            currency: "usd",
            discountAmountCents: 0,
            discountCode: null,
            discountType: null,
            discountValue: null,
            discountedSubtotalCents: 1500,
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            eventStartsAt: "2026-05-01T23:00:00.000Z",
            eventTitle: "Spring Concert",
            feeCents: 40,
            id: "bcbcbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
            includedEvents: [],
            marketingOptIn: false,
            originalSubtotalCents: 1500,
            originalUnitPriceCents: 1500,
            providerPaymentId: "payment-test-2",
            providerSessionId: "session-test-2",
            quantity: 1,
            refundRequested: false,
            status: "paid",
            timezone: "America/New_York",
            unitPriceCents: 1500,
            updatedAt: "2026-07-23T20:00:00.000Z",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/directory", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        profiles: [
          {
            displayName: "Nora Noble",
            email: "nora@example.test",
            id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
            photoFileId: null,
            phone: "",
            voicePart: "",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/donations");
  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  const nameInput = dialog.getByRole("combobox", { name: "Donor name" });
  const emailInput = dialog.getByRole("textbox", { name: /Donor email/ });

  const suggestions = dialog.getByRole("listbox").getByRole("option");

  await nameInput.fill("Mar");
  await expect(suggestions).toHaveCount(1);
  const marcusOption = suggestions.first();
  await expect(marcusOption).toContainText("Marcus Meadows");
  await expect(marcusOption).toContainText("marcus@example.test");
  await expect(marcusOption).toContainText("Donor · $75.00");
  await expect(marcusOption).toContainText("Ticket buyer");
  await expect(marcusOption).not.toContainText("Member");

  await marcusOption.click();
  await expect(nameInput).toHaveValue("Marcus Meadows");
  await expect(emailInput).toHaveValue("marcus@example.test");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);

  await nameInput.fill("Nor");
  await expect(suggestions).toHaveCount(1);
  const noraOption = suggestions.first();
  await expect(noraOption).toContainText("Nora Noble");
  await expect(noraOption).toContainText("Ticket buyer");
  await expect(noraOption).toContainText("Member");
  await noraOption.click();
  await expect(nameInput).toHaveValue("Nora Noble");
  await expect(emailInput).toHaveValue("nora@example.test");
});

test("keyboard selection works and a degraded directory stays silent", async ({ page }) => {
  let manualPayload: unknown = null;
  await page.route("**/api/organization/tickets/orders", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        orders: [
          {
            amountPaidCents: 1500,
            bundleId: null,
            bundleTitle: "",
            buyerEmail: "nora@example.test",
            buyerName: "Nora Noble",
            checkoutMode: "fake",
            createdAt: "2026-07-23T20:00:00.000Z",
            currency: "usd",
            discountAmountCents: 0,
            discountCode: null,
            discountType: null,
            discountValue: null,
            discountedSubtotalCents: 1500,
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            eventStartsAt: "2026-05-01T23:00:00.000Z",
            eventTitle: "Spring Concert",
            feeCents: 40,
            id: "bcbcbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
            includedEvents: [],
            marketingOptIn: false,
            originalSubtotalCents: 1500,
            originalUnitPriceCents: 1500,
            providerPaymentId: "payment-test-3",
            providerSessionId: "session-test-3",
            quantity: 1,
            refundRequested: false,
            status: "paid",
            timezone: "America/New_York",
            unitPriceCents: 1500,
            updatedAt: "2026-07-23T20:00:00.000Z",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/directory", async (route) => {
    await route.fulfill({ status: 500 });
  });
  await page.route("**/api/organization/donations/manual", async (route) => {
    manualPayload = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        donation: donation({
          buyerEmail: "nora@example.test",
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
  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  const nameInput = dialog.getByRole("combobox", { name: "Donor name" });
  const emailInput = dialog.getByRole("textbox", { name: /Donor email/ });

  const options = dialog.getByRole("listbox").getByRole("option");
  await nameInput.fill("nor");
  await expect(options).toHaveCount(1);

  await nameInput.press("ArrowDown");
  await nameInput.press("Enter");
  await expect(nameInput).toHaveValue("Nora Noble");
  await expect(emailInput).toHaveValue("nora@example.test");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);

  await nameInput.fill("no");
  await expect(options).toHaveCount(1);
  await nameInput.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Amount (USD)").fill("25");
  const manualRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/api/organization/donations/manual"),
  );
  await dialog.getByRole("button", { name: "Record donation" }).click();
  await manualRequestPromise;

  expect(manualPayload).toMatchObject({
    amountCents: 2500,
    buyerEmail: "nora@example.test",
    buyerName: "Nora Noble",
    paymentMethod: "check",
  });
  await expect(page.getByRole("status")).toHaveText("Manual donation recorded.");
});

test.describe("public donation checkout", () => {
  const publicDonationSettings = {
    buttonText: "Support our Music",
    description: "Your gift sustains our artistic and education programs.",
    levels: [
      { amountCents: 2500, benefit: "Friend", id: "level-1", label: "Friend" },
      { amountCents: 5000, benefit: "Supporter", id: "level-2", label: "Supporter" },
      { amountCents: 10000, benefit: "Patron", id: "level-3", label: "Patron" },
      { amountCents: 25000, benefit: "Benefactor", id: "level-4", label: "Benefactor" },
      { amountCents: 50000, benefit: "Sponsor", id: "level-5", label: "Sponsor" },
    ],
    requestId: "a0000000-0000-4000-8000-000000000001",
  };

  const publicFeeSettings = {
    fixedCents: 30,
    passFeeToDonor: true,
    percentage: 2.9,
    requestId: "a0000000-0000-4000-8000-000000000002",
  };

  test("renders balanced desktop layout with normal-sized radios and multi-column body", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.route("**/api/public/donation-settings*", async (route) => {
      await route.fulfill({
        body: JSON.stringify(publicDonationSettings),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/public/transaction-fee-settings*", async (route) => {
      await route.fulfill({
        body: JSON.stringify(publicFeeSettings),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/donate");
    await expect(page.getByRole("heading", { name: "Support our Music" })).toBeVisible();

    // Verify 6 donation level options (5 configured + custom) exist
    const levelButtons = page.locator(".donation-level-option");
    await expect(levelButtons).toHaveCount(6);

    // Verify desktop level grid has 3 columns
    const levelGrid = page.locator(".public-donation-form .donation-level-grid");
    const gridColumns = await levelGrid.evaluate(
      (el) => window.getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(gridColumns).toBe(3);

    // Verify tribute radios are NOT oversized
    const firstRadio = page.locator('.donation-tribute-option input[type="radio"]').first();
    await expect(firstRadio).toBeVisible();
    const radioBox = await firstRadio.boundingBox();
    expect(radioBox).toBeTruthy();
    if (radioBox) {
      // Must not be the oversized 52px (3.25rem) box from generic .field input
      expect(radioBox.width).toBeLessThanOrEqual(24);
      expect(radioBox.height).toBeLessThanOrEqual(24);
    }

    // Verify body is two columns on desktop
    const body = page.locator(".public-donation-body");
    const bodyColumns = await body.evaluate(
      (el) => window.getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(bodyColumns).toBe(2);

    // Verify summary card contains donation, processing fee, total, and complete button
    const summary = page.locator(".public-donation-summary");
    await expect(summary.getByText("Donation summary")).toBeVisible();
    await expect(summary.getByRole("button", { name: "Complete donation" })).toBeVisible();
  });

  test("reveals conditional tribute fields and submits donation checkout", async ({ page }) => {
    let checkoutPayload: unknown = null;

    await page.route("**/api/public/donation-settings*", async (route) => {
      await route.fulfill({
        body: JSON.stringify(publicDonationSettings),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/public/transaction-fee-settings*", async (route) => {
      await route.fulfill({
        body: JSON.stringify(publicFeeSettings),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/public/donations/checkout*", async (route) => {
      checkoutPayload = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({ url: "https://checkout.stripe.test/pay" }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/donate");
    await expect(page.getByRole("heading", { name: "Support our Music" })).toBeVisible();

    // Tribute starts with No tribute
    await expect(page.getByLabel("Honoree name")).not.toBeVisible();

    // Selecting In honor of reveals conditional fields
    await page.getByLabel("In honor of").click();
    await expect(page.getByLabel("Honoree name")).toBeVisible();
    await expect(page.getByLabel("Notification email (optional)")).toBeVisible();

    await page.getByLabel("Honoree name").fill("Maestro Smith");
    await page.getByLabel("Notification email (optional)").fill("maestro@example.test");

    // Fill donor information
    await page.getByLabel("Name", { exact: true }).fill("Patron User");
    await page.getByLabel("Email", { exact: true }).fill("patron@example.test");
    await page.getByLabel("Confirm email").fill("patron@example.test");

    // Select preferences
    await page.getByLabel("Hide my name from public donor recognition").check();
    await page
      .getByLabel("I would like to receive updates about future events and programs")
      .check();

    // Complete donation
    await page.getByRole("button", { name: "Complete donation" }).click();

    expect(checkoutPayload).toMatchObject({
      amountCents: 2500,
      anonymous: true,
      buyerEmail: "patron@example.test",
      buyerName: "Patron User",
      marketingConsent: true,
      tributeName: "Maestro Smith",
      tributeNotifyEmail: "maestro@example.test",
      tributeType: "honor",
    });
  });

  test("collapses to single column on mobile without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.route("**/api/public/donation-settings*", async (route) => {
      await route.fulfill({
        body: JSON.stringify(publicDonationSettings),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/public/transaction-fee-settings*", async (route) => {
      await route.fulfill({
        body: JSON.stringify(publicFeeSettings),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/donate");
    await expect(page.getByRole("heading", { name: "Support our Music" })).toBeVisible();

    // Verify no horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    // Verify single-column layout for body
    const body = page.locator(".public-donation-body");
    const bodyColumns = await body.evaluate(
      (el) => window.getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(bodyColumns).toBe(1);

    // Verify single-column layout for donation levels
    const levelGrid = page.locator(".public-donation-form .donation-level-grid");
    const levelColumns = await levelGrid.evaluate(
      (el) => window.getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(levelColumns).toBe(1);
  });
});
