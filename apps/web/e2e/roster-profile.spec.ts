import { expect, test, type Locator, type Page } from "@playwright/test";
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
          `${violation.id} (${violation.impact ?? "unknown"}): ${node.target.join(" ")} — ${violation.helpUrl} — ${node.failureSummary ?? ""}`,
      ),
    );
  expect(blocking, `axe violations found for ${context}`).toEqual([]);
}

type ProfileTabKey = "dues" | "email" | "folders" | "info" | "messages" | "performance";

async function selectProfileTab(
  dialog: Locator,
  tabLabel: string,
  tabValue: ProfileTabKey,
): Promise<void> {
  const sectionSelect = dialog.getByLabel("Profile section", { exact: true });
  if (await sectionSelect.isVisible()) {
    await sectionSelect.selectOption(tabValue);
  } else {
    await dialog.getByRole("tab", { name: tabLabel }).click();
  }
}

async function expectActiveProfileTab(
  dialog: Locator,
  tabLabel: string,
  tabValue: ProfileTabKey,
): Promise<void> {
  const sectionSelect = dialog.getByLabel("Profile section", { exact: true });
  if (await sectionSelect.isVisible()) {
    await expect(sectionSelect).toHaveValue(tabValue);
  } else {
    await expect(dialog.getByRole("tab", { name: tabLabel })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
}

async function expectProfileTabCount(dialog: Locator, expectedCount: number): Promise<void> {
  const sectionSelect = dialog.getByLabel("Profile section", { exact: true });
  if (await sectionSelect.isVisible()) {
    await expect(sectionSelect.locator("option")).toHaveCount(expectedCount);
  } else {
    await expect(dialog.getByRole("tab")).toHaveCount(expectedCount);
  }
}

async function expectProfileTabVisible(
  dialog: Locator,
  tabLabel: string,
  tabValue: ProfileTabKey,
): Promise<void> {
  const sectionSelect = dialog.getByLabel("Profile section", { exact: true });
  if (await sectionSelect.isVisible()) {
    await expect(sectionSelect.locator(`option[value="${tabValue}"]`)).toHaveCount(1);
  } else {
    await expect(dialog.getByRole("tab", { name: tabLabel })).toBeVisible();
  }
}

async function expectProfileTabHidden(
  dialog: Locator,
  tabLabel: string,
  tabValue: ProfileTabKey,
): Promise<void> {
  const sectionSelect = dialog.getByLabel("Profile section", { exact: true });
  if (await sectionSelect.isVisible()) {
    await expect(sectionSelect.locator(`option[value="${tabValue}"]`)).toHaveCount(0);
  } else {
    await expect(dialog.getByRole("tab", { name: tabLabel })).toHaveCount(0);
  }
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
        baseHostname: "localhost",
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

  await selectProfileTab(profileDialog, "Email & Notifications", "email");

  const financialAlertsCheckbox = profileDialog.getByLabel(/Financial alerts/);
  await expect(financialAlertsCheckbox).toBeVisible();
  await expect(financialAlertsCheckbox).not.toBeChecked();
  await financialAlertsCheckbox.check();
  await expect(financialAlertsCheckbox).toBeChecked();

  await selectProfileTab(profileDialog, "Messages", "messages");

  await expect(profileDialog).toBeVisible();
  await expectActiveProfileTab(profileDialog, "Messages", "messages");
  await expect(profileDialog.getByText("Welcome")).toBeVisible();

  await selectProfileTab(profileDialog, "Profile Info", "info");
  await profileDialog.getByRole("button", { name: "Save Profile" }).click();
  await expect(profileDialog).not.toBeVisible();
  expect(savedProfilePayload).toMatchObject({
    displayName: "Unsaved browser singer",
    receiveFinancialAlerts: true,
  });

  await rosterPage.getByRole("button", { name: "Add Profile" }).click();
  const createDialog = page.getByRole("dialog", { name: "Add Profile" });
  await expect(createDialog).toBeVisible();
  await expectProfileTabVisible(createDialog, "Profile Info", "info");
  await expectProfileTabVisible(createDialog, "Email & Notifications", "email");
  await expectProfileTabHidden(createDialog, "Performance RSVPs", "performance");
  await selectProfileTab(createDialog, "Email & Notifications", "email");
  const newProfileFinancialAlertsCheckbox = createDialog.getByLabel(/Financial alerts/);
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
  await page.goto("/admin/settings/invitations");
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
  await expectProfileTabCount(profileDialog, 6);
  await expectProfileTabVisible(profileDialog, "Profile Info", "info");
  await expectProfileTabVisible(profileDialog, "Email & Notifications", "email");
  await expectProfileTabVisible(profileDialog, "Performance RSVPs", "performance");
  await expectProfileTabVisible(profileDialog, "Dues", "dues");
  await expectProfileTabVisible(profileDialog, "Folder numbers", "folders");
  await expectProfileTabVisible(profileDialog, "Messages", "messages");

  // Select Email & Notifications tab
  await selectProfileTab(profileDialog, "Email & Notifications", "email");
  await expectActiveProfileTab(profileDialog, "Email & Notifications", "email");

  // Four existing checkboxes are present
  const doNotEmail = profileDialog.getByLabel("Do not email");
  const adminNotices = profileDialog.getByLabel(/Administrator notifications/);
  const rsvpDecline = profileDialog.getByLabel(/RSVP decline notices/);
  const financialAlerts = profileDialog.getByLabel(/Financial alerts/);

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

  const rehearsalReminders = profileDialog.getByLabel(/Rehearsals/);
  const performanceReminders = profileDialog.getByLabel(/Performances/);
  const otherEventReminders = profileDialog.getByLabel(/Other events/);

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
  await expectProfileTabCount(createDialog, 2);
  await expectProfileTabVisible(createDialog, "Profile Info", "info");
  await expectProfileTabVisible(createDialog, "Email & Notifications", "email");
  await expectProfileTabHidden(createDialog, "Messages", "messages");
  await expectProfileTabHidden(createDialog, "Performance RSVPs", "performance");

  // Fill in display name on Profile Info tab
  await createDialog.getByLabel("Display name").fill("Brand New Singer");

  // Switch to Email & Notifications tab
  await selectProfileTab(createDialog, "Email & Notifications", "email");

  // Verify defaults
  await expect(createDialog.getByLabel("Do not email")).not.toBeChecked();
  await expect(createDialog.getByLabel(/Administrator notifications/)).not.toBeChecked();
  await expect(createDialog.getByLabel(/RSVP decline notices/)).not.toBeChecked();
  await expect(createDialog.getByLabel(/Financial alerts/)).not.toBeChecked();
  await expect(createDialog.getByLabel(/Rehearsals/)).toBeChecked();
  await expect(createDialog.getByLabel(/Performances/)).toBeChecked();
  await expect(createDialog.getByLabel(/Other events/)).toBeChecked();

  // Toggle values on Email & Notifications tab
  await createDialog.getByLabel(/Financial alerts/).check();
  await createDialog.getByLabel(/Rehearsals/).uncheck();

  // Switch back to Profile Info tab and verify display name survived tab switch
  await selectProfileTab(createDialog, "Profile Info", "info");
  await expect(createDialog.getByLabel("Display name")).toHaveValue("Brand New Singer");

  // Switch back to Email & Notifications and verify toggled checkboxes survived
  await selectProfileTab(createDialog, "Email & Notifications", "email");
  await expect(createDialog.getByLabel(/Financial alerts/)).toBeChecked();
  await expect(createDialog.getByLabel(/Rehearsals/)).not.toBeChecked();

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
  await selectProfileTab(createDialog, "Email & Notifications", "email");
  await expectActiveProfileTab(createDialog, "Email & Notifications", "email");

  // Click Create Profile
  await createDialog.getByRole("button", { name: "Create Profile" }).click();

  // Dialog must stay open
  await expect(createDialog).toBeVisible();

  // Tab switches automatically back to Profile Info
  await expectActiveProfileTab(createDialog, "Profile Info", "info");

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
  await expectActiveProfileTab(profileDialog, "Email & Notifications", "email");
  await expect(profileDialog.getByLabel("Do not email")).toBeVisible();
  await expect(profileDialog.getByLabel(/Rehearsals/)).toBeVisible();
  api.assertNoUnexpectedRequests();
});

test("narrow-screen section selector accessibility and axe compliance in Edit Profile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();

  // On narrow screens, native section selector is visible and has all 6 options
  const sectionSelect = profileDialog.getByLabel("Profile section", { exact: true });
  await expect(sectionSelect).toBeVisible();
  await expect(sectionSelect.locator("option")).toHaveCount(6);

  // Desktop rail is hidden from accessibility tree on mobile viewport
  await expect(profileDialog.getByRole("tab")).toHaveCount(0);

  // Selecting section via native select switches active panel
  await sectionSelect.selectOption("email");
  await expect(profileDialog.getByLabel("Do not email")).toBeVisible();

  await sectionSelect.selectOption("info");
  await expect(profileDialog.getByLabel("Display name")).toBeVisible();

  // Run axe scan on the dialog
  await expectNoSeriousAxeViolations(page, "Edit Profile dialog");

  api.assertNoUnexpectedRequests();
});

