import { expect, test } from "@playwright/test";
import { mockAnonymousSession, mockHealth } from "./support/testWorld";

test("renders the accessible foundation at desktop and mobile widths @webkit-smoke", async ({
  page,
}) => {
  await mockHealth(page);
  await mockAnonymousSession(page);
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/public/platform/tickets", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ listings: [], requestId: "00000000-0000-4000-8000-000000000000" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "platform for community choirs",
  );
  await expect(page.getByRole("link", { name: "How member access works" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Accessing your choir’s workspace." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upcoming concerts & tickets." })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fairfield County nonprofit inquiries." }),
  ).toBeVisible();
  await expect(page.getByLabel("Account").getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("Choir Management");
});
