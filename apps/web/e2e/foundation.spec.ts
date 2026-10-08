import { expect, test } from "@playwright/test";
import { buildPlatformHomeTicketListingsResponse } from "./fixtures/builders";
import { fulfillJson, mockAnonymousSession, mockHealth } from "./support/testWorld";

test("renders the accessible foundation at desktop and mobile widths @webkit-smoke", async ({
  page,
}) => {
  await mockHealth(page);
  await mockAnonymousSession(page);
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/public/platform/tickets", async (route) => {
    await fulfillJson(route, buildPlatformHomeTicketListingsResponse());
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Choir Management");
  await expect(page.getByRole("link", { name: "Upcoming performances" })).toBeVisible();
  await expect(page.getByRole("link", { name: "For community choirs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Member sign in" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Already a member?" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Upcoming performances." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "For community choirs." })).toBeVisible();
  await expect(page.locator('a[href="/join-roster"]')).toHaveCount(0);
  await expect(page.locator('a[href="/player"]')).toHaveCount(0);
  await expect(page.getByLabel("Account").getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("Choir Management");
});

test("renders responsive platform home without horizontal overflow across mobile, tablet, and desktop", async ({
  page,
}) => {
  await mockHealth(page);
  await mockAnonymousSession(page);
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/public/platform/tickets", async (route) => {
    await fulfillJson(route, buildPlatformHomeTicketListingsResponse());
  });

  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Choir Management");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, `No horizontal scroll at ${String(width)}px`).toBeLessThanOrEqual(
      clientWidth,
    );
  }
});