test("desktop vertical section rail keyboard navigation in Edit Profile", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop vertical rail only");
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();

  // All 6 tabs exist on desktop
  const tabs = profileDialog.getByRole("tab");
  await expect(tabs).toHaveCount(6);

  // Keyboard navigation through vertical tabs
  const infoTab = profileDialog.getByRole("tab", { name: "Profile Info" });
  await infoTab.focus();
  await expect(infoTab).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const emailTab = profileDialog.getByRole("tab", { name: "Email & Notifications" });
  await expect(emailTab).toBeFocused();
  await expect(emailTab).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowUp");
  await expect(infoTab).toBeFocused();
  await expect(infoTab).toHaveAttribute("aria-selected", "true");

  api.assertNoUnexpectedRequests();
});

test("profile section markers distinguish unsaved edits from the current section", async ({
  page,
}, testInfo) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  for (const theme of ["light", "dark"] as const) {
    await page.goto("/admin/roster");
    await expect(page.getByRole("button", { name: "Edit", exact: true }).first()).toBeVisible();
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.isVisible()) await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit Profile" });
    const name = dialog.getByLabel("Display name");
    const originalName = await name.inputValue();
    await name.fill(`${originalName} edited`);
    await selectProfileTab(dialog, "Email & notifications", "email");

    const sectionSelect = dialog.getByLabel("Profile section", { exact: true });
    if (await sectionSelect.isVisible()) {
      await expect(sectionSelect).toHaveValue("email");
      await expect(sectionSelect.locator('option[value="info"]')).toHaveText(
        "Profile info — Unsaved changes",
      );
      await expect(sectionSelect.locator('option[value="email"]')).toHaveText(
        "Email & notifications",
      );
    } else {
      const infoTab = dialog.getByRole("tab", { name: "Profile info", exact: true });
      const emailTab = dialog.getByRole("tab", { name: "Email & notifications", exact: true });
      await expect(infoTab).toHaveAttribute("aria-selected", "false");
      await expect(infoTab).toHaveAccessibleDescription("Unsaved");
      await expect(infoTab.getByText("Unsaved", { exact: true })).toBeVisible();
      await expect(emailTab).toHaveAttribute("aria-selected", "true");
      await expect(emailTab).not.toHaveAttribute("aria-describedby");
    }
    const emailPreference = dialog.getByRole("switch", { name: "Do not email", exact: true });
    await emailPreference.click();
    if (!(await sectionSelect.isVisible())) {
      const emailTab = dialog.getByRole("tab", { name: "Email & notifications", exact: true });
      await expect(emailTab).toHaveAccessibleDescription("Unsaved");
      const label = await emailTab.locator(".profile-editor__rail-label").boundingBox();
      const marker = await emailTab.getByText("Unsaved", { exact: true }).boundingBox();
      const tab = await emailTab.boundingBox();
      if (!label || !marker || !tab) throw new Error("Profile section geometry is unavailable");
      expect(marker.y).toBeGreaterThanOrEqual(label.y + label.height);
      expect(marker.x + marker.width).toBeLessThanOrEqual(tab.x + tab.width);
    }
    await emailPreference.click();
    await dialog.evaluate(async (node) => {
      await Promise.allSettled(
        node.getAnimations({ subtree: true }).map((animation) => animation.finished),
      );
    });
    await expectNoSeriousAxeViolations(page, `Unsaved profile sections in ${theme} theme`);
    await page.screenshot({ path: testInfo.outputPath(`unsaved-sections-${theme}.png`) });
    await selectProfileTab(dialog, "Profile info", "info");
    await name.fill(originalName);
    await expect(dialog.getByText("Unsaved", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("No unsaved changes")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  api.assertNoUnexpectedRequests();
});

test("photo controls, honest Add header, and truthful dirty footer", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();

  // Photo editor remains in Profile Info with all controls and validation hint.
  await expect(profileDialog.getByText("Profile photo", { exact: true })).toBeVisible();
  await expect(profileDialog.getByText("Choose photo")).toBeVisible();
  await expect(profileDialog.getByText("Take photo")).toBeVisible();
  await expect(profileDialog.getByText("Upload photo")).toBeVisible();
  await expect(profileDialog.getByText(/JPEG, PNG, or WebP; up to 5 MB/)).toBeVisible();

  // Footer starts pristine.
  await expect(profileDialog.getByText("No unsaved changes")).toBeVisible();

  // Dirty on edit, pristine again on revert.
  const nameField = profileDialog.getByLabel("Display name");
  const originalName = await nameField.inputValue();
  await nameField.fill(`${originalName} edited`);
  await expect(
    profileDialog.locator(".profile-editor-footer").getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await nameField.fill(originalName);
  await expect(profileDialog.getByText("No unsaved changes")).toBeVisible();

  // Email badge uses honest local-only language.
  await selectProfileTab(profileDialog, "Email & Notifications", "email");
  await expect(profileDialog.getByText("Not blocked")).toBeVisible();
  await expect(profileDialog.getByText("Email allowed")).toHaveCount(0);

  await profileDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(profileDialog).not.toBeVisible();

  // Add mode keeps an honest placeholder even after typing a name.
  // NB: the dialog accessible name ("Add Profile" via sr-only Radix Title)
  // duplicates the visible header text, so target the visible header class.
  await page.getByRole("button", { name: "Add Profile" }).click();
  const createDialog = page.getByRole("dialog", { name: "Add Profile" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.locator(".profile-editor-header__name")).toHaveText("Add Profile");
  await expect(
    createDialog.getByText("Save the Profile before adding a profile photo."),
  ).toBeVisible();
  await createDialog.getByLabel("Display name").fill("Typed Before Create");
  await expect(createDialog.locator(".profile-editor-header__name")).toHaveText("Add Profile");
  await expect(createDialog.getByText("Create a new choir member profile")).toBeVisible();
  await createDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(createDialog).not.toBeVisible();

  api.assertNoUnexpectedRequests();
});

test("independent tabs do not implicitly save pristine drafts", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({ json: { memberships: [], truncated: false, requestId } });
  });

  let putCount = 0;
  await page.route("**/api/organization/profiles/*", async (route) => {
    if (route.request().method() === "PUT") {
      putCount += 1;
    }
    await route.fallback();
  });

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();

  // Pristine draft on an independent tab: footer save is disabled with guidance.
  await selectProfileTab(profileDialog, "Messages", "messages");
  const saveButton = profileDialog.getByRole("button", { name: "Save Profile" });
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAttribute("title", "No pending profile draft changes to save");

  // Enter on a pristine independent tab must not issue a save.
  await profileDialog.press("Enter");
  expect(putCount).toBe(0);

  // Dirty draft stays saveable from the independent tab.
  await selectProfileTab(profileDialog, "Profile Info", "info");
  const nameField = profileDialog.getByLabel("Display name");
  const originalName = await nameField.inputValue();
  await nameField.fill(`${originalName} dirty`);
  await selectProfileTab(profileDialog, "Messages", "messages");
  await expect(
    profileDialog.locator(".profile-editor-footer").getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await expect(profileDialog.getByRole("button", { name: "Save Profile" })).toBeEnabled();

  api.assertNoUnexpectedRequests();
});

