import { expect, test } from "@playwright/test";

const requestId = "99999999-9999-4999-8999-999999999999";
const profileId = "11111111-1111-4111-8111-111111111111";

test("keeps the roster profile dialog open when Messages is selected", async ({ page }) => {
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
    await route.fulfill({
      body: JSON.stringify({
        session: {
          activeOrganizationId: "organization-alpha",
          createdAt: "2026-07-20T20:00:00.000Z",
          expiresAt: "2026-07-27T20:00:00.000Z",
          id: "session-roster-profile",
          ipAddress: "192.0.2.10",
          updatedAt: "2026-07-20T20:00:00.000Z",
          userAgent: "Chromium browser",
          userId: "user-roster-profile",
        },
        user: {
          createdAt: "2026-07-20T19:00:00.000Z",
          email: "roster.admin@example.test",
          emailVerified: true,
          id: "user-roster-profile",
          image: null,
          name: "Roster Admin",
          twoFactorEnabled: false,
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 200,
    });
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
        modules: [{ enabled: true, id: "people" }],
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
  await page.route("**/api/organization/profiles", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        profiles: [
          {
            createdAt: "2026-07-20T20:00:00.000Z",
            displayName: "Browser Singer",
            doNotEmail: false,
            globalStatus: "Active",
            id: profileId,
            isSectionLeader: false,
            notes: "",
            onBreakInactiveAt: null,
            phone: "",
            photoFileId: null,
            providerEmailSuppressed: false,
            receiveAdminNotifications: true,
            receiveAttendanceReports: true,
            receiveFinancialAlerts: false,
            receiveRsvpDeclineNotices: false,
            showInDirectory: true,
            statusChangedAt: "2026-07-20T20:00:00.000Z",
            statusChangeReason: "Initial status",
            statusIsManual: false,
            updatedAt: "2026-07-20T20:00:00.000Z",
            voicePart: "S2",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        memberships: [
          {
            email: "browser.singer@example.test",
            id: "membership-roster-profile",
            name: "Browser Singer",
            profileId,
            role: "member",
          },
        ],
        requestId,
        truncated: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/roster-configuration", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        attendanceReportWarningThreshold: 3,
        onBreakTimeoutDays: 60,
        onBreakTimeoutEnabled: true,
        performerLabel: "Performer",
        requestId,
        rsvpExpiryEnabled: true,
        rsvpExpiryLeadDays: 3,
        rsvpFollowUpEnabled: false,
        rsvpFollowUpLeadHours: 24,
        sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
        statusAutomationEnabled: false,
        statusAutomationMissThreshold: 3,
        statusAutomationRecoveryEnabled: true,
        voiceParts: [{ fullName: "Soprano 2", label: "S2", sectionCode: "S" }],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/profiles/${profileId}/status-history`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({ entries: [], profileId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/profiles/${profileId}/deliveries`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        deliveries: [
          {
            attempts: 1,
            channel: "email",
            destination: "browser.singer@example.test",
            failureDetail: "",
            lastAttemptAt: "2026-07-20T20:00:00.000Z",
            messageId: "22222222-2222-4222-8222-222222222222",
            providerEventAt: null,
            providerReason: "",
            providerStatus: "accepted",
            recipientName: "Browser Singer",
            status: "sent",
            subject: "Welcome",
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/roster");
  const rosterPage = page.getByRole("main");
  await rosterPage.getByRole("tab", { name: "Settings" }).click();
  await expect(rosterPage.getByRole("heading", { name: "Sections and parts" })).toBeVisible();
  await expect(rosterPage.getByRole("group", { name: "Parts" })).toBeVisible();
  const performerCard = rosterPage.locator(".roster-performer-card").filter({
    hasText: "Soprano 2",
  });
  await expect(performerCard).toBeVisible();
  await expect(performerCard.getByText("1 Profile assigned", { exact: true })).toBeVisible();
  await expect(performerCard.getByLabel("Part 1 label")).toBeDisabled();
  await expect(performerCard.getByRole("button", { name: "Manage assignments" })).toBeVisible();
  const performerFieldColumns = await performerCard
    .locator(".roster-performer-card__fields")
    .evaluate((fields) => getComputedStyle(fields).gridTemplateColumns.split(" ").length);
  expect(performerFieldColumns).toBe((page.viewportSize()?.width ?? 0) <= 768 ? 1 : 3);

  await performerCard.getByRole("button", { name: "Manage assignments" }).click();
  const assignmentsDialog = page.getByRole("dialog", { name: "Review S2 assignments" });
  await expect(assignmentsDialog).toContainText("1 Profile currently uses S2");
  await assignmentsDialog.getByRole("button", { name: "Cancel" }).click();

  await rosterPage.getByRole("tab", { name: "Roster", exact: true }).click();
  await expect(rosterPage.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await rosterPage.getByRole("button", { name: "Edit", exact: true }).click();

  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();
  await profileDialog.getByLabel("Display name").fill("Unsaved browser singer");
  await profileDialog.getByRole("tab", { name: "Messages" }).click();

  await expect(profileDialog).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Messages" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(profileDialog.getByText("Welcome")).toBeVisible();
});
