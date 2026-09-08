import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import {
  buildAccountMembership,
  buildMemberEmailChangeConfirmationResponse,
  buildMemberEmailChangeResponse,
} from "./fixtures/builders";
import { fulfillJson } from "./fixtures/session";

test("completes OTP sign-in and manages Organizations and sessions", async ({ page }) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: false,
    memberships: [
      buildAccountMembership({}),
      buildAccountMembership({
        canonicalHostname: "future.example.test",
        canonicalStatus: "pending",
        lifecycleState: "provisioning",
        name: "Future Choir",
        organizationId: "organization-future",
        role: "member",
        slug: "future",
      }),
    ],
    role: "member",
    strict: true,
  });
  api.session.accountSessions.set([
    api.session.session,
    {
      ...api.session.session,
      id: "session-other",
      ipAddress: "198.51.100.4",
      userAgent: "Safari on iPad",
    },
  ]);
  // The differing behavior for this journey is the email-change request assertion; the
  // surrounding session shell comes from the shared fixtures and is shadowed here.
  await page.route("**/api/singer/profile/email-change", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: "updated.browser@example.test" });
    await fulfillJson(
      route,
      buildMemberEmailChangeResponse("updated.browser@example.test", api.session.accountRequestId),
    );
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(api.session.user.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If invited.member@example.test has access",
  );
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible();
  const memberProfileForm = page.locator(".member-profile-form");
  await expect(page.getByRole("region", { name: "My Organization Profile" })).toBeVisible();
  await memberProfileForm.getByLabel("New sign-in email").fill("updated.browser@example.test");
  await memberProfileForm.getByRole("button", { name: "Change email" }).click();
  await expect(memberProfileForm.getByRole("status")).toContainText("confirmation link");

  await page.goto("/account/organizations");
  await expect(page.getByRole("heading", { name: "Welcome, Invited Member." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Organization Alpha" })).toBeVisible();
  await expect(page.getByText("Future Choir")).toBeVisible();
  await expect(page.getByText("Setup pending")).toBeVisible();

  await page.goto("/account/security");
  const passwordSection = page.getByRole("region", { name: "Account password" });
  const userPassword = "a-user-managed-password";
  await passwordSection.getByLabel("New password", { exact: true }).fill(userPassword);
  await passwordSection.getByLabel("Confirm new password").fill(userPassword);
  await passwordSection.getByRole("button", { name: "Add password" }).click();
  await expect(passwordSection.getByRole("status")).toContainText("Password added");
  await expect(passwordSection.getByLabel("Current password")).toBeVisible();

  await page.goto("/account/sessions");
  const otherSession = page.getByRole("listitem", { name: "Session: Safari on iPad" });
  await expect(otherSession).toBeVisible();
  await otherSession.getByRole("button", { name: "Revoke session" }).click();
  await expect(otherSession).toHaveCount(0);
  await expect(page.getByText("current-session-token-not-displayed")).toHaveCount(0);

  await page.getByRole("banner").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  api.assertNoUnexpectedRequests();
});

test("confirms a member email change from the one-time link", async ({ page }) => {
  const api = await installOrganizationApi(page, { initiallySignedIn: false, strict: true });
  const token = "browser-email-change-token-123456";
  await page.route("**/api/account/email-change/confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    await fulfillJson(
      route,
      buildMemberEmailChangeConfirmationResponse(
        "updated.browser@example.test",
        api.session.accountRequestId,
      ),
    );
  });

  await page.goto(`/confirm-email-change?token=${token}`);
  await expect(page).toHaveURL(/\/confirm-email-change$/);
  await expect(page.getByRole("heading", { name: "Confirm your email address" })).toBeVisible();
  await expect(page.locator(".auth-card").getByRole("status")).toContainText(
    "updated.browser@example.test",
  );
  api.assertNoUnexpectedRequests();
});

test("offers password MFA sign-in and completes non-enumerating account recovery", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { initiallySignedIn: false, strict: true });
  const resetToken = "browser-reset-token-123456";
  await page.route("**/api/auth/sign-in/email", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: api.session.user.email,
      password: "member-password-value",
    });
    await fulfillJson(route, { twoFactorMethods: ["totp"], twoFactorRedirect: true });
  });
  await page.route("**/api/auth/request-password-reset", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: api.session.user.email,
    });
    await fulfillJson(route, {
      message: "If this email exists in our system, check your email for the reset link",
      status: true,
    });
  });
  await page.route("**/api/auth/reset-password", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      newPassword: "a-new-browser-password",
      token: resetToken,
    });
    await fulfillJson(route, { status: true });
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Password", exact: true }).click();
  await page.getByLabel("Email address").fill(api.session.user.email);
  await page.getByLabel("Password", { exact: true }).fill("member-password-value");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Complete two-factor sign-in",
  );
  await expect(page.getByLabel("6-digit authenticator code")).toBeVisible();

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(api.session.user.email.toUpperCase());
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If that email belongs to an invited account",
  );

  await page.goto(`/reset-password#token=${resetToken}`);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill("a-new-browser-password");
  await page.getByLabel("Confirm new password").fill("a-different-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("alert")).toContainText("passwords do not match");
  await page.getByLabel("Confirm new password").fill("a-new-browser-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("password was reset");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  api.assertNoUnexpectedRequests();
});
