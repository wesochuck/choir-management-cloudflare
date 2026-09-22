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

test("shows recording coverage and plays inline audio previews in set list builder", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const playingMedia = new WeakSet<HTMLMediaElement>();
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get() {
        return 180;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get(this: HTMLMediaElement) {
        return !playingMedia.has(this);
      },
    });
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      playingMedia.add(this);
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("canplay"));
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      playingMedia.delete(this);
      this.dispatchEvent(new Event("pause"));
    };
  });

  const piece1Id = "11111111-1111-4111-8111-111111111111";
  const piece2Id = "22222222-2222-4222-8222-222222222222";
  const piece3Id = "33333333-3333-4333-8333-333333333333";
  const trackFileId1 = "44444444-4444-4444-8444-444444444444";
  const trackFileId2 = "55555555-5555-4555-8555-555555555555";

  const eventRef = {
    value: {
      advancePriceCents: 0,
      callTime: "",
      dayOfPriceCents: 0,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 10,
      id: eventId,
      isTicketingEnabled: false,
      location: "Main Sanctuary",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: false,
      rsvpDeadlineDate: null,
      rsvpFollowUpLeadHours: null,
      rsvpFollowUpMode: "inherit",
      setList: [
        { id: "item-1", pieceId: piece1Id, title: "Carol of the Bells", type: "song" },
        { id: "item-2", title: "Intermission", type: "intermission" },
        { id: "item-3", pieceId: piece2Id, title: "Silent Night", type: "song" },
        { id: "item-4", pieceId: piece3Id, title: "O Holy Night", type: "song" },
      ],
      setListApproved: true,
      setListDefaultTransitionSeconds: 0,
      startsAt: "2026-07-20T20:00:00.000Z",
      ticketCapacity: null,
      title: "Holiday Concert",
      type: "Performance",
      venueId: null,
      createdAt: "2026-07-20T20:00:00.000Z",
      updatedAt: "2026-07-20T20:00:00.000Z",
    },
  };

  await page.route("**/api/**", async (route) => {
    if (await handleShellRoute(route)) return;
    const url = new URL(route.request().url());
    if (url.pathname === "/api/organization/music") {
      await fulfillJson(route, {
        pieces: [
          {
            arranger: "",
            catalogId: "",
            composer: "Leontovych",
            copies: null,
            createdAt: "2026-07-20T20:00:00.000Z",
            durationSeconds: 180,
            genres: [],
            id: piece1Id,
            lastPerformedAt: null,
            notes: "",
            parentId: null,
            performanceCount: 1,
            purchaseDate: null,
            sectionBuckets: [],
            title: "Carol of the Bells",
            trackFileIds: { tutti: trackFileId1 },
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
          {
            arranger: "",
            catalogId: "",
            composer: "Gruber",
            copies: null,
            createdAt: "2026-07-20T20:00:00.000Z",
            durationSeconds: 180,
            genres: [],
            id: piece2Id,
            lastPerformedAt: null,
            notes: "",
            parentId: null,
            performanceCount: 1,
            purchaseDate: null,
            sectionBuckets: [],
            title: "Silent Night",
            trackFileIds: {},
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
          {
            arranger: "",
            catalogId: "",
            composer: "Adam",
            copies: null,
            createdAt: "2026-07-20T20:00:00.000Z",
            durationSeconds: 240,
            genres: [],
            id: piece3Id,
            lastPerformedAt: null,
            notes: "",
            parentId: null,
            performanceCount: 1,
            purchaseDate: null,
            sectionBuckets: [],
            title: "O Holy Night",
            trackFileIds: { tenor: trackFileId2 },
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
        ],
        requestId,
      });
      return;
    }
    if (url.pathname.startsWith("/api/organization/files/")) {
      await route.fulfill({
        body: Buffer.from("mock-audio"),
        contentType: "audio/mpeg",
        status: 200,
      });
      return;
    }
    if (await handleDataRoute(route, eventRef)) return;
    await fulfillJson(route, { requestId });
  });

  await page.goto("/admin/setlists");
  await expect(page.getByRole("heading", { name: "Set lists" })).toBeVisible();

  // Summary breakdown displays recordings coverage: 2 of 3 with audio (1 missing), custom excluded from count
  await expect(page.locator(".set-list-summary")).toContainText("Recordings 2 of 3 (1 missing)");

  // Row 1 (Carol of the Bells) has Tutti recording
  const item1 = page.locator(".set-list-item").first();
  await expect(item1).toContainText("Carol of the Bells");
  await expect(item1).toContainText("Recording: Tutti");
  const playButton1 = item1.getByRole("button", {
    name: "Play Tutti recording for Carol of the Bells",
  });
  await expect(playButton1).toBeVisible();
  await expect(item1.getByRole("link", { name: "Open practice" })).toBeVisible();

  // Row 2 (Intermission) is a custom entry - no recording status or playback controls
  const item2 = page.locator(".set-list-item").nth(1);
  await expect(item2).toContainText("Custom entry");
  await expect(item2).not.toContainText("Recording");
  await expect(item2).not.toContainText("No recording");
  await expect(item2.getByRole("button", { name: /Play/ })).not.toBeVisible();

  // Row 3 (Silent Night) has no recording
  const item3 = page.locator(".set-list-item").nth(2);
  await expect(item3).toContainText("Silent Night");
  await expect(item3).toContainText("No recording");
  await expect(item3.getByRole("button", { name: /Play/ })).not.toBeVisible();

  // Row 4 (O Holy Night) has Tenor fallback recording
  const item4 = page.locator(".set-list-item").nth(3);
  await expect(item4).toContainText("O Holy Night");
  await expect(item4).toContainText("Recording: Tenor");
  const playButton4 = item4.getByRole("button", {
    name: "Play Tenor recording for O Holy Night",
  });
  await expect(playButton4).toBeVisible();

  // Click Play on row 1 - plays inline without navigating away
  await playButton1.click();
  await expect(
    item1.getByRole("button", { name: "Pause Tutti recording for Carol of the Bells" }),
  ).toBeVisible();
  expect(page.url()).toContain("/admin/setlists");

  // Click Play on row 4 - plays row 4 and stops row 1
  await playButton4.click();
  await expect(
    item4.getByRole("button", { name: "Pause Tenor recording for O Holy Night" }),
  ).toBeVisible();
  await expect(
    item1.getByRole("button", { name: /(Play|Resume) Tutti recording for Carol of the Bells/ }),
  ).toBeVisible();
  await expect(item1.getByRole("button", { name: /Pause Tutti/ })).not.toBeVisible();
});
