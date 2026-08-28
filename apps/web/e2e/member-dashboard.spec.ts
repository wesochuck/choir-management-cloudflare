import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const session = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-member-dashboard",
    ipAddress: "192.0.2.60",
    token: "member-dashboard-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-member-dashboard",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "member.dashboard@example.test",
    emailVerified: true,
    id: "user-member-dashboard",
    image: null,
    name: "Member Dashboard User",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T20:00:00.000Z",
  },
} as const;

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

test("explains how to start when no Organization is active", async ({ page }) => {
  let singerDashboardRequested = false;

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/singer/dashboard") {
      singerDashboardRequested = true;
      await fulfillJson(route, { requestId }, 404);
      return;
    }
    if (pathname === "/api/organization/auth-status") {
      await fulfillJson(
        route,
        {
          code: "not_found",
          message: "No canonical Organization hostname is active.",
          requestId,
        },
        404,
      );
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/account/organizations": { organizations: [] },
      "/api/auth/get-session": session,
      "/api/health": {
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/platform/mfa/status": {
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      },
    };
    if (pathname === "/api/organization/module-state" || pathname === "/api/setup/status") {
      await fulfillJson(route, { requestId }, 404);
      return;
    }
    const response = responses[pathname];
    if (response !== undefined) {
      await fulfillJson(route, response);
      return;
    }
    await fulfillJson(route, { requestId }, 404);
  });

  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "Choose an Organization to get started" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Your member workspace shows schedules, RSVPs, practice tracks, and Organization updates after you open an active Organization Membership.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "View your Organizations" })).toBeVisible();
  expect(singerDashboardRequested).toBe(false);

  await page.getByRole("button", { name: "View your Organizations" }).click();
  await expect(page).toHaveURL(/\/account\/organizations$/);
  await expect(page.getByRole("heading", { name: "Your Organizations" })).toBeVisible();
  await expect(
    page.getByText(/You do not have an active Organization Membership yet/),
  ).toBeVisible();
});

test("offers published practice and set-list actions before RSVP", async ({ page }) => {
  const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const dashboard = {
    activeSeason: null,
    activeSeasonState: "disabled",
    bulletins: [],
    bulletinsState: "ready",
    events: [
      {
        attendanceWarning: null,
        callTime: "18:00",
        details: "",
        directRsvp: "Pending",
        durationMinutes: 120,
        featuredAssignments: [],
        id: eventId,
        inheritedFromParent: false,
        location: "Main Hall",
        practice: { sourceEventId: eventId, status: "available", trackCount: 1 },
        resolvedRsvp: "Pending",
        rsvpDeadlineAt: null,
        rsvpDeadlineDate: null,
        rsvpDeadlinePassed: false,
        rsvpNote: "",
        rsvpSelfServiceOpen: true,
        seating: { status: "not_published" },
        setList: [
          { pieceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", title: "Opening Song", type: "song" },
        ],
        startsAt: "2026-09-01T23:00:00.000Z",
        title: "Published Performance",
        type: "Performance",
        venueAddress: "",
        venueName: "Main Hall",
      },
    ],
    modules: [],
    organizationName: "Lancaster Men's Chorus",
    performerLabel: "Singer",
    polls: [],
    pollsState: "disabled",
    profile: {
      displayName: "Wes Osborn",
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      voicePart: "S",
    },
    profileLinkRequired: false,
    requestId,
    resources: [],
    resourcesState: "disabled",
    timezone: "UTC",
  };

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/get-session") {
      await fulfillJson(route, session);
      return;
    }
    if (pathname === "/api/health") {
      await fulfillJson(route, {
        baseHostname: "127.0.0.1",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      });
      return;
    }
    if (pathname === "/api/organization/auth-status") {
      await fulfillJson(route, {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "organization-alpha",
        requestId,
        role: "member",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      });
      return;
    }
    if (pathname === "/api/organization/module-state") {
      await fulfillJson(route, { modules: [] });
      return;
    }
    if (pathname === "/api/setup/status") {
      await fulfillJson(route, {
        allModulesConfigured: true,
        completedSteps: [],
        currentStep: null,
        launched: true,
        organizationId: "organization-alpha",
        organizationName: "Lancaster Men's Chorus",
      });
      return;
    }
    if (pathname === "/api/singer/dashboard") {
      await fulfillJson(route, dashboard);
      return;
    }
    await fulfillJson(route, { requestId }, 404);
  });

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Welcome back, Wes Osborn" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Practice" })).toBeVisible();
  await expect(page.getByText("View set list (1 items)")).toBeVisible();
});
