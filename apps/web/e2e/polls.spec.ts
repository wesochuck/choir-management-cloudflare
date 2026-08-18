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

test("admin can view poll results and option tallies on polls dashboard", async ({ page }) => {
  const pollId = "b0000000-0000-4000-8000-000000000001";
  const optionA = "a0000000-0000-4000-8000-000000000001";
  const optionB = "a0000000-0000-4000-8000-000000000002";

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
    await route.fulfill({
      body: JSON.stringify({
        session: {
          activeOrganizationId: "org-1",
          createdAt: "2026-07-20T20:00:00.000Z",
          expiresAt: "2026-07-27T20:00:00.000Z",
          id: "session-admin",
          ipAddress: "192.0.2.50",
          token: "admin-token",
          updatedAt: "2026-07-20T20:00:00.000Z",
          userAgent: "Chromium",
          userId: "user-admin",
        },
        user: {
          createdAt: "2026-07-20T19:00:00.000Z",
          email: "admin@example.test",
          emailVerified: true,
          id: "user-admin",
          name: "Admin User",
          twoFactorEnabled: false,
          updatedAt: "2026-07-20T19:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.route("**/api/organization/access", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activeRole: "admin",
        isPlatformAdmin: false,
        organizationId: "org-1",
        organizationName: "Test Choir",
        requestId,
        roles: ["admin"],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.route("**/api/organization/polls", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        polls: [
          {
            archivedAt: "",
            createdAt: "2026-08-10T12:00:00.000Z",
            expiresAt: "2026-08-20T12:00:00.000Z",
            id: pollId,
            optionTallies: [
              { count: 3, id: optionA, label: "Risers setup" },
              { count: 1, id: optionB, label: "Ticket table" },
            ],
            responseCount: 4,
            title: "Volunteer Roles",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.route(`**/api/organization/polls/${pollId}/results`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        archivedAt: "",
        createdAt: "2026-08-10T12:00:00.000Z",
        description: "Please pick where you can help.",
        expiresAt: "2026-08-20T12:00:00.000Z",
        multipleChoice: true,
        options: [
          {
            count: 3,
            id: optionA,
            label: "Risers setup",
            percentage: 75,
            respondents: [
              {
                profileId: "p-1",
                profileName: "Alice Singer",
                respondedAt: "2026-08-11T14:00:00.000Z",
                voicePart: "Soprano 1",
              },
              {
                profileId: "p-2",
                profileName: "Bob Bassist",
                respondedAt: "2026-08-11T14:30:00.000Z",
                voicePart: "Bass 2",
              },
              {
                profileId: "p-3",
                profileName: "Charlie Tenor",
                respondedAt: "2026-08-11T15:00:00.000Z",
                voicePart: "Tenor 1",
              },
            ],
            sortOrder: 0,
          },
          {
            count: 1,
            id: optionB,
            label: "Ticket table",
            percentage: 25,
            respondents: [
              {
                profileId: "p-4",
                profileName: "Dana Alto",
                respondedAt: "2026-08-11T16:00:00.000Z",
                voicePart: "Alto 1",
              },
            ],
            sortOrder: 1,
          },
        ],
        pollId,
        requestId,
        title: "Volunteer Roles",
        totalResponses: 4,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/polls");
  await expect(page.getByRole("heading", { name: "Polls" })).toBeVisible();
  await expect(page.getByText("Volunteer Roles")).toBeVisible();
  await expect(page.getByText("Risers setup: 3")).toBeVisible();
  await expect(page.getByText("Ticket table: 1")).toBeVisible();

  // Click View results
  await page.getByRole("button", { name: "View results" }).first().click();
  await expect(page.getByRole("heading", { name: "Results: Volunteer Roles" })).toBeVisible();
  await expect(page.getByText("Alice Singer")).toBeVisible();
  await expect(page.getByText("Soprano 1")).toBeVisible();
  await expect(page.getByText("Bob Bassist")).toBeVisible();
  await expect(page.getByText("Bass 2")).toBeVisible();
  await expect(page.getByText("3 votes (75%)")).toBeVisible();
  await expect(page.getByText("1 vote (25%)")).toBeVisible();
});
