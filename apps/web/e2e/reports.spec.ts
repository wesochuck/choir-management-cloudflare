import { expect, test } from "@playwright/test";

const requestId = "99999999-9999-4999-8999-999999999999";
const profileId = "11111111-1111-4111-8111-111111111111";
const firstEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const selectedEventIds = [firstEventId, secondEventId];

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

const profile = {
  createdAt: "2026-07-20T20:00:00.000Z",
  displayName: "Ada Adams",
  doNotEmail: false,
  globalStatus: "Active",
  id: profileId,
  isSectionLeader: false,
  notes: "",
  phone: "",
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  statusIsManual: false,
  updatedAt: "2026-07-20T20:00:00.000Z",
  voicePart: "S1",
} as const;

function performanceOption(
  id: string,
  title: string,
  startsAt: string,
  assignedFolderCount: number,
) {
  return {
    assignedFolderCount,
    id,
    isArchived: false,
    isCanceled: false,
    startsAt,
    title,
  };
}

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
  await page.route("**/api/organization/roster-configuration", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        attendanceReportWarningThreshold: 2,
        onBreakTimeoutDays: 90,
        onBreakTimeoutEnabled: false,
        performerLabel: "Performer",
        requestId,
        rsvpExpiryEnabled: false,
        rsvpExpiryLeadDays: 3,
        rsvpFollowUpEnabled: false,
        rsvpFollowUpLeadHours: 48,
        sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
        statusAutomationEnabled: false,
        statusAutomationMissThreshold: 3,
        statusAutomationRecoveryEnabled: true,
        voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
      }),
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
  await page.route("**/api/organization/music", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ pieces: [], requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/events", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        events: [
          {
            createdAt: "2026-07-20T20:00:00.000Z",
            id: firstEventId,
            isCanceled: false,
            startsAt: "2026-05-01T23:00:00.000Z",
            title: "Spring Concert",
            type: "Performance",
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/reports/music-folders/query", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const eventIds =
      typeof body === "object" &&
      body !== null &&
      "eventIds" in body &&
      Array.isArray(body.eventIds)
        ? body.eventIds.filter((value): value is string => typeof value === "string")
        : [];
    const selected = eventIds.length > 0;
    await route.fulfill({
      body: JSON.stringify({
        performanceOptions: [
          performanceOption(secondEventId, "Summer Concert", "2026-08-01T23:00:00.000Z", 0),
          performanceOption(firstEventId, "Spring Concert", "2026-05-01T23:00:00.000Z", 1),
        ],
        requestId,
        selectedEventIds: eventIds,
        summaries: selected
          ? [
              {
                assigned: 1,
                displayName: "Ada Adams",
                globalStatus: "Active",
                notAssigned: 0,
                outstanding: 1,
                profileId,
                returnRate: 0,
                returned: 0,
              },
            ]
          : [],
        totals: selected
          ? { assigned: 1, notAssigned: 0, outstanding: 1, returnRate: 0, returned: 0 }
          : { assigned: 0, notAssigned: 0, outstanding: 0, returnRate: 0, returned: 0 },
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/reports/music-folders/profiles/*", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        displayName: "Ada Adams",
        globalStatus: "Active",
        profileId,
        requestId,
        rows: [
          {
            eventId: firstEventId,
            eventTitle: "Spring Concert",
            folderNumber: "A-12",
            folderReturned: false,
            isArchived: false,
            isCanceled: false,
            profileId,
            returnedAt: null,
            startsAt: "2026-05-01T23:00:00.000Z",
            status: "outstanding",
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
          {
            eventId: secondEventId,
            eventTitle: "Summer Concert",
            folderNumber: "",
            folderReturned: false,
            isArchived: false,
            isCanceled: false,
            profileId,
            returnedAt: null,
            startsAt: "2026-08-01T23:00:00.000Z",
            status: "not_assigned",
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
        ],
        selectedEventIds,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/reports/music-folders/folder-numbers", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        requestId,
        results: [
          {
            code: null,
            eventId: firstEventId,
            message: "Folder Number saved.",
            profileId,
            result: "applied",
            row: {
              eventId: firstEventId,
              eventTitle: "Spring Concert",
              folderNumber: "B-4",
              folderReturned: false,
              isArchived: false,
              isCanceled: false,
              profileId,
              returnedAt: null,
              startsAt: "2026-05-01T23:00:00.000Z",
              status: "outstanding",
              updatedAt: "2026-07-20T20:10:00.000Z",
            },
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(
    "**/api/organization/profiles/*/folder-numbers/*/return-status",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          requestId,
          row: {
            eventId: firstEventId,
            eventTitle: "Spring Concert",
            folderNumber: "B-4",
            folderReturned: true,
            isArchived: false,
            isCanceled: false,
            profileId,
            returnedAt: "2026-07-20T20:20:00.000Z",
            startsAt: "2026-05-01T23:00:00.000Z",
            status: "returned",
            updatedAt: "2026-07-20T20:20:00.000Z",
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    },
  );
  await page.route("**/api/organization/reports/music-folders/export.csv", async (route) => {
    await route.fulfill({
      body: '"Profile","Performance"\r\n"Ada Adams","Spring Concert"\r\n',
      contentType: "text/csv; charset=utf-8",
      headers: { "content-disposition": 'attachment; filename="music_folder_report.csv"' },
      status: 200,
    });
  });
});

test("supports multi-Performance history, staged edits, and immediate return updates", async ({
  page,
}) => {
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await page.getByRole("tab", { name: "Music Folder Report" }).click();
  await expect(page.getByRole("heading", { name: "Music Folder Report" })).toBeVisible();
  await expect(
    page.getByText("Choose one or more Performances to see who has returned"),
  ).toBeVisible();

  await page.locator(".music-folder-report__picker > summary").click();
  await expect(page.getByText("Summer Concert")).toBeVisible();
  const performanceCheckboxes = page.locator(".music-folder-report__performance-option input");
  await performanceCheckboxes.nth(0).check();
  await performanceCheckboxes.nth(1).check();

  await expect(page.getByRole("button", { name: "Open", exact: true }).first()).toBeVisible();
  await expect(page.locator("strong:visible", { hasText: "Ada Adams" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Ada Adams" })).toBeVisible();
  await expect(
    page.locator(".music-folder-report__status:visible", { hasText: "Outstanding" }).first(),
  ).toBeVisible();

  const folderNumber = page
    .locator("label", { hasText: "Folder Number for Spring Concert" })
    .locator("input:visible")
    .first();
  await folderNumber.fill("B-4");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(folderNumber).toHaveValue("B-4");

  await page.getByRole("button", { name: "Mark returned" }).click();
  await expect(page.getByRole("button", { name: "Mark outstanding" }).first()).toBeVisible();

  await folderNumber.fill("");
  const clearDialog = page.getByRole("alertdialog", { name: "Clear this Folder Number?" });
  await expect(clearDialog).toBeVisible();
  await clearDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(folderNumber).toHaveValue("B-4");

  await expect(page.getByRole("button", { name: /Mark all/ })).toHaveCount(0);
});
