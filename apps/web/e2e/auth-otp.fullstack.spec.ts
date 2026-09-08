// FULL-STACK suite (reaches the real local Worker/D1).
//
// Email-code sign-in and session restoration against Better Auth with no
// `page.route(...)` mocks. Seeding goes through the local-only
// POST /api/local/fullstack-bootstrap seam (404 outside APP_ENV=local); the
// one-time code travels through PLATFORM_EMAIL_MODE=capture and is read back
// through the local-only GET /api/local/fullstack-otp seam, so no real email
// is sent. Mocked sign-in-state coverage lives in auth.session.spec.ts.
import { expect, test } from "@playwright/test";
import { currentAuthSessionSchema, organizationAuthStatusResponseSchema } from "@choir/contracts";
import {
  bootstrapFullstack,
  FULLSTACK_ADMIN_EMAIL,
  FULLSTACK_APP_ORIGIN,
  signInWithFullstackOtp,
} from "./fixtures/fullstack";

test("signs in with a real one-time code and restores the session", async ({ page, request }) => {
  const seed = await bootstrapFullstack(request);
  expect(seed.email).toBe(FULLSTACK_ADMIN_EMAIL);

  await signInWithFullstackOtp(page, request);

  // The live auth-status contract proves the session belongs to the seeded
  // tenant with an administrator role. A Worker regression that drops the
  // role, renames a field, or binds the wrong Organization fails here.
  // page.request shares the signed-in browser cookies; the standalone
  // request fixture does not.
  const authStatus = await page.request.get(`${FULLSTACK_APP_ORIGIN}/api/organization/auth-status`);
  expect(authStatus.ok()).toBe(true);
  const statusBody = organizationAuthStatusResponseSchema.parse(await authStatus.json());
  expect(statusBody).toMatchObject({
    mfaRequired: false,
    organizationId: "organization-fullstack",
    role: "administrator",
  });

  const session = await page.request.get(`${FULLSTACK_APP_ORIGIN}/api/auth/get-session`);
  expect(session.ok()).toBe(true);
  const sessionBody = currentAuthSessionSchema.parse(await session.json());
  expect(sessionBody?.user.email).toBe(FULLSTACK_ADMIN_EMAIL);

  // Session restoration: a full reload must keep the workspace, not bounce
  // back to the sign-in wall.
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toHaveCount(0);

  await page.getByRole("banner").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${FULLSTACK_APP_ORIGIN}/`);
  await expect(page.getByLabel("Account").getByRole("link", { name: "Sign in" })).toBeVisible();

  const afterSignOut = await page.request.get(`${FULLSTACK_APP_ORIGIN}/api/auth/get-session`);
  expect(afterSignOut.ok()).toBe(true);
  expect(currentAuthSessionSchema.parse(await afterSignOut.json())).toBeNull();
});
