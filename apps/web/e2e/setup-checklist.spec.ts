import { expect, test, type Route } from "@playwright/test";

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

test("hides Stripe onboarding when the connected account is ready", async ({ page }) => {
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
      "/api/organization/roster-configuration": {
        attendanceReportWarningThreshold: 3,
        onBreakTimeoutDays: 60,
        onBreakTimeoutEnabled: true,
        performerLabel: "Performer",
        requestId,
        rsvpExpiryEnabled: true,
        rsvpExpiryLeadDays: 3,
        rsvpFollowUpEnabled: false,
        rsvpFollowUpLeadHours: 48,
        sections: [],
        statusAutomationEnabled: false,
        statusAutomationMissThreshold: 3,
        statusAutomationRecoveryEnabled: true,
        voiceParts: [],
      },
      "/api/organization/stripe-connect": {
        platformConfigured: true,
        requestId,
        stripe: {
          accountId: "acct_SetupChecklistReady",
          chargesEnabled: true,
          detailsSubmitted: true,
          payoutsEnabled: true,
          requirementsDue: [],
          status: "ready",
        },
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
    if (pathname in responses) {
      await fulfillJson(route, responses[pathname]);
      return;
    }
    await fulfillJson(route, { code: "not_found", message: "Not found", requestId }, 404);
  });

  await page.goto("/admin/settings/setup-checklist");

  await expect(page.getByRole("heading", { name: "Stripe Connect account" })).toBeVisible();
  await expect(page.getByText("Status: Ready", { exact: false })).toBeVisible();
  await expect(page.getByText("Stripe Connect is ready for staging payments.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Stripe onboarding/i })).toHaveCount(0);
});
