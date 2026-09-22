import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const musicId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const profileId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const session = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-setlist",
    ipAddress: "192.0.2.30",
    token: "setlist-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-setlist-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "setlist.admin@example.test",
    emailVerified: true,
    id: "user-setlist-admin",
    image: null,
    name: "Set-list Admin",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

async function handleShellRoute(route: Route): Promise<boolean> {
  const pathname = new URL(route.request().url()).pathname;
  const responses: Record<string, unknown> = {
    "/api/account/organizations": {
      organizations: [
        {
          canonicalHostname: "setlist.example.test",
          canonicalStatus: "active",
          lifecycleState: "active",
          name: "Set-list Choir",
          organizationId: "org-setlist",
          profileId: null,
          role: "administrator",
          slug: "setlist",
        },
      ],
    },
    "/api/auth/get-session": session,
    "/api/account/sessions": [session.session],
    "/api/health": {
      environment: "local",
      requestId,
      service: "choir-management-cloudflare",
      status: "ok",
      version: "browser-test",
    },
    "/api/organization/module-state": {
      modules: [
        { enabled: true, id: "events" },
        { enabled: true, id: "people" },
        { enabled: true, id: "programs" },
      ],
    },
    "/api/organization/auth-status": {
      mfaRequired: false,
      mfaVerifiedUntil: null,
      organizationId: "org-setlist",
      requestId,
      role: "administrator",
      twoFactorEnabled: false,
      twoFactorVerified: false,
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
      organizationId: "org-setlist",
      organizationName: "Set-list Choir",
    },
  };
  if (pathname === "/api/public/projection") {
    await route.fulfill({ status: 404 });
    return true;
  }
  const body = responses[pathname];
  if (body === undefined) return false;
  await fulfillJson(route, body);
  return true;
}