test("More actions gates impersonate and resolve duplicate", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const profiles = api.profiles.get();
  const baseProfile = profiles[0] ?? buildOrganizationProfile({});
  api.profiles.set([{ ...baseProfile, id: profileId }]);
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

  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const profileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(profileDialog).toBeVisible();

  const moreActions = profileDialog.getByRole("button", { name: "More actions" });
  await expect(moreActions).toBeVisible();
  await moreActions.click();
  await expect(page.getByRole("menuitem", { name: "Impersonate" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Resolve duplicate" })).toBeVisible();
  await page.keyboard.press("Escape");

  api.assertNoUnexpectedRequests();
});

test("saves no-account contact email and phone without an invitation", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const profile = buildOrganizationProfile({
    displayName: "Imported Person",
    email: "imported@example.test",
    phone: "+12025550123",
    voicePart: "",
  });
  api.profiles.set([]);
  await page.route("**/api/organization/profiles/import", async (route) => {
    const csv = route.request().postData() ?? "";
    expect(csv).toContain("imported@example.test");
    expect(csv).toContain("+12025550123");
    api.profiles.set([profile]);
    await route.fulfill({
      status: 201,
      json: {
        imported: 1,
        emailsPersisted: 1,
        phonesPersisted: 1,
        conflicts: [],
        requestId: "99999999-9999-4999-8999-999999999999",
      },
    });
  });
  await page.route("**/api/organization/members", (route) =>
    route.fulfill({
      json: {
        memberships: [],
        truncated: false,
        requestId: "99999999-9999-4999-8999-999999999999",
      },
    }),
  );
  const invitations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("invitations"))
      invitations.push(request.url());
  });
  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const importDialog = page.getByRole("dialog", { name: "Import roster", exact: true });
  await importDialog.getByLabel("Choose CSV file").setInputFiles({
    name: "synthetic-roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Name,Last Name,Email,Phone,Performer,Status\nImported Person,Person,imported@example.test,+12025550123,,Active",
    ),
  });
  await expect(importDialog.getByLabel("Map Email", { exact: true })).toHaveValue("Email");
  await expect(
    importDialog.getByText("Sample values: imported@example.test", { exact: true }),
  ).toBeVisible();
  await importDialog.getByLabel("Map Last Name", { exact: true }).selectOption("");
  await importDialog.getByLabel("Map Status", { exact: true }).selectOption("");
  await importDialog
    .getByRole("checkbox", { name: "I reviewed these warnings and want to proceed." })
    .check();
  await importDialog.getByRole("button", { name: "Proceed with import", exact: true }).click();
  await expect(importDialog).not.toBeVisible();
  await expect(page.getByRole("link", { name: "imported@example.test" })).toBeVisible();
  await page.locator('[aria-label="Edit profile Imported Person"]:visible').click();
  const dialog = page.getByRole("dialog", { name: /Profile/ });
  await expect(dialog.getByLabel("Contact email", { exact: true })).toHaveValue(
    "imported@example.test",
  );
  await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue("+12025550123");
  await dialog.getByLabel("Contact email", { exact: true }).fill("edited@example.test");
  await dialog.getByRole("button", { name: "Save Profile", exact: true }).click();
  await expect(page.getByRole("link", { name: "edited@example.test" })).toBeVisible();
  await page.locator('[aria-label="Edit profile Imported Person"]:visible').click();
  await expect(dialog.getByLabel("Contact email", { exact: true })).toHaveValue(
    "edited@example.test",
  );
  await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue("+12025550123");
  expect(invitations).toEqual([]);
  api.assertNoUnexpectedRequests();
});

