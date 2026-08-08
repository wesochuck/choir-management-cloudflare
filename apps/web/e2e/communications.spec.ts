import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const eventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
