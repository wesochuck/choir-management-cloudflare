import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildSingerDashboardResponse } from "./fixtures/builders";
import { fulfillJson, installSessionShell } from "./fixtures/session";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dashboardRequestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("explains how to start when no Organization is active", async ({ page }) => {
  let singerDashboardRequested = false;

  await installSessionShell(page, {
    user: {
      email: "member.dashboard@example.test",
      name: "Member Dashboard User",
      sessionId: "session-member-dashboard",
      userId: "user-member-dashboard",
    },
  });
  await page.route("**/api/account/organizations", async (route) => {
    await fulfillJson(route, { organizations: [] });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await fulfillJson(
      route,
      {
        code: "not_found",
        message: "No canonical Organization hostname is active.",
        requestId,
      },
      404,
    );
  });
  await page.route("**/api/organization/module-state", async (route) => {
    await fulfillJson(route, { requestId }, 404);
  });
  await page.route("**/api/setup/status", async (route) => {
    await fulfillJson(route, { requestId }, 404);
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await fulfillJson(route, {
      activePlatformAdministrator: false,
      enrollmentComplete: false,
      requestId,
      twoFactorEnabled: false,
    });
  });
  await page.route("**/api/singer/dashboard", async (route) => {
    singerDashboardRequested = true;
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

  const api = await installOrganizationApi(page, {
    modules: [],
    role: "member",
    strict: true,
    user: {
      email: "member.dashboard@example.test",
      name: "Member Dashboard User",
      sessionId: "session-member-dashboard",
      userId: "user-member-dashboard",
    },
  });
  api.setSingerDashboard(
    buildSingerDashboardResponse({
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
            {
              pieceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              title: "Opening Song",
              type: "song",
            },
          ],
          startsAt: "2026-09-01T23:00:00.000Z",
          title: "Published Performance",
          type: "Performance",
          venueAddress: "",
          venueName: "Main Hall",
        },
      ],
      organizationName: "Lancaster Men's Chorus",
      profile: {
        displayName: "Wes Osborn",
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        voicePart: "S",
      },
      requestId: dashboardRequestId,
      timezone: "UTC",
    }),
  );

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Welcome back, Wes Osborn" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Practice" })).toBeVisible();
  await expect(page.getByText("View set list (1 items)")).toBeVisible();
  api.assertNoUnexpectedRequests();
});