test.describe("tablet roster layout", () => {
  // These layout tests mock the API. Keep the app's caching service worker from
  // bypassing Playwright routing; offline behavior has separate real-network suites.
  test.use({ serviceWorkers: "block" });
  for (const theme of ["light", "dark"] as const) {
    test(`tablet roster keeps names readable and actions usable in ${theme} @webkit-smoke`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript((mode) => {
        localStorage.setItem(`choir-theme:${location.hostname}`, mode);
      }, theme);
      const api = await installOrganizationApi(page, { role: "administrator", strict: true });
      await page.route("**/api/organization/members", (route) =>
        route.fulfill({ json: { memberships: [], truncated: false, requestId } }),
      );
      const names = [
        "Daniel Brooks",
        "Michael Carter",
        "Andrew Wilson",
        "Benjamin Reed",
        "Christopher Ellis",
        "David Morgan",
        "Edward Parker",
        "James Sullivan",
      ];
      api.profiles.set(
        names.map((displayName, index) =>
          buildOrganizationProfile({
            id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
            displayName,
            email: `${displayName.toLowerCase().replace(" ", ".")}@example.test`,
            voicePart: index % 2 === 0 ? "S1" : "A1",
          }),
        ),
      );
      await page.setViewportSize({ width: 834, height: 1194 });
      await page.goto("/admin/roster");
      const panel = page.getByRole("tabpanel", { name: "Roster", exact: true });
      const table = panel.locator(".data-table");
      await expect(
        table.getByRole("row", { name: "Edit profile Christopher Ellis", exact: true }),
      ).toBeVisible();
      for (const width of [820, 834, 1024, 1180]) {
        await page.setViewportSize({ width, height: 1194 });
        if (width <= 1024) {
          await expect(page.locator(".signed-in-sidebar")).toBeHidden();
          await expect(
            page.getByRole("button", { name: "Open workspace navigation" }),
          ).toBeVisible();
        }
        await expect(table.getByRole("button", { name: "Sort by Email address" })).toBeHidden();
        const dimensions = await table
          .locator(".roster-table__identity strong")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              height: node.getBoundingClientRect().height,
              width: node.getBoundingClientRect().width,
            })),
          );
        for (const name of dimensions) {
          expect(name.height, `${String(width)}px: name must fit on one line`).toBeLessThan(30);
          expect(name.width).toBeGreaterThan(70);
        }
        const geometry = await table.evaluate((element) => ({
          table: element.getBoundingClientRect().width,
          wrapper: element.parentElement?.getBoundingClientRect().width ?? 0,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        }));
        expect(geometry.table).toBeLessThanOrEqual(geometry.wrapper + 1);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: 834, height: 1194 });
      await panel.getByRole("button", { name: /^Sopranos/ }).click();
      await expect(table.locator("tbody tr")).toHaveCount(4);
      await panel.getByRole("button", { name: /^All 8$/ }).click();
      await expect(table.locator("tbody tr")).toHaveCount(8);
      await table.getByRole("button", { name: "Sort by Name" }).click();
      await expect(table.locator("th[aria-sort='descending']")).toContainText("Name");
      await table.getByRole("button", { name: "Sort by Name" }).click();
      await table.getByRole("button", { name: "Sort by Name" }).click();
      await expect(table.locator("th[aria-sort='ascending']")).toContainText("Name");
      await page.locator(".roster-balance__details summary").click();
      await expect(panel.getByRole("button", { name: /^S1/ })).toBeVisible();
      await page.locator(".roster-balance__details summary").click();
      await table.getByRole("checkbox", { name: "Select Daniel Brooks", exact: true }).check();
      await expect(page.getByText("1 selected", { exact: false })).toBeVisible();
      await table.getByRole("checkbox", { name: "Select Daniel Brooks", exact: true }).uncheck();
      await table.getByRole("button", { name: "More actions for Daniel Brooks" }).click();
      await page.getByRole("menuitem", { name: "Edit profile", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Open workspace navigation" }).click();
      await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Open workspace navigation" })).toBeFocused();
      const accessibility = await new AxeBuilder({ page })
        .include("#signed-in-main")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        accessibility.violations.filter(
          ({ impact }) => impact === "serious" || impact === "critical",
        ),
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`tablet-roster-${theme}.png`),
        fullPage: true,
      });
      api.assertNoUnexpectedRequests();
    });
  }
});
