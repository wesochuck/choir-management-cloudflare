import { expect, test } from "@playwright/test";

const currentSession = {
  activeOrganizationId: null,
  createdAt: "2026-07-20T20:00:00.000Z",
  expiresAt: "2026-07-27T20:00:00.000Z",
  id: "session-current",
  ipAddress: "192.0.2.10",
  token: "current-session-token-not-displayed",
  updatedAt: "2026-07-20T20:00:00.000Z",
  userAgent: "Chromium browser",
  userId: "user-invited-member",
} as const;

const currentUser = {
  createdAt: "2026-07-20T19:00:00.000Z",
  email: "invited.member@example.test",
  emailVerified: true,
  id: "user-invited-member",
  image: null,
  name: "Invited Member",
  twoFactorEnabled: false,
  updatedAt: "2026-07-20T20:00:00.000Z",
} as const;

test("completes OTP sign-in and manages Organizations and sessions", async ({ page }) => {
  let signedIn = false;
  let sessions = [
    currentSession,
    {
      ...currentSession,
      id: "session-other",
      ipAddress: "198.51.100.4",
      token: "other-session-token-not-displayed",
      userAgent: "Safari on iPad",
    },
  ];

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
      body: JSON.stringify(signedIn ? { session: currentSession, user: currentUser } : null),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    signedIn = true;
    await route.fulfill({
      body: JSON.stringify({ token: "not-used-by-browser-ui", user: currentUser }),
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
            profileId: null,
            role: "administrator",
            slug: "alpha",
          },
          {
            canonicalHostname: "future.example.test",
            canonicalStatus: "pending",
            lifecycleState: "provisioning",
            name: "Future Choir",
            organizationId: "organization-future",
            profileId: null,
            role: "member",
            slug: "future",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/list-sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessions),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/revoke-session", async (route) => {
    sessions = sessions.filter((session) => session.id !== "session-other");
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    signedIn = false;
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(currentUser.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If invited.member@example.test has access",
  );
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Welcome, Invited Member." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Organization Alpha" })).toBeVisible();
  await expect(page.getByText("Future Choir")).toBeVisible();
  await expect(page.getByText("Setup pending")).toBeVisible();

  const otherSession = page.getByRole("listitem", { name: "Session: Safari on iPad" });
  await expect(otherSession).toBeVisible();
  await otherSession.getByRole("button", { name: "Revoke session" }).click();
  await expect(otherSession).toHaveCount(0);
  await expect(page.getByText("current-session-token-not-displayed")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});
