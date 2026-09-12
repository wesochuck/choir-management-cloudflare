import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

test("displays passkey hero action, divider, and webauthn autocomplete on sign-in page", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: false,
    role: "member",
    strict: true,
  });

  await page.goto("/login");

  // Verify visual hierarchy
  const heading = page.getByRole("heading", { name: "Sign in to Choir Management." });
  await expect(heading).toBeVisible();

  const passkeyHeroButton = page.getByRole("button", { name: "Sign in with a passkey" });
  await expect(passkeyHeroButton).toBeVisible();

  const divider = page.getByText("or sign in with email", { exact: true });
  await expect(divider).toBeVisible();

  const emailInput = page.getByLabel("Email address");
  await expect(emailInput).toBeVisible();
  await expect(emailInput).toHaveAttribute("autocomplete", "username webauthn");

  api.assertNoUnexpectedRequests();
});

test("handles passkey cancellation gracefully without disrupting email sign-in", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: false,
    role: "member",
    strict: true,
  });

  await page.goto("/login");

  // Mock navigator.credentials.get to reject with NotAllowedError (user cancelled)
  await page.evaluate(() => {
    navigator.credentials.get = () =>
      Promise.reject(new DOMException("The operation was aborted.", "NotAllowedError"));
  });

  const passkeyHeroButton = page.getByRole("button", { name: "Sign in with a passkey" });
  await passkeyHeroButton.click();

  // User cancellation is handled gracefully: no disruptive error alert, email form ready
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Email form is immediately usable
  const emailInput = page.getByLabel("Email address");
  await emailInput.fill(api.session.user.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();

  await expect(page.getByRole("main").getByRole("status")).toContainText(
    `If ${api.session.user.email} has access`,
  );

  api.assertNoUnexpectedRequests();
});

test("manages passkeys in Account Security: empty state, list, rename, and delete", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: true,
    role: "member",
    strict: true,
  });

  await page.goto("/account/security");

  const passkeySection = page.getByRole("region", { name: "Passkeys" });
  await expect(passkeySection).toBeVisible();

  // 1. Initial empty state
  await expect(
    passkeySection.getByText("No passkeys registered yet.", { exact: false }),
  ).toBeVisible();
  await expect(passkeySection.getByRole("button", { name: "Add a passkey" })).toBeVisible();

  // 2. Populate a passkey into the list
  api.session.userPasskeys.set([
    {
      createdAt: new Date().toISOString(),
      id: "passkey-touch-id",
      name: "MacBook Touch ID",
    },
  ]);
  await page.reload();

  const passkeyItem = page.getByRole("region", { name: "Passkeys" });
  await expect(passkeyItem.getByText("MacBook Touch ID")).toBeVisible();
  await expect(passkeyItem.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(passkeyItem.getByRole("button", { name: "Remove" })).toBeVisible();

  // 3. Rename passkey
  await passkeyItem.getByRole("button", { name: "Rename" }).click();
  const nameInput = passkeySection.getByLabel("Passkey name");
  await nameInput.fill("Work MacBook Touch ID");
  await passkeySection.getByRole("button", { name: "Save name" }).click();

  await expect(passkeySection.getByRole("status")).toContainText("Passkey renamed.");
  await expect(passkeyItem.getByText("Work MacBook Touch ID")).toBeVisible();

  // 4. Remove passkey with inline danger confirmation
  await passkeyItem.getByRole("button", { name: "Remove" }).click();
  const confirmGroup = passkeySection.getByRole("group", { name: "Confirm passkey removal" });
  await expect(confirmGroup).toBeVisible();
  await expect(confirmGroup.getByText(/Remove passkey.*Work MacBook Touch ID/)).toBeVisible();
  await confirmGroup.getByRole("button", { name: "Confirm removal" }).click();

  await expect(passkeySection.getByText("Passkey removed.")).toBeVisible();
  // Emptied state should be shown again
  await expect(
    passkeySection.getByText("No passkeys registered yet.", { exact: false }),
  ).toBeVisible();

  api.assertNoUnexpectedRequests();
});

test("bypasses Organization MFA verification when session was authenticated via passkey", async ({
  page,
}) => {
  const organizationId = "organization-passkey-mfa";
  const api = await installOrganizationApi(page, {
    organizationId,
    role: "member",
    strict: true,
    user: {
      activeOrganizationId: organizationId,
      email: "passkey.member@example.test",
      name: "Passkey Member",
      sessionId: "session-passkey-verified",
      twoFactorEnabled: true,
      userId: "user-passkey-mfa",
    },
  });

  // Configure Organization MFA policy as required, but session is authenticated with passkey!
  api.organization.authStatus.update({
    mfaRequired: true,
    mfaSatisfied: true,
    mfaSatisfiedBy: "passkey",
    mfaVerifiedUntil: null,
    twoFactorEnabled: true,
    twoFactorVerified: true,
  });

  await page.route("**/api/singer/events", async (route) => {
    await fulfillJson(route, { events: [], timezone: "America/New_York" });
  });
  await page.route("**/api/singer/calendar-feed-url", async (route) => {
    await fulfillJson(route, { requestId: "req-cal" }, 404);
  });
  await page.route("**/api/setup/status", async (route) => {
    await fulfillJson(route, { requestId: "req-setup" }, 404);
  });

  await page.goto("/schedule");

  // User must NOT see the "Verify Organization MFA" block because passkey satisfied MFA for the session!
  await expect(
    page.getByText("Verify Organization MFA to view your schedule.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "My schedule" })
      .getByRole("button", { name: "Verify Organization MFA" }),
  ).toHaveCount(0);

  api.assertNoUnexpectedRequests();
});

test("enforces Organization MFA verification when session was authenticated via email OTP", async ({
  page,
}) => {
  const organizationId = "organization-passkey-mfa";
  const api = await installOrganizationApi(page, {
    organizationId,
    role: "member",
    strict: true,
    user: {
      activeOrganizationId: organizationId,
      email: "otp.member@example.test",
      name: "OTP Member",
      sessionId: "session-otp-only",
      twoFactorEnabled: true,
      userId: "user-otp-mfa",
    },
  });

  // Configure Organization MFA policy as required, session was NOT authenticated with passkey
  api.organization.authStatus.update({
    mfaRequired: true,
    mfaSatisfied: false,
    mfaSatisfiedBy: null,
    mfaVerifiedUntil: null,
    twoFactorEnabled: true,
    twoFactorVerified: true,
  });

  await page.route("**/api/singer/events", async (route) => {
    await fulfillJson(route, { requestId: "req-events" }, 403);
  });
  await page.route("**/api/singer/calendar-feed-url", async (route) => {
    await fulfillJson(route, { requestId: "req-cal" }, 404);
  });
  await page.route("**/api/setup/status", async (route) => {
    await fulfillJson(route, { requestId: "req-setup" }, 404);
  });

  await page.goto("/schedule");

  // User MUST see the "Verify Organization MFA" block on schedule
  await expect(
    page.getByText("Verify Organization MFA to view your schedule.", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "My schedule" })
      .getByRole("button", { name: "Verify Organization MFA" })
      .first(),
  ).toBeVisible();

  api.assertNoUnexpectedRequests();
});
