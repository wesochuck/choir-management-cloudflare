import { expect, test, type Page } from "@playwright/test";

const requestId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";

const sessionResponse = {
  session: {
    activeOrganizationId: "org-roster-automation",
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2027-07-20T20:00:00.000Z",
    id: "session-roster-automation",
    ipAddress: "192.0.2.50",
    token: "roster-automation-session-token",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-roster-automation",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "roster.admin@example.test",
    emailVerified: true,
    id: "user-roster-automation",
    image: null,
    name: "Roster Admin",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

const configuration = {
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  sections: [{ code: "SATB", color: "#336699", name: "SATB", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Alto", label: "A1", sectionCode: "SATB" }],
};

const profile = {
  createdAt: "2026-07-20T20:00:00.000Z",
  displayName: "Alex Alto",
  doNotEmail: false,
  globalStatus: "Idle",
  id: profileId,
  isSectionLeader: false,
  notes: "",
  onBreakInactiveAt: "2027-07-31T00:00:00.000Z",
  phone: "",
  photoFileId: null,
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  statusChangedAt: "2026-07-20T20:00:00.000Z",
  statusChangeReason: "Manual On Break status",
  statusIsManual: false,
  updatedAt: "2026-07-20T20:00:00.000Z",
  voicePart: "A1",
};

async function routeRosterSettings(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessionResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "org-roster-automation",
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
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
        organizationId: "org-roster-automation",
        organizationName: "Roster Automation Choir",
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
  await page.route("**/api/organization/transaction-fee-settings", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ fixedCents: 30, passFeeToDonor: false, percentage: 2.9, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/roster-configuration", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        body: JSON.stringify({ ...configuration, requestId }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ ...configuration, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/profiles", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ profiles: [profile], requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/roster-configuration/preview", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        affectedProfileCount: 1,
        onBreakTimeoutCount: 1,
        rsvpExpiryCount: 2,
        selectedProfile: {
          currentStatus: "Idle",
          displayName: "Alex Alto",
          id: profileId,
          nextStatus: "Inactive",
          nextStatusReason: "On Break timeout is due.",
          onBreakInactiveDate: "2027-07-31",
          recentPerformances: [],
        },
        statusChangeCount: 1,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

test("explains roster automation, On Break timeout, and live preview", async ({
  page,
}, testInfo) => {
  await routeRosterSettings(page);
  await page.goto("/admin/roster");
  await page.getByRole("tab", { name: "Roster automation" }).click();

  const settings = page.getByRole("region", { name: "Roster status automation" });
  await expect(
    settings.getByLabel("Missed Performances before changing Active to Inactive"),
  ).toHaveValue("3");
  await expect(settings.getByLabel("Days on Break before Inactive")).toHaveValue("365");
  await expect(
    settings.getByRole("checkbox", {
      name: "Automatically age out On Break Profiles",
    }),
  ).toBeChecked();
  await expect(
    settings.getByRole("checkbox", {
      name: "Convert Pending responses to No at the deadline",
    }),
  ).not.toBeAttached();
  await expect(settings.getByText(/On Break → Inactive · On Break timeout is due\./)).toBeVisible();
  await expect(settings.getByText("On Break transition: Jul 31, 2027")).toBeVisible();

  await expect(
    settings.getByText(/Active performer becomes Inactive after 3 consecutive missed Performances/),
  ).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme`, exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({
      path: testInfo.outputPath(`roster-automation-guidance-${theme}.png`),
      fullPage: true,
    });
  }
  await settings
    .getByRole("checkbox", { name: "Automatically age out On Break Profiles" })
    .uncheck();
  await page
    .locator(".floating-save-bar")
    .getByRole("button", { name: "Save changes" })
    .click({ force: true });
  await expect(page.getByText("Roster automation settings saved.")).toBeVisible();
});

test("configures RSVP and Attendance automation settings on their respective pages", async ({
  page,
}) => {
  await routeRosterSettings(page);
  await page.route("**/api/organization/events", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ events: [], requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/venues", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ requestId, venues: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/admin/rsvp");
  await page.getByRole("tab", { name: "RSVP automation" }).click();

  const rsvpSettings = page.getByRole("region", { name: "RSVP automation settings" });
  await expect(
    rsvpSettings.getByRole("checkbox", {
      name: "Convert Pending responses to No at the deadline",
    }),
  ).toBeChecked();
  await expect(
    rsvpSettings.getByRole("checkbox", {
      name: "Send the pending RSVP follow-up email",
    }),
  ).toBeChecked();
  await expect(
    rsvpSettings.getByRole("link", { name: /Edit pending RSVP follow-up template/ }),
  ).toHaveAttribute("target", "_blank");

  await rsvpSettings
    .getByRole("checkbox", { name: "Convert Pending responses to No at the deadline" })
    .uncheck();
  await page
    .locator(".floating-save-bar")
    .getByRole("button", { name: "Save changes" })
    .click({ force: true });
  await expect(page.getByText("RSVP automation settings saved.")).toBeVisible();

  await page.goto("/admin/attendance");
  await page.getByRole("tab", { name: "Attendance automation" }).click();

  const attendanceSettings = page.getByRole("region", { name: "Attendance automation settings" });
  await expect(
    attendanceSettings.getByRole("spinbutton", {
      name: "Rehearsal misses before an attendance warning",
    }),
  ).toHaveValue("2");
  await expect(
    attendanceSettings.getByRole("checkbox", {
      name: "Send attendance reports for Rehearsals",
    }),
  ).toBeChecked();
  await expect(
    attendanceSettings.getByRole("link", { name: /Edit Attendance Report template/ }),
  ).toHaveAttribute("target", "_blank");
});
