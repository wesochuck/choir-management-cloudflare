import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import {
  buildOrganizationMfaVerificationResponse,
  buildSingerEvent,
  buildSingerEventsResponse,
} from "./fixtures/builders";
import { fulfillJson } from "./fixtures/session";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const organizationId = "organization-mfa-prompt";
const profileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const verifiedAt = "2026-08-17T08:00:00.000Z";

test("allows members to verify Organization MFA from a blocked schedule", async ({ page }) => {
  let verified = false;

  const api = await installOrganizationApi(page, {
    organizationId,
    role: "member",
    strict: true,
    user: {
      activeOrganizationId: organizationId,
      email: "mfa.member@example.test",
      name: "MFA Member",
      sessionId: "session-mfa-prompt",
      twoFactorEnabled: true,
      userId: "user-mfa-prompt",
    },
  });
  api.organization.authStatus.update({
    mfaRequired: true,
    mfaVerifiedUntil: null,
    twoFactorEnabled: true,
    twoFactorVerified: true,
  });
  // The blocked schedule stays a 403 until verification succeeds; only the differing behavior
  // lives here, the surrounding shell comes from the shared fixtures.
  await page.route("**/api/singer/events", async (route) => {
    if (!verified) {
      await fulfillJson(route, { requestId }, 403);
      return;
    }
    await fulfillJson(
      route,
      buildSingerEventsResponse(
        [
          buildSingerEvent({
            callTime: "18:00",
            details: "Bring your music.",
            directRsvp: "Pending",
            durationMinutes: 120,
            id: eventId,
            inheritedFromParent: false,
            location: "Choir Room",
            resolvedRsvp: "Pending",
            rsvpDeadlineAt: null,
            rsvpDeadlineDate: null,
            rsvpDeadlinePassed: false,
            rsvpNote: "",
            rsvpSelfServiceOpen: true,
            startsAt: "2026-08-21T23:00:00.000Z",
            title: "Tuesday Rehearsal",
            type: "Rehearsal",
            venueAddress: "",
            venueName: "",
          }),
        ],
        { profileId, requestId, timezone: "America/New_York" },
      ),
    );
  });
  await page.route("**/api/organization/mfa/verify", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ code: "123456", method: "totp" });
    verified = true;
    api.organization.authStatus.update({ mfaVerifiedUntil: verifiedAt });
    await fulfillJson(route, buildOrganizationMfaVerificationResponse(verifiedAt, requestId));
  });
  await page.route("**/api/singer/calendar-feed-url", async (route) => {
    await fulfillJson(route, { requestId }, 404);
  });
  await page.route("**/api/setup/status", async (route) => {
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
  api.assertNoUnexpectedRequests();
});
