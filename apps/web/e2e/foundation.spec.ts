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
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("choir moving together");
  await expect(page.getByRole("link", { name: "Explore the foundation" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Built around each Organization." }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Staging ready");
});
