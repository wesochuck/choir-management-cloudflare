import { expect, test, type Page, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const session = {
  session: {
    activeOrganizationId: organizationId,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-setup-checklist",
    ipAddress: "192.0.2.40",
    token: "setup-checklist-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-setup-checklist-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "setup-checklist.admin@example.test",
    emailVerified: true,
    id: "user-setup-checklist-admin",
    image: null,
    name: "Setup Checklist Administrator",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

async function setupChecklistRoutes(
  page: Page,
  connectStatuses: readonly Record<string, unknown>[],
): Promise<void> {
  let connectStatusRead = 0;
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/account/organizations": {
        organizations: [
          {
            canonicalHostname: "setup-checklist.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Setup Checklist Choir",
            organizationId,
            profileId: null,
            role: "administrator",
            slug: "setup-checklist",
          },
        ],
      },
      "/api/auth/get-session": session,
      "/api/health": {
        baseHostname: "127.0.0.1",
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/organization/auth-status": {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId,
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
      "/api/organization/module-state": {
        modules: [
          { enabled: true, id: "events" },
          { enabled: true, id: "people" },
          { enabled: true, id: "programs" },
        ],
      },
      "/api/organization/provider-status": {
        brevo: { detail: "Sandbox provider", status: "ok" },
        emailSender: { fromEmail: null, fromName: null },
        environment: "local",
        externalEffectsMode: "fake",
        requestId,
        stripe: { detail: "Sandbox provider", status: "ok" },
      },
      "/api/organization/payment-settings": {
        activations: { donations: false, dues: false, tickets: false },
        environment: "local",
        externalEffectsMode: "fake",
        globalPaymentsEnabled: true,
        organizationName: "Setup Checklist Choir",
        readiness: {
          brevoConfigured: true,
          stripeAccountReady: true,
          stripeConfigured: true,
          webhookConfigured: true,
        },
        requestId,
        stripe: readyConnectStatus,
      },
      "/api/organization/calendar-settings": {
        requestId,
        timezone: "America/New_York",
      },
      "/api/organization/transaction-fee-settings": {
        fixedCents: 30,
        passFeeToDonor: false,
        percentage: 2.9,
        requestId,
      },
      "/api/organization/roster-configuration": {
        attendanceReportWarningThreshold: 3,
        onBreakTimeoutDays: 60,
        onBreakTimeoutEnabled: true,
        performerLabel: "Performer",
        requestId,
        rsvpExpiryEnabled: true,
        rsvpFollowUpEnabled: false,
        rsvpFollowUpLeadHours: 48,
        sections: [],
        statusAutomationEnabled: false,
        statusAutomationMissThreshold: 3,
        statusAutomationRecoveryEnabled: true,
        voiceParts: [],
      },
      "/api/platform/mfa/status": {
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      },
      "/api/setup/status": {
        allModulesConfigured: true,
        completedSteps: ["organization_info", "modules", "theme", "launch"],
        currentStep: null,
        launched: true,
        organizationId,
        organizationName: "Setup Checklist Choir",
      },
    };
    if (pathname === "/api/organization/stripe-connect/onboard") {
      throw new Error("Ready Stripe accounts must not start onboarding.");
    }
    if (pathname === "/api/organization/stripe-connect") {
      const status =
        connectStatuses[Math.min(connectStatusRead, connectStatuses.length - 1)] ??
        connectStatuses[0];
      connectStatusRead += 1;
      await fulfillJson(route, { platformConfigured: true, requestId, stripe: status });
      return;
    }
    if (pathname in responses) {
      await fulfillJson(route, responses[pathname]);
      return;
    }
    await fulfillJson(route, { code: "not_found", message: "Not found", requestId }, 404);
  });
}

const readyConnectStatus = {
  accountId: "acct_SetupChecklistReady",
  chargesEnabled: true,
  detailsSubmitted: true,
  payoutsEnabled: true,
  requirementsDue: [],
  status: "ready",
};

