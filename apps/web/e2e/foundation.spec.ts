import { expect, test } from "@playwright/test";

test("renders the accessible foundation at desktop and mobile widths", async ({ page }) => {
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
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("choir moving together");
  await expect(page.getByRole("link", { name: "Explore features" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Designed for choral ensembles." })).toBeVisible();
  await expect(page.getByLabel("Account").getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("Choir Management");
});