async function handleDataRoute(
  route: Route,
  eventRef: { value: Record<string, unknown> },
): Promise<boolean> {
  const url = new URL(route.request().url());
  const method = route.request().method();
  if (
    url.pathname === "/api/organization/events" ||
    url.pathname === `/api/organization/events/${eventId}`
  ) {
    if (method === "PUT") {
      const body: unknown = route.request().postDataJSON();
      const updates =
        typeof body === "object" && body !== null ? Object.fromEntries(Object.entries(body)) : {};
      eventRef.value = { ...eventRef.value, ...updates, updatedAt: "2026-07-20T20:30:00.000Z" };
      await fulfillJson(route, eventRef.value);
      return true;
    }
    await fulfillJson(route, { events: [eventRef.value], requestId });
    return true;
  }
  if (url.pathname === "/api/organization/music") {
    await fulfillJson(route, {
      pieces: [
        {
          arranger: "",
          catalogId: "",
          composer: "Composer A",
          copies: null,
          createdAt: "2026-07-20T20:00:00.000Z",
          durationSeconds: 180,
          genres: [],
          id: musicId,
          lastPerformedAt: null,
          notes: "Announce the arranger before this piece.",
          parentId: null,
          performanceCount: 1,
          purchaseDate: null,
          sectionBuckets: [],
          title: "Opening Song",
          trackFileIds: {},
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
      ],
      requestId,
    });
    return true;
  }
  if (url.pathname === "/api/organization/profiles") {
    await fulfillJson(route, {
      profiles: [
        {
          createdAt: "2026-07-20T20:00:00.000Z",
          displayName: "Browser Singer",
          doNotEmail: false,
          globalStatus: "Active",
          id: profileId,
          isSectionLeader: false,
          notes: "",
          phone: "",
          receiveAdminNotifications: true,
          receiveAttendanceReports: true,
          receiveFinancialAlerts: false,
          receiveRsvpDeclineNotices: false,
          showInDirectory: true,
          updatedAt: "2026-07-20T20:00:00.000Z",
          voicePart: "Soprano",
        },
      ],
      requestId,
    });
    return true;
  }
  return false;
}

test("orders, copies, prints, and saves a set list on desktop and mobile", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const eventRef: { value: Record<string, unknown> } = {
    value: {
      advancePriceCents: 0,
      callTime: "18:00",
      dayOfPriceCents: 0,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 120,
      id: eventId,
      isTicketingEnabled: false,
      location: "Main Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: false,
      setList: [
        {
          composer: "Composer A",
          id: "item-a",
          pieceId: musicId,
          title: "Opening Song",
          type: "song",
        },
        { composer: "Composer B", id: "item-b", pieceId: musicId, title: "Finale", type: "song" },
      ],
      setListApproved: false,
      startsAt: "2026-08-20T23:00:00.000Z",
      ticketCapacity: null,
      title: "Browser Performance",
      type: "Performance",
      venueId: null,
      createdAt: "2026-07-20T20:00:00.000Z",
      updatedAt: "2026-07-20T20:00:00.000Z",
    },
  };
  await page.route("**/api/**", async (route) => {
    if (await handleShellRoute(route)) return;
    if (await handleDataRoute(route, eventRef)) return;
    await fulfillJson(route, { requestId });
  });

  await page.goto("/admin/setlists");
  await expect(page.getByRole("heading", { name: "Set lists" })).toBeVisible();
  await expect(page.locator(".set-list-item").first()).toContainText("Opening Song");
  await expect(
    page.getByRole("button", { name: /Move (Opening Song|Finale) (up|down)/ }),
  ).toHaveCount(0);
  const firstReorderHandle = page.locator(".set-list-drag-handle").first();
  await firstReorderHandle.focus();
  await page.keyboard.press("Space");
  await expect(firstReorderHandle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".set-list-item").first()).toContainText("Finale");
  await page.keyboard.press("Space");
  await expect(
    page.getByText("Opening Song dropped at position 2.", { exact: true }),
  ).toBeVisible();
  const movedFirstReorderHandle = page.locator(".set-list-drag-handle").first();
  await movedFirstReorderHandle.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".set-list-item").first()).toContainText("Opening Song");
  await expect(page.locator(".set-list-item").nth(1)).toContainText("Finale");
  await page.getByRole("button", { name: "Print & Copy" }).click();
  await page.getByRole("button", { name: "Copy Plain Text" }).click();
  await expect(page.getByText("Set list copied as text.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByText("Set list saved.", { exact: true })).toBeVisible();

  const darkSurface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-surface"),
  );
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightSurface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-surface"),
  );
  expect(lightSurface).not.toBe(darkSurface);

  await page.setViewportSize({ width: 1100, height: 871 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set lists" })).toBeVisible();
  const setListLayoutAudit = await page.locator(".set-list-section").evaluate((section) => {
    const sectionRight = section.getBoundingClientRect().right;
    return [...section.querySelectorAll("*")]
      .filter((element) => element.getBoundingClientRect().right > sectionRight + 1)
      .map((element) => element.className);
  });
  expect(setListLayoutAudit).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set lists" })).toBeVisible();
  await expect(page.locator(".set-list-drag-handle").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Move (Opening Song|Finale) (up|down)/ }),
  ).toHaveCount(0);
});

test("shows music library notes on the set list only when the announcer toggle is on", async ({
  page,
}) => {
  const eventRef: { value: Record<string, unknown> } = {
    value: {
      advancePriceCents: 0,
      callTime: "",
      dayOfPriceCents: 0,
      details: "",
      doorsOpenTime: "",
      durationMinutes: null,
      id: eventId,
      isTicketingEnabled: false,
      location: "Main Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: false,
      setList: [
        {
          composer: "Composer A",
          id: "item-a",
          pieceId: musicId,
          title: "Opening Song",
          type: "song",
        },
      ],
      setListApproved: false,
      startsAt: "2026-08-20T23:00:00.000Z",
      ticketCapacity: null,
      title: "Browser Performance",
      type: "Performance",
      venueId: null,
      createdAt: "2026-07-20T20:00:00.000Z",
      updatedAt: "2026-07-20T20:00:00.000Z",
    },
  };
  await page.route("**/api/**", async (route) => {
    if (await handleShellRoute(route)) return;
    if (await handleDataRoute(route, eventRef)) return;
    await fulfillJson(route, { requestId });
  });

  await page.goto("/admin/setlists");
  await expect(page.locator(".set-list-item").first()).toContainText("Opening Song");

  // Notes stay hidden until the announcer toggle is enabled.
  await expect(page.locator(".set-list-item-notes")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Show announcer notes/i }).check();
  await expect(page.locator(".set-list-item-notes")).toHaveText(
    "Announce the arranger before this piece.",
  );

  // The printable preview carries the same notes (the hidden print sheet is
  // also mounted, so scope to the dialog).
  await page.getByRole("button", { name: "Print & Copy" }).click();
  const printDialog = page.getByRole("dialog", { name: "Printable Set List" });
  await expect(printDialog.locator(".set-list-preview__note")).toContainText(
    "Announce the arranger before this piece.",
  );
  await printDialog.locator(".dialog__actions").getByRole("button", { name: "Close" }).click();

  await page.getByRole("checkbox", { name: /Show announcer notes/i }).uncheck();
  await expect(page.locator(".set-list-item-notes")).toHaveCount(0);
});

