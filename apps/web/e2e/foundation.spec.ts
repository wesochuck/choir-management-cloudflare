import { expect, test } from "@playwright/test";
import { mockAnonymousSession, mockHealth } from "./support/testWorld";

test("renders the accessible foundation at desktop and mobile widths", async ({ page }) => {
  await mockHealth(page);
  await mockAnonymousSession(page);
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
