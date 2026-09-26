import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

// Login routing asserts only the destination URL, so these suites stay non-strict: the landing
// pages may fetch auxiliary endpoints whose responses do not affect the redirect under test.

test("organization administrator is routed directly to /admin upon login on an organization host", async ({
  page,
}) => {
  await installOrganizationApi(page, {
    initiallySignedIn: false,
    role: "administrator",
    user: {
      email: "org.admin@example.test",
      name: "Org Admin",
      sessionId: "session-admin-1",
      userId: "user-admin-1",
    },
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill("org.admin@example.test");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If org.admin@example.test has access",
  );
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/:\/\/[^/]+\/admin$/);
});

test("regular member is routed directly to /dashboard upon login on an organization host", async ({
  page,
}) => {
  await installOrganizationApi(page, {
    initiallySignedIn: false,
    role: "member",
    user: {
      email: "org.member@example.test",
      name: "Org Member",
      sessionId: "session-member-1",
      userId: "user-member-1",
    },
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill("org.member@example.test");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If org.member@example.test has access",
  );
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/:\/\/[^/]+\/dashboard$/);
});

test("google oauth callback automatically routes administrator to /admin when session hydration is delayed", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: true,
    role: "administrator",
    user: {
      email: "org.admin@example.test",
      name: "Org Admin",
      sessionId: "session-admin-1",
      userId: "user-admin-1",
    },
  });

  await page.route("**/api/auth/get-session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fulfillJson(route, { session: api.session.session, user: api.session.user });
  });

  await page.goto("/login?oauth=complete");
  await expect(page).toHaveURL(/:\/\/[^/]+\/admin$/);
});

test("google oauth callback preserves safe returnTo destination for administrator when session hydration is delayed", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: true,
    role: "administrator",
    user: {
      email: "org.admin@example.test",
      name: "Org Admin",
      sessionId: "session-admin-1",
      userId: "user-admin-1",
    },
  });

  await page.route("**/api/auth/get-session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fulfillJson(route, { session: api.session.session, user: api.session.user });
  });

  await page.goto("/login?oauth=complete&returnTo=%2Fadmin%2Froster");
  await expect(page).toHaveURL(/:\/\/[^/]+\/admin\/roster$/);
});

test("google oauth callback automatically routes regular member to /dashboard when session hydration is delayed", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: true,
    role: "member",
    user: {
      email: "org.member@example.test",
      name: "Org Member",
      sessionId: "session-member-1",
      userId: "user-member-1",
    },
  });

  await page.route("**/api/auth/get-session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fulfillJson(route, { session: api.session.session, user: api.session.user });
  });

  await page.goto("/login?oauth=complete");
  await expect(page).toHaveURL(/:\/\/[^/]+\/dashboard$/);
});

test("google oauth callback rejects unsafe returnTo and falls back to role destination", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: true,
    role: "administrator",
    user: {
      email: "org.admin@example.test",
      name: "Org Admin",
      sessionId: "session-admin-1",
      userId: "user-admin-1",
    },
  });

  await page.route("**/api/auth/get-session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fulfillJson(route, { session: api.session.session, user: api.session.user });
  });

  await page.goto("/login?oauth=complete&returnTo=https%3A%2F%2Fevil.com");
  await expect(page).toHaveURL(/:\/\/[^/]+\/admin$/);
});

test("already signed in administrator visiting plain /login sees interstitial without forced redirect", async ({
  page,
}) => {
  await installOrganizationApi(page, {
    initiallySignedIn: true,
    role: "administrator",
    user: {
      email: "org.admin@example.test",
      name: "Org Admin",
      sessionId: "session-admin-1",
      userId: "user-admin-1",
    },
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "You are already signed in." })).toBeVisible();
  await expect(page.getByText("Continue as org.admin@example.test.")).toBeVisible();
  const continueButton = page.getByRole("link", { name: "Open admin dashboard" });
  await expect(continueButton).toBeVisible();
  await continueButton.click();
  await expect(page).toHaveURL(/:\/\/[^/]+\/admin$/);
});

test("oauth cancellation or error callback displays mapped message and sanitizes visible URL", async ({
  page,
}) => {
  await installOrganizationApi(page, {
    initiallySignedIn: false,
  });

  await page.goto("/login?error=access_denied");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Google sign-in was canceled.");
  await expect(page).toHaveURL(/:\/\/[^/]+\/login$/);
});
