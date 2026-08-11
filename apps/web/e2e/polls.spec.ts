import { expect, test } from "@playwright/test";

const requestId = "12121212-1212-4121-8121-121212121212";

test("renders and submits a valid signed poll link", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId,
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
  await page.route("**/api/public/poll-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        canSubmit: true,
        description: "Choose one color.",
        expiresAt: "2026-08-14T12:00:00.000Z",
        multipleChoice: false,
        options: [
          { id: "a0000000-0000-4000-8000-000000000001", label: "Blue", sortOrder: 0 },
          { id: "a0000000-0000-4000-8000-000000000002", label: "Green", sortOrder: 1 },
        ],
        pollId: "b0000000-0000-4000-8000-000000000001",
        profileId: "c0000000-0000-4000-8000-000000000001",
        profileName: "Test singer",
        requestId,
        responseOptionIds: [],
        title: "Favorite color?",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/poll-vote", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ requestId }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/poll?token=browser-test-signed-poll-token");
  await expect(page.getByRole("heading", { name: "Favorite color?" })).toBeVisible();
  const submit = page.getByRole("button", { name: "Submit Vote" });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Blue" }).click();
  await expect(submit).toBeEnabled();
  const voteResponse = page.waitForResponse((response) =>
    response.url().includes("/api/public/poll-vote"),
  );
  await submit.click();
  const voteResult = await voteResponse;
  expect(voteResult.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Vote Submitted" })).toBeVisible();
});
