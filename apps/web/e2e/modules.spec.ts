import { setupProgressRequestSchema } from "@choir/contracts";
import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const session = {
  session: {
    activeOrganizationId: organizationId,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-modules-admin",
    ipAddress: "192.0.2.40",
    token: "modules-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-modules-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "modules.admin@example.test",
    emailVerified: true,
    id: "user-modules-admin",
    image: null,
    name: "Modules Administrator",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

test("renders categorized granular modules and allows toggling individual features", async ({
  page,
}) => {
  let moduleState = [
    {
      category: "people",
      description: "Manage member roster, section assignments, statuses, and contact details.",
      enabled: true,
      id: "roster",
      label: "Roster & Members",
    },
    {
      category: "content",
      description: "Music catalog, titles, movements, audio tracks, and folder assignments.",
      enabled: true,
      id: "music_library",
      label: "Music Library",
    },
    {
      category: "content",
      description: "Concert set lists, performance order, and linked repertoire.",
      enabled: true,
      id: "setlists",
      label: "Set Lists",
    },
  ];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;

    if (pathname === "/api/auth/get-session") {
      await fulfillJson(route, session);
      return;
    }
    if (pathname === "/api/health") {
      await fulfillJson(route, {
        baseHostname: "127.0.0.1",
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      });
      return;
    }
    if (pathname === "/api/organization/auth-status") {
      await fulfillJson(route, {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId,
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      });
      return;
    }
    if (pathname === "/api/organization/module-state") {
      await fulfillJson(route, { modules: moduleState });
      return;
    }
    if (pathname === "/api/setup/status") {
      await fulfillJson(route, {
        allModulesConfigured: true,
        completedSteps: ["organization_info", "modules"],
        currentStep: null,
        launched: true,
        organizationId,
        organizationName: "Granular Modules Choir",
      });
      return;
    }
    if (pathname === "/api/organization/roster-configuration") {
      await fulfillJson(route, {
        allowMemberSelfService: true,
        performerLabel: "Singer",
        requestId,
      });
      return;
    }
    if (pathname === "/api/setup/progress" && route.request().method() === "POST") {
      const parsed = setupProgressRequestSchema.safeParse(route.request().postDataJSON());
      if (parsed.success && parsed.data.data && typeof parsed.data.data.setlists === "boolean") {
        const setlistsEnabled = parsed.data.data.setlists;
        moduleState = moduleState.map((m) =>
          m.id === "setlists" ? { ...m, enabled: setlistsEnabled } : m,
        );
      }
      await fulfillJson(route, { saved: true });
      return;
    }
    await fulfillJson(route, { ok: true });
  });

  await page.goto("/admin/settings/modules");

  const panel = page.locator("section[aria-label='Module settings']");
  await expect(panel.getByRole("heading", { name: "Organization Modules" })).toBeVisible();
  await expect(panel.getByText("Music & Content", { exact: true })).toBeVisible();
  await expect(panel.getByText("Music Library", { exact: true })).toBeVisible();
  await expect(panel.getByText("Set Lists", { exact: true })).toBeVisible();
  const categoryGroups = panel.locator("fieldset.module-settings-group");
  await expect(categoryGroups).toHaveCount(2);
  for (const name of ["People", "Music & Content"]) {
    const group = panel.getByRole("group", { name });
    await expect(group).toHaveClass(/module-settings-group/);
    await expect(group.locator("legend")).toHaveText(name);
  }

  // Initially both Music library and Set lists should be visible in navigation (on desktop)
  if (test.info().project.name === "chromium") {
    await expect(page.getByRole("link", { name: "Music library" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Set lists" })).toBeVisible();
  }

  // Toggle off "Set Lists"
  const setlistsCheckbox = panel.getByRole("checkbox", { name: /Set Lists/i });
  await expect(setlistsCheckbox).toBeChecked();
  await setlistsCheckbox.click();

  // Verify feedback message
  await expect(panel.getByText("Set Lists disabled.")).toBeVisible();
  await expect(setlistsCheckbox).not.toBeChecked();

  // Music library should remain enabled
  const libraryCheckbox = panel.getByRole("checkbox", { name: /Music Library/i });
  await expect(libraryCheckbox).toBeChecked();
});
