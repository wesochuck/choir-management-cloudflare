import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const resourceIds = {
  first: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  second: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  third: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

const session = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-resources",
    ipAddress: "192.0.2.50",
    token: "resources-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-resources-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "resources.admin@example.test",
    emailVerified: true,
    id: "user-resources-admin",
    image: null,
    name: "Resources Admin",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

const resources = [
  {
    createdAt: "2026-07-20T20:00:00.000Z",
    fileId: null,
    id: resourceIds.first,
    sortOrder: 0,
    title: "Welcome guide",
    updatedAt: "2026-07-20T20:00:00.000Z",
    url: "https://example.test/welcome",
  },
  {
    createdAt: "2026-07-20T20:01:00.000Z",
    fileId: null,
    id: resourceIds.second,
    sortOrder: 1,
    title: "Rehearsal handbook",
    updatedAt: "2026-07-20T20:01:00.000Z",
    url: "https://example.test/handbook",
  },
  {
    createdAt: "2026-07-20T20:02:00.000Z",
    fileId: null,
    id: resourceIds.third,
    sortOrder: 2,
    title: "Concert details",
    updatedAt: "2026-07-20T20:02:00.000Z",
    url: "https://example.test/concert",
  },
];

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

test("reorders resources with the accessible drag handle", async ({ page }) => {
  let orderedIds = resources.map(({ id }) => id);
  let orderRequest: readonly string[] | null = null;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/organization/resources" && method === "GET") {
      await fulfillJson(route, {
        requestId,
        resources: orderedIds.map((id) => resources.find((item) => item.id === id)),
      });
      return;
    }
    if (url.pathname === "/api/organization/resources/order" && method === "PUT") {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === "object" && body !== null && "resourceIds" in body) {
        const resourceIdsFromRequest = body.resourceIds;
        if (
          Array.isArray(resourceIdsFromRequest) &&
          resourceIdsFromRequest.every((id) => typeof id === "string")
        ) {
          orderRequest = resourceIdsFromRequest;
          orderedIds = resourceIdsFromRequest;
        }
      }
      await fulfillJson(route, { requestId });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/account/organizations": {
        organizations: [
          {
            canonicalHostname: "resources.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Resources Choir",
            organizationId: "org-resources",
            profileId: null,
            role: "administrator",
            slug: "resources",
          },
        ],
      },
      "/api/account/sessions": [session.session],
      "/api/auth/get-session": session,
      "/api/health": {
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/organization/auth-status": {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "org-resources",
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
      "/api/setup/status": {
        allModulesConfigured: true,
        completedSteps: [],
        currentStep: null,
        launched: true,
        organizationId: "org-resources",
        organizationName: "Resources Choir",
      },
    };
    if (url.pathname === "/api/public/projection") {
      await route.fulfill({ status: 404 });
      return;
    }
    await fulfillJson(route, responses[url.pathname] ?? { requestId });
  });

  await page.goto("/admin/resources");
  await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move up" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move down" })).toHaveCount(0);

  const firstHandle = page.locator(".organization-resource-drag-handle:visible").first();
  await expect(firstHandle).toBeVisible();
  await expect(firstHandle).toHaveAttribute(
    "aria-describedby",
    "organization-resources-reorder-help",
  );
  await firstHandle.focus();
  await page.keyboard.press("Space");
  await expect(firstHandle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");

  const reorderResponse = page.waitForResponse(
    (request) =>
      request.url().endsWith("/api/organization/resources/order") &&
      request.request().method() === "PUT",
  );
  await page.keyboard.press("Space");
  await reorderResponse;

  await expect
    .poll(() => orderRequest)
    .toEqual([resourceIds.second, resourceIds.first, resourceIds.third]);
  await expect(page.getByText("Resources reordered.", { exact: true })).toBeVisible();
  await expect(page.locator(".organization-resource-title:visible").first()).toContainText(
    "Rehearsal handbook",
  );
});
