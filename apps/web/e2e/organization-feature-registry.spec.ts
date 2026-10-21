import { moduleIdSchema } from "@choir/contracts";
import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

// Full shell journey: no navigation/reload between the acknowledged save and projections.
test("module save updates desktop/mobile navigation, Overview, search and cached Recents immediately", async ({
  page,
  isMobile,
}) => {
  await installOrganizationApi(page, { modules: moduleIdSchema.options, role: "owner" });
  let enabled = true;
  let gets = 0;
  await page.route("**/api/organization/module-state", async (route) => {
    gets++;
    await fulfillJson(route, {
      modules: moduleIdSchema.options.map((id) => ({
        id,
        enabled: id === "music_library" ? enabled : true,
        label: id === "music_library" ? "Music Library" : id,
        category: "content",
      })),
    });
  });
  await page.route("**/api/setup/progress", async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (
      typeof body === "object" &&
      body !== null &&
      "data" in body &&
      typeof body.data === "object" &&
      body.data !== null &&
      "music_library" in body.data &&
      typeof body.data.music_library === "boolean"
    )
      enabled = body.data.music_library;
    await fulfillJson(route, { saved: true });
  });
  await page.route("**/api/organization/dashboard-summary", async (route) => {
    await fulfillJson(route, {
      activeProfileCount: 88,
      doNotEmailCount: 0,
      nextEvents: [],
      recentBounceCount: 0,
      upcomingEventCount: 8,
      requestId: "11111111-1111-4111-8111-111111111111",
    });
  });
  await page.route("**/api/organization/search?**", async (route) => {
    await fulfillJson(route, {
      results: [
        {
          id: "music-piece-fixture",
          category: "music",
          title: "Cached Music Piece",
          href: "/admin/library?pieceId=fixture",
        },
      ],
      requestId: "11111111-1111-4111-8111-111111111111",
    });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      `choir-admin-search-recents:${window.location.hostname}:organization`,
      JSON.stringify([
        {
          id: "nav-music",
          category: "navigation",
          title: "Old catalog label",
          href: "/admin/library",
          timestamp: 1,
        },
        {
          id: "music-piece-fixture",
          category: "music",
          title: "Cached Music Piece",
          href: "/admin/library?pieceId=fixture",
          timestamp: 1,
        },
      ]),
    );
  });
  await page.goto("/admin/settings/modules");
  const checkbox = page.getByRole("checkbox", { name: "Music Library", exact: true });
  await expect(checkbox).toBeChecked();
  expect(gets).toBe(1);
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect.poll(() => gets).toBe(2);
  if (isMobile) await page.getByRole("button", { name: "Open workspace navigation" }).click();
  const nav = page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true });
  await expect(nav.locator('a[href="/admin/library"]')).toHaveCount(0);
  await expect(nav.locator('a[href="/admin/contacts"]')).toBeVisible();
  await nav.locator('a[href="/admin"]').click();
  await expect(page.locator('.admin-overview__cards a[href="/admin/library"]')).toHaveCount(0);
  await expect(
    page.locator(".admin-overview__quick-actions").getByRole("link", { name: "Add Music" }),
  ).toHaveCount(0);
  await page.locator(".admin-overview__search-trigger button").click();
  await expect(
    page
      .getByRole("dialog", { name: "Command Palette" })
      .getByText("Cached Music Piece", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog", { name: "Command Palette" })
      .getByText("Music Library", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("combobox").fill("music");
  await expect(
    page
      .getByRole("dialog", { name: "Command Palette" })
      .getByText("Cached Music Piece", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("combobox").fill("contacts");
  await expect(
    page.getByRole("dialog", { name: "Command Palette" }).getByText("Contacts", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  if (isMobile) await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .filter({ visible: true })
    .getByRole("link", { name: "Modules", exact: true })
    .click();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect.poll(() => gets).toBe(3);
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(
    page
      .getByRole("dialog", { name: "Command Palette" })
      .getByText("Music Library", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Command Palette" })
      .getByText("Cached Music Piece", { exact: true }),
  ).toBeVisible();
});

test("palette roster configuration shortcut selects the existing Settings tab", async ({
  page,
}) => {
  await installOrganizationApi(page, { modules: moduleIdSchema.options, role: "owner" });
  await page.goto("/admin/settings/modules");
  await expect(page.getByRole("heading", { name: "Organization Modules" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page
    .getByRole("dialog", { name: "Command Palette" })
    .getByRole("combobox")
    .fill("settings: roster");
  await page
    .getByRole("dialog", { name: "Command Palette" })
    .getByText("Roster Automation & Parts Config", { exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/roster\?section=settings$/);
  await expect(page.getByRole("tab", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