test("hides Stripe onboarding when the connected account is ready", async ({ page }) => {
  await setupChecklistRoutes(page, [readyConnectStatus]);

  await page.goto("/admin/settings/setup-checklist");

  await expect(
    page
      .locator('section[aria-label="Setup progress"]')
      .getByRole("heading", { name: "Stripe Connect account" }),
  ).toBeVisible();
  await expect(
    page.locator(".provider-status-card").getByRole("heading", { name: "Stripe Connect account" }),
  ).toHaveCount(0);
  await expect(page.getByText("Status: Ready", { exact: false })).toBeVisible();
  await expect(page.getByText("Stripe Connect is ready for payments.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Stripe onboarding/i })).toHaveCount(0);
});

test("shows a successful Stripe return on the setup checklist", async ({ page }) => {
  await setupChecklistRoutes(page, [readyConnectStatus]);

  await page.goto("/admin/settings/setup-checklist?stripe=return#provider-status-title");

  await expect(
    page.getByText("Stripe Connect returned from onboarding.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Status: Ready", { exact: false })).toBeVisible();
});

test("explains how to refresh an expired Stripe onboarding link", async ({ page }) => {
  await setupChecklistRoutes(page, [
    {
      accountId: "acct_SetupChecklistOnboarding",
      chargesEnabled: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
      requirementsDue: ["business_profile.url"],
      status: "onboarding",
    },
  ]);

  await page.goto("/admin/settings/setup-checklist?stripe=refresh#provider-status-title");

  await expect(
    page.getByText("The Stripe onboarding link needs to be refreshed.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue Stripe onboarding" })).toBeVisible();
});

test("refreshes a stale onboarding view before opening Stripe", async ({ page }) => {
  await setupChecklistRoutes(page, [
    {
      accountId: "acct_SetupChecklistOnboarding",
      chargesEnabled: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
      requirementsDue: ["business_profile.url"],
      status: "onboarding",
    },
    readyConnectStatus,
  ]);

  await page.goto("/admin/settings/setup-checklist");

  const continueButton = page.getByRole("button", { name: "Continue Stripe onboarding" });
  await expect(continueButton).toBeVisible();
  await continueButton.click();
  await expect(page.getByText("Status: Ready", { exact: false })).toBeVisible();
  await expect(page.getByText("Stripe Connect is ready for payments.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Stripe onboarding/i })).toHaveCount(0);
});

test("explains legacy Stripe return and refresh links on organization settings", async ({
  page,
}) => {
  await setupChecklistRoutes(page, [readyConnectStatus]);

  await page.goto("/admin/settings?stripe=return#payments-settings");

  await expect(
    page.getByText("Stripe Connect returned from onboarding.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Stripe account: ready", { exact: false })).toBeVisible();

  await page.goto("/admin/settings?stripe=refresh#payments-settings");

  await expect(
    page.getByText("The Stripe onboarding link needs to be refreshed.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Stripe setup checklist" })).toHaveAttribute(
    "href",
    "/admin/settings/setup-checklist?stripe=refresh#provider-status-title",
  );
});

test("shows onboarding guidance and next steps on admin overview when brand new", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/account/organizations": {
        organizations: [
          {
            canonicalHostname: "setup-checklist.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Brand New Choir",
            organizationId,
            profileId: null,
            role: "administrator",
            slug: "setup-checklist",
          },
        ],
      },
      "/api/auth/get-session": session,
      "/api/health": {
        baseHostname: "127.0.0.1",
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/organization/auth-status": {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId,
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
      "/api/organization/dashboard-summary": {
        activeProfileCount: 0,
        doNotEmailCount: 0,
        nextEvents: [],
        recentBounceCount: 0,
        requestId,
        upcomingEventCount: 0,
      },
      "/api/organization/module-state": {
        modules: [
          { enabled: false, id: "events" },
          { enabled: false, id: "people" },
          { enabled: false, id: "programs" },
        ],
      },
      "/api/platform/mfa/status": {
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      },
      "/api/setup/status": {
        allModulesConfigured: false,
        completedSteps: ["organization_info"],
        currentStep: "modules",
        launched: false,
        organizationName: "Brand New Choir",
        suggestedNextStep: "modules",
      },
    };
    if (responses[pathname]) {
      await fulfillJson(route, responses[pathname]);
      return;
    }
    await fulfillJson(route, {});
  });

  await page.goto("/admin");

  // Verify welcoming banner with no blank state
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByText("Welcome to your organization workspace", { exact: false }),
  ).toBeVisible();

  // Verify next steps guidance cards
  await expect(page.getByText("Next steps for your organization")).toBeVisible();
  await expect(page.getByRole("link", { name: "Configure modules →" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open setup checklist →" })).toBeVisible();
});