test("updates between-song transition time, reflects in timing breakdown, end time, and copy summary", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const eventRef: { value: Record<string, unknown> } = {
    value: {
      advancePriceCents: 0,
      callTime: "18:00",
      dayOfPriceCents: 0,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 10,
      id: eventId,
      isTicketingEnabled: false,
      location: "Main Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: false,
      setList: [
        {
          composer: "Composer A",
          id: "item-a",
          pieceId: musicId,
          title: "Opening Song",
          type: "song",
        },
        { composer: "Composer B", id: "item-b", pieceId: musicId, title: "Finale", type: "song" },
      ],
      setListApproved: false,
      setListDefaultTransitionSeconds: 0,
      startsAt: "2026-08-20T20:00:00.000Z",
      ticketCapacity: null,
      title: "Browser Performance",
      type: "Performance",
      venueId: null,
      createdAt: "2026-07-20T20:00:00.000Z",
      updatedAt: "2026-07-20T20:00:00.000Z",
    },
  };
  await page.route("**/api/**", async (route) => {
    if (await handleShellRoute(route)) return;
    if (await handleDataRoute(route, eventRef)) return;
    await fulfillJson(route, { requestId });
  });

  await page.goto("/admin/setlists");
  await expect(page.getByRole("heading", { name: "Set lists" })).toBeVisible();

  // Songs duration: 2 pieces of 180s = 360s = 6:00. Transition is 0 so between-song is hidden.
  await expect(page.locator(".set-list-summary")).toContainText("Songs 6:00");
  await expect(page.locator(".set-list-summary")).not.toContainText("Between-song time");
  await expect(page.locator(".set-list-summary")).toContainText("Estimated runtime 6:00");
  await expect(page.locator(".set-list-summary")).toContainText("Scheduled duration 10:00");
  await expect(page.locator(".set-list-summary")).toContainText("Remaining time 4:00");

  // Update default transition time to 45 seconds.
  const transitionInput = page.locator("#set-list-transition-seconds");
  await expect(transitionInput).toHaveValue("0");
  await transitionInput.fill("45");

  // Summary breakdown should now show Between-song time: 1 transition * 45s = 0:45
  // Total estimated runtime: 6:45
  await expect(page.locator(".set-list-summary")).toContainText("Between-song time 0:45");
  await expect(page.locator(".set-list-summary")).toContainText(
    "(1 automatic transition × 45 sec)",
  );
  await expect(page.locator(".set-list-summary")).toContainText("Estimated runtime 6:45");
  await expect(page.locator(".set-list-summary")).toContainText("Remaining time 3:15");

  // Insert a custom entry after Opening Song (between the two songs)
  await page.getByRole("button", { name: "Insert custom entry after 1. Opening Song" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit set-list item" });
  await editDialog.getByRole("button", { name: "Save item" }).click();

  // Now the items are: Opening Song (song), Intermission (custom), Finale (song).
  // No two songs are directly adjacent, so automatic between-song time drops to 0 and hides!
  await expect(page.locator(".set-list-summary")).not.toContainText("Between-song time");

  // Intermission has no duration set, so missing duration warning is displayed.
  await expect(page.locator(".set-list-duration-warning")).toContainText(
    "1 Custom entry has no duration and is not included in the estimated runtime.",
  );

  // Check Print & Copy dialog
  await page.getByRole("button", { name: "Print & Copy" }).click();
  const printDialog = page.getByRole("dialog", { name: "Printable Set List" });
  await expect(printDialog.locator(".set-list-preview__timing")).toContainText(
    "Estimated runtime: 6:00",
  );
  await expect(printDialog.locator(".set-list-preview__timing")).toContainText(
    "Default between-song time: 0:45",
  );
  await printDialog.locator(".dialog__actions").getByRole("button", { name: "Close" }).click();

  // Save now and verify persistence
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByText("Set list saved.", { exact: true })).toBeVisible();
  expect(eventRef.value.setListDefaultTransitionSeconds).toBe(45);
});
