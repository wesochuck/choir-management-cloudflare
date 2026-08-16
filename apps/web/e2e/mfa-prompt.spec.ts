import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const organizationId = "organization-mfa-prompt";
const profileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const session = {
  session: {
    activeOrganizationId: organizationId,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-mfa-prompt",
    ipAddress: "192.0.2.70",
    token: "mfa-prompt-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-mfa-prompt",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "mfa.member@example.test",
    emailVerified: true,
    id: "user-mfa-prompt",
    image: null,
    name: "MFA Member",
    twoFactorEnabled: true,
    updatedAt: "2026-07-20T20:00:00.000Z",
  },
} as const;

const schedule = {
  events: [
    {
      attendanceWarning: null,
      callTime: "18:00",
      details: "Bring your music.",
      directRsvp: "Pending" as const,
      durationMinutes: 120,
      featuredAssignments: [],
      id: eventId,
      inheritedFromParent: false,
      location: "Choir Room",
      practice: { sourceEventId: null, status: "not_published" as const, trackCount: 0 },
      resolvedRsvp: "Pending" as const,
      rsvpDeadlineAt: null,
      rsvpDeadlineDate: null,
      rsvpDeadlinePassed: false,
      rsvpNote: "",
      rsvpSelfServiceOpen: true,
      seating: { status: "not_published" as const },
      setList: [],
      startsAt: "2026-08-21T23:00:00.000Z",
      title: "Tuesday Rehearsal",
      type: "Rehearsal" as const,
      venueAddress: "",
      venueName: "",
    },
  ],
  profileId,
  requestId,
  timezone: "America/New_York",
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

test("allows members to verify Organization MFA from a blocked schedule", async ({ page }) => {
  let verified = false;

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname === "/api/organization/mfa/verify" && method === "POST") {
      expect(route.request().postDataJSON()).toEqual({ code: "123456", method: "totp" });
      verified = true;
      await fulfillJson(route, {
        expiresAt: "2026-08-17T08:00:00.000Z",
        organizationId,
        requestId,
        status: "verified",
      });
      return;
    }
    if (pathname === "/api/organization/auth-status") {
      await fulfillJson(route, {
        mfaRequired: true,
        mfaVerifiedUntil: verified ? "2026-08-17T08:00:00.000Z" : null,
        organizationId,
        requestId,
        role: "member",
        twoFactorEnabled: true,
        twoFactorVerified: true,
      });
      return;
    }
    if (pathname === "/api/singer/events") {
      await fulfillJson(route, schedule, verified ? 200 : 403);
      return;
    }
    if (pathname === "/api/singer/calendar-feed-url") {
      await fulfillJson(route, { requestId }, 404);
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/auth/get-session": session,
      "/api/health": {
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/organization/module-state": {
        modules: [
          { enabled: true, id: "events" },
          { enabled: true, id: "people" },
          { enabled: true, id: "programs" },
        ],
      },
      "/api/platform/mfa/status": {
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      },
    };
    if (pathname === "/api/setup/status") {
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

  await page.goto("/schedule");
  await expect(
    page.getByText("Verify Organization MFA to view your schedule.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Verify Organization MFA" }).first().click();
  const verificationForm = page.getByRole("form", { name: "Verify Organization MFA" });
  await verificationForm.getByLabel("6-digit Organization code").fill("123456");
  await verificationForm.getByRole("button", { name: "Verify Organization access" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Organization MFA verified for this browser session.",
  );
  await page.getByRole("button", { name: "Refresh to continue" }).click();
  await expect(page.getByRole("heading", { name: "Tuesday Rehearsal" })).toBeVisible();
  await expect(
    page.getByText("Verify Organization MFA to view your schedule.", { exact: true }),
  ).toHaveCount(0);
});
