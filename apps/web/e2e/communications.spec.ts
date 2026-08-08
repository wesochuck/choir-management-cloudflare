import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const eventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const firstTemplateId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const secondTemplateId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const auditionTemplateId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const donationTemplateId = "11111111-1111-4111-8111-111111111111";

const session = {
  session: {
    activeOrganizationId: organizationId,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-communications",
    ipAddress: "192.0.2.40",
    token: "communications-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-communications-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "communications.admin@example.test",
    emailVerified: true,
    id: "user-communications-admin",
    image: null,
    name: "Communications Administrator",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

async function handleRoute(route: Route, previewBodies: unknown[]): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === "/api/public/projection") {
    await route.fulfill({ status: 404 });
    return;
  }
  if (pathname === "/api/organization/communications/reach-preview") {
    previewBodies.push(route.request().postDataJSON());
    await fulfillJson(route, {
      both: 0,
      email: 2,
      requestId,
      sms: 0,
      total: 2,
      unreachable: 0,
    });
    return;
  }

  const responses: Record<string, unknown> = {
    "/api/account/organizations": {
      organizations: [
        {
          canonicalHostname: "communications.example.test",
          canonicalStatus: "active",
          lifecycleState: "active",
          name: "Communications Choir",
          organizationId,
          profileId: null,
          role: "administrator",
          slug: "communications",
        },
      ],
    },
    "/api/auth/get-session": session,
    "/api/health": {
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
    "/api/organization/communications": { messages: [], requestId },
    "/api/organization/communications/scheduled": { messages: [], requestId },
    "/api/organization/communications/templates": {
      requestId,
      templates: [
        {
          channel: "Email",
          contentMarkdown: "Hello from the first template.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: firstTemplateId,
          isSystem: false,
          subject: "First template",
          title: "First template",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
        {
          channel: "Email",
          contentMarkdown: "Hello from the second template.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: secondTemplateId,
          isSystem: false,
          subject: "Second template",
          title: "Second template",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
        {
          channel: "Email",
          contentMarkdown: "Your audition is confirmed for {auditionDate}.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: auditionTemplateId,
          isSystem: true,
          subject: "Your audition is confirmed",
          title: "Audition Confirmed",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
        {
          channel: "Email",
          contentMarkdown: "Thank you for your donation to {organizationName}.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: donationTemplateId,
          isSystem: true,
          subject: "Donation receipt from {organizationName}",
          title: "Donation Payment Receipt",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
      ],
    },
    "/api/organization/events": {
      events: [
        {
          advancePriceCents: 0,
          callTime: "",
          createdAt: "2026-07-20T20:00:00.000Z",
          dayOfPriceCents: 0,
          details: "",
          doorsOpenTime: "",
          durationMinutes: null,
          id: eventId,
          isCanceled: false,
          isTicketingEnabled: false,
          location: "Main Hall",
          parentPerformanceId: null,
          publicDetails: "",
          publicGraphicFileId: null,
          publishOnWebsite: false,
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpFollowUpLeadHours: null,
          rsvpFollowUpMode: "inherit",
          rsvpSelfServiceOpen: true,
          setList: [],
          setListApproved: false,
          startsAt: "2026-08-20T23:00:00.000Z",
          ticketCapacity: null,
          title: "Browser Performance",
          type: "Performance",
          updatedAt: "2026-07-20T20:00:00.000Z",
          venueId: null,
        },
      ],
      requestId,
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
      sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
      statusAutomationEnabled: false,
      statusAutomationMissThreshold: 3,
      statusAutomationRecoveryEnabled: true,
      voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
    },
    "/api/platform/mfa/status": {
      activePlatformAdministrator: false,
      enrollmentComplete: false,
      requestId,
      twoFactorEnabled: false,
    },
    "/api/setup/status": {
      allModulesConfigured: true,
      completedSteps: [],
      currentStep: null,
      launched: true,
      organizationId,
      organizationName: "Communications Choir",
    },
  };
  await fulfillJson(
    route,
    responses[pathname] ?? { code: "not_found", message: "Not found", requestId },
    responses[pathname] ? 200 : 404,
  );
}

test("preserves all selected audiences when reach preview follows quick selection", async ({
  page,
}) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications");
  const audience = page.getByRole("group", { name: "Audience" });
  const ticketBuyers = audience.getByRole("checkbox", { name: "Ticket Buyers" });
  const donors = audience.getByRole("checkbox", { name: "Donors" });

  await expect(audience.getByRole("checkbox", { name: "Members" })).toBeChecked();
  await ticketBuyers.click();
  await donors.click();
  await page.getByRole("button", { name: "Preview audience reach" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Audience reach" })).toContainText(
    "2 reachable",
  );
  await expect(audience.getByRole("checkbox", { name: "Members" })).toBeChecked();
  await expect(ticketBuyers).toBeChecked();
  await expect(donors).toBeChecked();
  expect(previewBodies).toHaveLength(1);
  expect(previewBodies[0]).toEqual({
    audience: {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Members", "Ticket Buyers", "Donors"],
      voiceParts: [],
    },
    channel: "Email",
  });
});

test("uses an optional template picker and confirms before replacing a draft", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications");
  await page.getByRole("button", { name: "Continue to compose" }).click();

  const templatePicker = page.getByLabel("Choose a template (optional)");
  await expect(templatePicker).toHaveValue("");
  await expect(templatePicker).toContainText("First template");
  await expect(templatePicker).not.toContainText("Audition Confirmed");
  await expect(templatePicker).not.toContainText("Donation Payment Receipt");

  await templatePicker.selectOption(firstTemplateId);
  await expect(templatePicker).toHaveValue(firstTemplateId);
  await expect(page.getByLabel("Subject")).toHaveValue("First template");

  let warningMessage = "";
  page.once("dialog", async (dialog) => {
    warningMessage = dialog.message();
    await dialog.dismiss();
  });
  await templatePicker.selectOption(secondTemplateId);
  expect(warningMessage).toContain("replace your current in-progress draft");
  await expect(templatePicker).toHaveValue(firstTemplateId);
  await expect(page.getByLabel("Subject")).toHaveValue("First template");

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await templatePicker.selectOption(secondTemplateId);
  await expect(templatePicker).toHaveValue(secondTemplateId);
  await expect(page.getByLabel("Subject")).toHaveValue("Second template");
});

test("keeps audition system templates in the management tab only", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=templates");
  await expect(page.getByText("Audition Confirmed")).toBeVisible();
  await expect(page.getByText("Donation Payment Receipt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use template" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit wording" }).first()).toBeVisible();
});
