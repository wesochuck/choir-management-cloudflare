import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildOrganizationProfile } from "./fixtures/builders";

async function expectNoSeriousAxeViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) =>
      violation.nodes.map(
        (node) =>
          `${violation.id} (${violation.impact ?? "unknown"}): ${node.target.join(" ")} — ${violation.helpUrl}`,
      ),
    );
  expect(blocking, `axe violations found for ${context}`).toEqual([]);
}

test("marks section leaders beside their names without adding a roster column", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({
      json: {
        memberships: [],
        truncated: false,
        requestId: "99999999-9999-4999-8999-999999999999",
      },
    });
  });
  const profiles = api.profiles.get();
  api.profiles.set(
    profiles.map((profile, index) => ({ ...profile, isSectionLeader: index === 0 })),
  );
  await page.goto("/admin/roster");
  const marker = page.getByRole("img", { name: "Section leader", exact: true });
  await expect(marker).toHaveCount(1);
  await expect(marker.locator("..")).toContainText(profiles[0]?.displayName ?? "Browser Singer");
  await expect(page.getByRole("columnheader", { name: /Section leader/ })).toHaveCount(0);
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.isVisible()) await toggle.click();
    await marker.evaluate(async (node) => {
      node.scrollIntoView({ behavior: "instant", block: "center" });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      );
      node.focus({ preventScroll: true });
    });
    await expect(page.getByRole("tooltip")).toHaveText("Section leader");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  api.assertNoUnexpectedRequests();
});

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

  let savedProfilePayload: Record<string, unknown> | null = null;
  await page.route(`**/api/organization/profiles/${profileId}`, async (route) => {
    if (route.request().method() === "PUT") {
      savedProfilePayload = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({
        body: JSON.stringify({
          ...savedProfilePayload,
          createdAt: "2026-07-20T20:00:00.000Z",
          id: profileId,
          requestId,
          statusChangedAt: "2026-07-20T20:00:00.000Z",
          statusChangeReason: "Updated",
          updatedAt: "2026-07-20T21:00:00.000Z",
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fallback();
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

  await profileDialog.getByRole("tab", { name: "Email & Notifications" }).click();

  const financialAlertsCheckbox = profileDialog.getByLabel(
    "Receive financial alerts (ticket sales)",
  );
  await expect(financialAlertsCheckbox).toBeVisible();
  await expect(financialAlertsCheckbox).not.toBeChecked();
  await financialAlertsCheckbox.check();
  await expect(financialAlertsCheckbox).toBeChecked();

  await profileDialog.getByRole("tab", { name: "Messages" }).click();

  await expect(profileDialog).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Messages" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(profileDialog.getByText("Welcome")).toBeVisible();

  await profileDialog.getByRole("tab", { name: "Profile Info" }).click();
  await profileDialog.getByRole("button", { name: "Save Profile" }).click();
  await expect(profileDialog).not.toBeVisible();
  expect(savedProfilePayload).toMatchObject({
    displayName: "Unsaved browser singer",
    receiveFinancialAlerts: true,
  });

  await rosterPage.getByRole("button", { name: "Add Profile" }).click();
  const createDialog = page.getByRole("dialog", { name: "Add Profile" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByRole("tab", { name: "Profile Info" })).toBeVisible();
  await expect(createDialog.getByRole("tab", { name: "Email & Notifications" })).toBeVisible();
  await expect(createDialog.getByRole("tab", { name: "Performance RSVPs" })).toHaveCount(0);
  await createDialog.getByRole("tab", { name: "Email & Notifications" }).click();
  const newProfileFinancialAlertsCheckbox = createDialog.getByLabel(
    "Receive financial alerts (ticket sales)",
  );
  await expect(newProfileFinancialAlertsCheckbox).toBeVisible();
  await expect(newProfileFinancialAlertsCheckbox).not.toBeChecked();
  await createDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(createDialog).not.toBeVisible();
});

test("keeps roster invite fields and actions inside the dialog in both themes", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });
  await page.route("**/api/organization/roster-invite-links", async (route) => {
    await route.fulfill({
      json: {
        links: [
          {
            id: "invite-layout",
            label: "Choir Roster Invite " + "x".repeat(80),
            status: "active",
            maxUses: null,
            committedUses: 1,
            activeReservations: 0,
            createdByUserId: "user-admin",
            organizationId: "organization-alpha",
            createdAt: "2026-08-01T00:00:00.000Z",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            revokedAt: null,
          },
        ],
        requestId,
      },
    });
  });
  await page.goto("/admin/roster");
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.isVisible()) await toggle.click();
    await page.getByRole("button", { name: "Invite by link" }).click();
    const dialog = page.getByRole("dialog", { name: "Roster invite links", exact: true });
    await dialog.getByLabel("Link label").focus();
    await expect(dialog.getByLabel("Link label")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("Expiration")).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Revoke", exact: true }).filter({ visible: true }),
    ).toBeVisible();
    const body = dialog.locator(".dialog__body");
    expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const label of ["Link label", "Expiration", "Max uses (optional)"]) {
      const field = dialog.getByLabel(label);
      const bounds = await dialog.boundingBox();
      const fieldBounds = await field.boundingBox();
      expect(bounds).not.toBeNull();
      expect(fieldBounds).not.toBeNull();
      if (!bounds || !fieldBounds) throw new Error("Missing dialog or field bounds");
      expect(fieldBounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(fieldBounds.x + fieldBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    await dialog
      .getByRole("button", { name: "Create invite link", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Create invite link", exact: true }),
    ).toBeInViewport();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  api.assertNoUnexpectedRequests();
});

test("Email & Notifications tab: four existing flags, suppression text, and #126 reminder preferences round-trip", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({
      json: {
        memberships: [
          {
            email: "browser.singer@example.test",
            id: "membership-1",
            name: "Browser Singer",
            profileId,
            role: "member",
          },
        ],
        truncated: false,
        requestId,
      },
    });
  });
  const profiles = api.profiles.get();
  const baseProfile = profiles[0] ?? buildOrganizationProfile({});
  api.profiles.set([
    {
      ...baseProfile,
      id: profileId,
      providerEmailSuppressed: true,
      doNotEmail: false,
      receiveAdminNotifications: false,
      receiveRsvpDeclineNotices: false,
      receiveFinancialAlerts: false,
      receiveRehearsalReminders: true,
      receivePerformanceReminders: true,
      receiveOtherEventReminders: true,
    },
  ]);

  let updatedPayload: Record<string, unknown> | null = null;
  await page.route(`**/api/organization/profiles/${profileId}`, async (route) => {
    if (route.request().method() === "PUT") {
      updatedPayload = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({
        json: {
          ...baseProfile,
          ...updatedPayload,
          id: profileId,
          requestId,
        },
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();

  // Verify all 6 tabs exist in Edit Profile
  await expect(profileDialog.getByRole("tab", { name: "Profile Info" })).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Email & Notifications" })).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Performance RSVPs" })).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Dues" })).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Folder numbers" })).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Messages" })).toBeVisible();

  // Click Email & Notifications tab
  await profileDialog.getByRole("tab", { name: "Email & Notifications" }).click();
  await expect(profileDialog.getByRole("tab", { name: "Email & Notifications" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Four existing checkboxes are present
  const doNotEmail = profileDialog.getByLabel("Do not email");
  const adminNotices = profileDialog.getByLabel(
    "Receive administrator notifications, including audition emails",
  );
  const rsvpDecline = profileDialog.getByLabel("Receive RSVP decline notices");
  const financialAlerts = profileDialog.getByLabel("Receive financial alerts (ticket sales)");

  await expect(doNotEmail).toBeVisible();
  await expect(adminNotices).toBeVisible();
  await expect(rsvpDecline).toBeVisible();
  await expect(financialAlerts).toBeVisible();

  // Suppression message is present
  await expect(
    profileDialog.getByText(/Provider suppression is active for this profile/),
  ).toBeVisible();

  // #126 grouping and reminder preferences are present
  await expect(
    profileDialog.getByRole("group", { name: "Email reminder preferences" }),
  ).toBeVisible();
  await expect(
    profileDialog.getByText(/currently scheduled about 48 hours before an event/),
  ).toBeVisible();

  const rehearsalReminders = profileDialog.getByLabel(/Rehearsal reminders/);
  const performanceReminders = profileDialog.getByLabel(/Performance reminders/);
  const otherEventReminders = profileDialog.getByLabel(/Other Event reminders/);

  await expect(rehearsalReminders).toBeChecked();
  await expect(performanceReminders).toBeChecked();
  await expect(otherEventReminders).toBeChecked();

  // Toggle controls
  await adminNotices.check();
  await performanceReminders.uncheck();

  // Save directly from Email & Notifications tab
  await profileDialog.getByRole("button", { name: "Save Profile" }).click();
  await expect(profileDialog).not.toBeVisible();

  expect(updatedPayload).toMatchObject({
    receiveAdminNotifications: true,
    receivePerformanceReminders: false,
    receiveRehearsalReminders: true,
    receiveOtherEventReminders: true,
  });
  api.assertNoUnexpectedRequests();
});

test("Add Profile two-tab layout, default values, unsaved changes across tabs, and save", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  let createdPayload: Record<string, unknown> | null = null;
  await page.route("**/api/organization/profiles", async (route) => {
    if (route.request().method() === "POST") {
      createdPayload = JSON.parse(route.request().postData() ?? "{}");
      const newProfile = buildOrganizationProfile({
        ...createdPayload,
        id: crypto.randomUUID(),
      });
      await route.fulfill({
        json: {
          ...newProfile,
          requestId,
        },
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Add Profile" }).click();
  const createDialog = page.getByRole("dialog", { name: "Add Profile" });
  await expect(createDialog).toBeVisible();

  // Exactly two tabs in Add Profile
  const tabTriggers = createDialog.getByRole("tab");
  await expect(tabTriggers).toHaveCount(2);
  await expect(createDialog.getByRole("tab", { name: "Profile Info" })).toBeVisible();
  await expect(createDialog.getByRole("tab", { name: "Email & Notifications" })).toBeVisible();
  await expect(createDialog.getByRole("tab", { name: "Messages" })).toHaveCount(0);
  await expect(createDialog.getByRole("tab", { name: "Performance RSVPs" })).toHaveCount(0);

  // Fill in display name on Profile Info tab
  await createDialog.getByLabel("Display name").fill("Brand New Singer");

  // Switch to Email & Notifications tab
  await createDialog.getByRole("tab", { name: "Email & Notifications" }).click();

  // Verify defaults
  await expect(createDialog.getByLabel("Do not email")).not.toBeChecked();
  await expect(
    createDialog.getByLabel("Receive administrator notifications, including audition emails"),
  ).not.toBeChecked();
  await expect(createDialog.getByLabel("Receive RSVP decline notices")).not.toBeChecked();
  await expect(
    createDialog.getByLabel("Receive financial alerts (ticket sales)"),
  ).not.toBeChecked();
  await expect(createDialog.getByLabel(/Rehearsal reminders/)).toBeChecked();
  await expect(createDialog.getByLabel(/Performance reminders/)).toBeChecked();
  await expect(createDialog.getByLabel(/Other Event reminders/)).toBeChecked();

  // Toggle values on Email & Notifications tab
  await createDialog.getByLabel("Receive financial alerts (ticket sales)").check();
  await createDialog.getByLabel(/Rehearsal reminders/).uncheck();

  // Switch back to Profile Info tab and verify display name survived tab switch
  await createDialog.getByRole("tab", { name: "Profile Info" }).click();
  await expect(createDialog.getByLabel("Display name")).toHaveValue("Brand New Singer");

  // Switch back to Email & Notifications and verify toggled checkboxes survived
  await createDialog.getByRole("tab", { name: "Email & Notifications" }).click();
  await expect(createDialog.getByLabel("Receive financial alerts (ticket sales)")).toBeChecked();
  await expect(createDialog.getByLabel(/Rehearsal reminders/)).not.toBeChecked();

  // Click Create Profile from Email & Notifications tab
  await createDialog.getByRole("button", { name: "Create Profile" }).click();
  await expect(createDialog).not.toBeVisible();

  expect(createdPayload).toMatchObject({
    displayName: "Brand New Singer",
    receiveFinancialAlerts: true,
    receiveRehearsalReminders: false,
    receivePerformanceReminders: true,
    receiveOtherEventReminders: true,
  });
  api.assertNoUnexpectedRequests();
});

test("Info validation when saving from Email & Notifications tab", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Add Profile" }).click();
  const createDialog = page.getByRole("dialog", { name: "Add Profile" });
  await expect(createDialog).toBeVisible();

  // Immediately switch to Email & Notifications tab without entering Display name
  await createDialog.getByRole("tab", { name: "Email & Notifications" }).click();
  await expect(createDialog.getByRole("tab", { name: "Email & Notifications" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Click Create Profile
  await createDialog.getByRole("button", { name: "Create Profile" }).click();

  // Dialog must stay open
  await expect(createDialog).toBeVisible();

  // Tab switches automatically back to Profile Info
  await expect(createDialog.getByRole("tab", { name: "Profile Info" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Error alert is visible
  await expect(createDialog.getByRole("alert")).toHaveText("Enter a display name.");

  // Display name input is focused
  await expect(createDialog.getByLabel("Display name")).toBeFocused();
  api.assertNoUnexpectedRequests();
});

test("supports deep linking directly to Email & Notifications tab", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  await page.goto(`/admin/roster?profileId=${profileId}&tab=email`);
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();
  await expect(profileDialog.getByRole("tab", { name: "Email & Notifications" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(profileDialog.getByLabel("Do not email")).toBeVisible();
  await expect(profileDialog.getByLabel(/Rehearsal reminders/)).toBeVisible();
  api.assertNoUnexpectedRequests();
});

test("narrow-screen tab accessibility and axe compliance in Edit Profile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();

  // All 6 tabs exist
  const tabs = profileDialog.getByRole("tab");
  await expect(tabs).toHaveCount(6);

  // Tablist is scrollable on narrow viewport and does not overflow dialog width
  const tablist = profileDialog.getByRole("tablist");
  const tablistBounds = await tablist.boundingBox();
  const dialogBounds = await profileDialog.boundingBox();
  expect(tablistBounds).not.toBeNull();
  expect(dialogBounds).not.toBeNull();
  if (tablistBounds && dialogBounds) {
    expect(tablistBounds.x).toBeGreaterThanOrEqual(dialogBounds.x);
    expect(tablistBounds.x + tablistBounds.width).toBeLessThanOrEqual(
      dialogBounds.x + dialogBounds.width + 1,
    );
  }

  // Keyboard navigation through tabs
  const infoTab = profileDialog.getByRole("tab", { name: "Profile Info" });
  await infoTab.focus();
  await expect(infoTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const emailTab = profileDialog.getByRole("tab", { name: "Email & Notifications" });
  await expect(emailTab).toBeFocused();
  await expect(emailTab).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowLeft");
  await expect(infoTab).toBeFocused();
  await expect(infoTab).toHaveAttribute("aria-selected", "true");

  // Run axe scan on the dialog
  await expectNoSeriousAxeViolations(page, "Edit Profile dialog");

  api.assertNoUnexpectedRequests();
});
