import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

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
