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

  const sessionData = {
    session: {
      activeOrganizationId: null,
      createdAt: "2026-07-20T20:00:00.000Z",
      expiresAt: "2026-07-27T20:00:00.000Z",
      id: "session-admin",
      ipAddress: "192.0.2.50",
      token: "admin-token-not-displayed",
      updatedAt: "2026-07-20T20:00:00.000Z",
      userAgent: "Chromium browser",
      userId: "user-polls-admin",
    },
    user: {
      createdAt: "2026-07-20T19:00:00.000Z",
      email: "polls.admin@example.test",
      emailVerified: true,
      id: "user-polls-admin",
      image: null,
      name: "Polls Admin",
      twoFactorEnabled: false,
      updatedAt: "2026-07-20T19:00:00.000Z",
    },
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/organization/polls") {
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
      return;
    }
    if (url.pathname === `/api/organization/polls/${pollId}/results`) {
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
                  profileId: "c0000000-0000-4000-8000-000000000001",
                  profileName: "Alice Singer",
                  respondedAt: "2026-08-11T14:00:00.000Z",
                  voicePart: "Soprano 1",
                },
                {
                  profileId: "c0000000-0000-4000-8000-000000000002",
                  profileName: "Bob Bassist",
                  respondedAt: "2026-08-11T14:30:00.000Z",
                  voicePart: "Bass 2",
                },
                {
                  profileId: "c0000000-0000-4000-8000-000000000003",
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
                  profileId: "c0000000-0000-4000-8000-000000000004",
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
      return;
    }

    const responses: Record<string, unknown> = {
      "/api/account/organizations": {
        organizations: [
          {
            canonicalHostname: "polls.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Polls Choir",
            organizationId: "org-polls",
            profileId: null,
            role: "administrator",
            slug: "polls",
          },
        ],
      },
      "/api/account/sessions": [sessionData.session],
      "/api/auth/get-session": sessionData,
      "/api/health": {
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/organization/access": {
        activeRole: "administrator",
        isPlatformAdmin: false,
        organizationId: "org-polls",
        organizationName: "Polls Choir",
        requestId,
        roles: ["administrator"],
      },
      "/api/organization/auth-status": {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "org-polls",
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
      "/api/organization/module-state": {
        modules: [
          { enabled: true, id: "people" },
          { enabled: true, id: "programs" },
        ],
      },
      "/api/platform/mfa/status": {
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      },
    };

    if (url.pathname in responses) {
      await route.fulfill({
        body: JSON.stringify(responses[url.pathname]),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ requestId }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/polls");
  await expect(page.getByRole("heading", { name: "Polls" })).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "View results for poll Volunteer Roles" })
      .or(page.getByRole("cell", { name: "Volunteer Roles" })),
  ).toBeVisible();
  await expect(page.getByText("Risers setup:").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Ticket table:").filter({ visible: true })).toBeVisible();

  // Click View results
  await page
    .getByRole("button", { name: "View results" })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Results: Volunteer Roles" })).toBeVisible();
  await expect(page.getByText("Alice Singer")).toBeVisible();
  await expect(page.getByText("Soprano 1")).toBeVisible();
  await expect(page.getByText("Bob Bassist")).toBeVisible();
  await expect(page.getByText("Bass 2")).toBeVisible();
  await expect(page.getByText("3 votes (75%)")).toBeVisible();
  await expect(page.getByText("1 vote (25%)")).toBeVisible();
});
