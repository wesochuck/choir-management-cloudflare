import type { OrganizationEvent, OrganizationMusicPiece } from "@choir/contracts";
import {
  musicTrackImportMatchRequestSchema,
  organizationEventRequestSchema,
  organizationMusicGenreBatchAddRequestSchema,
  organizationMusicGenreDeleteRequestSchema,
  organizationMusicGenreRenameRequestSchema,
  organizationMusicLibrarySettingsRequestSchema,
  organizationMusicPieceRequestSchema,
} from "@choir/contracts";
import { expect, test, type Page, type Route } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const requestId = "90909090-9090-4090-8090-909090909090";

function piece(id: string, title: string, composer: string, arranger: string) {
  return {
    arranger,
    catalogId: "",
    composer,
    copies: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    durationSeconds: null,
    genres: [],
    id,
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 0,
    purchaseDate: null,
    scoreFileIds: {},
    sectionBuckets: [],
    title,
    trackFileIds: {},
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

async function fulfill(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

function isCreditRenameRequest(
  value: unknown,
): value is { readonly currentName: string; readonly newName: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "currentName" in value &&
    "newName" in value &&
    typeof value.currentName === "string" &&
    typeof value.newName === "string"
  );
}

const mockVenue = {
  address: "1 Concert Way",
  createdAt: "2026-08-17T00:00:00.000Z",
  id: "77777777-7777-4777-8777-777777777777",
  name: "Main Hall",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

function mockEvent(
  id: string,
  title: string,
  startsAt: string,
  setList: OrganizationEvent["setList"] = [],
  venueId: string | null = mockVenue.id,
): OrganizationEvent {
  return {
    advancePriceCents: 0,
    callTime: "",
    createdAt: "2026-08-17T00:00:00.000Z",
    dayOfPriceCents: 0,
    details: "",
    doorsOpenTime: "",
    durationMinutes: null,
    id,
    isCanceled: false,
    isTicketingEnabled: false,
    location: "",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpDeadlineAt: "2027-06-01T23:59:59.000Z",
    rsvpDeadlineDate: "2027-06-01",
    rsvpDeadlinePassed: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    rsvpSelfServiceOpen: false,
    setList,
    setListApproved: false,
    setListDefaultTransitionSeconds: 0,
    startsAt,
    ticketCapacity: null,
    title,
    type: "Performance",
    updatedAt: "2026-08-17T00:00:00.000Z",
    venueId,
  };
}

async function handleMusicDynamicRoute(
  route: Route,
  url: URL,
  pieces: readonly OrganizationMusicPiece[],
  setPieces: (pieces: readonly OrganizationMusicPiece[]) => void,
): Promise<boolean> {
  if (url.pathname === "/api/organization/music/credits/rename") {
    const body: unknown = route.request().postDataJSON();
    if (!isCreditRenameRequest(body)) {
      await fulfill(route, { code: "validation_failed", requestId }, 400);
      return true;
    }
    expect(body).toEqual({ currentName: "Jane Doe", newName: "Jane Q. Doe" });
    const nextPieces = pieces.map((item) => ({
      ...item,
      arranger: item.arranger === body.currentName ? body.newName : item.arranger,
      composer: item.composer === body.currentName ? body.newName : item.composer,
    }));
    setPieces(nextPieces);
    await fulfill(route, { pieces: nextPieces, requestId });
    return true;
  }
  if (url.pathname.startsWith("/api/organization/music/") && route.request().method() === "PUT") {
    const id = url.pathname.split("/").pop() ?? "";
    const parsed = organizationMusicPieceRequestSchema.safeParse(route.request().postDataJSON());
    if (parsed.success) {
      const nextPieces = pieces.map((p) => {
        if (p.id !== id) return p;
        return {
          ...p,
          ...parsed.data,
          updatedAt: "2026-08-17T00:00:00.000Z",
        };
      });
      setPieces(nextPieces);
      const updated = nextPieces.find((p) => p.id === id);
      if (updated) {
        await fulfill(route, { ...updated, requestId });
        return true;
      }
    }
  }
  return false;
}

async function handleEventDynamicRoute(
  route: Route,
  url: URL,
  events: readonly OrganizationEvent[],
  setEvents: (events: readonly OrganizationEvent[]) => void,
): Promise<boolean> {
  if (url.pathname === "/api/organization/events" && route.request().method() === "POST") {
    const parsed = organizationEventRequestSchema.safeParse(route.request().postDataJSON());
    if (parsed.success) {
      const newEvent = mockEvent(
        crypto.randomUUID(),
        parsed.data.title,
        parsed.data.startsAt,
        parsed.data.setList,
        parsed.data.venueId,
      );
      setEvents([...events, newEvent]);
      await fulfill(route, newEvent);
      return true;
    }
  }
  if (url.pathname.startsWith("/api/organization/events/") && route.request().method() === "PUT") {
    const id = url.pathname.split("/").pop() ?? "";
    const parsed = organizationEventRequestSchema.safeParse(route.request().postDataJSON());
    if (parsed.success) {
      const nextEvents = events.map((e): OrganizationEvent => {
        if (e.id !== id) return e;
        return {
          ...e,
          ...parsed.data,
          updatedAt: "2026-08-17T00:00:00.000Z",
        };
      });
      setEvents(nextEvents);
      const updated = nextEvents.find((e) => e.id === id);
      if (updated) {
        await fulfill(route, updated);
        return true;
      }
    }
  }
  return false;
}

async function installRoutes(
  page: Page,
  initialPieces?: readonly OrganizationMusicPiece[],
): Promise<void> {
  let pieces: readonly OrganizationMusicPiece[] = initialPieces ?? [
    piece("11111111-1111-4111-8111-111111111111", "First Work", "Jane Doe", "J. Smith"),
    piece("22222222-2222-4222-8222-222222222222", "Second Work", "Jane Doe", "Jane Doe"),
  ];
  let events: readonly OrganizationEvent[] = [
    mockEvent(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "Spring Gala 2026",
      "2026-09-15T19:00:00.000Z",
    ),
  ];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      await handleMusicDynamicRoute(route, url, pieces, (next) => {
        pieces = next;
      })
    ) {
      return;
    }
    if (
      await handleEventDynamicRoute(route, url, events, (next) => {
        events = next;
      })
    ) {
      return;
    }
    if (url.pathname.startsWith("/api/organization/files/") && route.request().method() === "PUT") {
      const fileId = url.pathname.split("/").pop() ?? "11111111-1111-4111-8111-111111111111";
      await fulfill(route, {
        contentType: "audio/mpeg",
        fileName: "mock-audio.mp3",
        id: fileId,
        requestId,
        sizeBytes: 1024,
        uploadedAt: "2026-08-17T00:00:00.000Z",
      });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/account/organizations": {
        organizations: [
          {
            canonicalHostname: "music.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Music Test Choir",
            organizationId: "music-test-organization",
            profileId: null,
            role: "administrator",
            slug: "music-test",
          },
        ],
      },
      "/api/auth/get-session": {
        session: {
          activeOrganizationId: "music-test-organization",
          createdAt: "2026-08-17T00:00:00.000Z",
          expiresAt: "2027-08-17T00:00:00.000Z",
          id: "music-test-session",
          ipAddress: "192.0.2.1",
          token: "browser-test-token",
          updatedAt: "2026-08-17T00:00:00.000Z",
          userAgent: "Playwright",
          userId: "music-test-user",
        },
        user: {
          createdAt: "2026-08-17T00:00:00.000Z",
          email: "music.test@example.test",
          emailVerified: true,
          id: "music-test-user",
          image: null,
          name: "Music Test Administrator",
          twoFactorEnabled: false,
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
      },
      "/api/health": {
        baseHostname: "127.0.0.1",
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/organization/auth-status": {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "music-test-organization",
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
      "/api/organization/calendar-settings": { requestId, timezone: "America/New_York" },
      "/api/organization/events": { events, requestId },
      "/api/organization/module-state": {
        modules: [
          { enabled: true, id: "events" },
          { enabled: true, id: "music_library" },
          { enabled: true, id: "roster" },
          { enabled: true, id: "setlists" },
        ],
      },
      "/api/organization/music": { pieces, requestId },
      "/api/organization/music-library-settings": {
        practicePlayerLinkLifetimeDays: 180,
        publisherSearchTemplate: "",
        requestId,
      },
      "/api/organization/roster-configuration": {
        attendanceReportWarningThreshold: 3,
        onBreakTimeoutDays: 90,
        onBreakTimeoutEnabled: false,
        performerLabel: "Performer",
        requestId,
        rsvpExpiryEnabled: false,
        rsvpFollowUpEnabled: false,
        rsvpFollowUpLeadHours: 48,
        sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
        statusAutomationEnabled: false,
        statusAutomationMissThreshold: 3,
        statusAutomationRecoveryEnabled: true,
        voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
      },
      "/api/organization/venues": { requestId, venues: [mockVenue] },
      "/api/platform/mfa/status": {
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      },
      "/api/public/projection": { code: "not_found", requestId },
      "/api/setup/status": {
        allModulesConfigured: true,
        completedSteps: [],
        currentStep: null,
        launched: true,
        organizationId: "music-test-organization",
        organizationName: "Music Test Choir",
      },
    };
    await fulfill(
      route,
      responses[url.pathname] ?? { code: "not_found", message: "Not found", requestId },
      url.pathname === "/api/public/projection" ? 404 : responses[url.pathname] ? 200 : 404,
    );
  });
}

test("renames a composer credit from the bookmarkable directory and updates the catalog", async ({
  page,
}) => {
  await installRoutes(page);
  await page.goto("/admin/library?view=credits");

  await expect(page.getByRole("link", { name: "Composers & arrangers" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const mobile = page.viewportSize()?.width ?? 1_280;
  const creditRow =
    mobile < 600
      ? page.locator(".data-table-card:visible").filter({ hasText: "Jane Doe" })
      : page.locator("tbody tr:visible").filter({ hasText: "Jane Doe" });
  await expect(creditRow).toBeVisible();
  await expect(creditRow.getByText("2", { exact: true }).first()).toBeVisible();
  await creditRow.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New credit name").fill("   ");
  await expect(page.getByRole("button", { name: "Rename credit" })).toBeDisabled();
  await page.getByLabel("New credit name").fill("Jane Q. Doe");
  await expect(page.getByRole("button", { name: "Rename credit" })).toBeEnabled();
  await page.getByRole("button", { name: "Rename credit" }).click();
  await expect(
    page.getByText(/Renamed Jane Doe to Jane Q\. Doe across 2 distinct music pieces/),
  ).toBeVisible();
  await expect(
    mobile < 600
      ? page.locator(".data-table-card:visible").filter({ hasText: "Jane Q. Doe" })
      : page.locator("tbody tr:visible").filter({ hasText: "Jane Q. Doe" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Music Catalog" }).click();
  await expect(
    mobile < 600
      ? page.locator(".data-table-card:visible").filter({ hasText: "Jane Q. Doe / arr. J. Smith" })
      : page.locator("tbody tr:visible").filter({ hasText: "Jane Q. Doe / arr. J. Smith" }),
  ).toBeVisible();
});

test("multi-selects pieces in music catalog and adds them to existing and new concert set lists", async ({
  page,
}) => {
  await installRoutes(page);
  await page.goto("/admin/library");

  // Select both music pieces
  const selectFirst = page.getByRole("checkbox", { name: "Select First Work" });
  const selectSecond = page.getByRole("checkbox", { name: "Select Second Work" });
  await selectFirst.click();
  await selectSecond.click();

  // Verify toolbar buttons show count
  const addToSetListBtn = page.getByRole("button", { name: "Add to set list (2)" });
  await expect(addToSetListBtn).toBeVisible();
  await addToSetListBtn.click();

  // Dialog opens
  await expect(page.getByRole("heading", { name: "Add to set list" })).toBeVisible();
  await expect(page.getByText("First Work, Second Work")).toBeVisible();

  // 1. Test adding to existing concert
  await page.getByRole("button", { name: "Add to set list", exact: true }).click();
  await expect(page.getByText('Added 2 piece(s) to "Spring Gala 2026".')).toBeVisible();
  const springGalaLink = page.getByRole("link", { name: "Spring Gala 2026" });
  await expect(springGalaLink).toBeVisible();
  await expect(springGalaLink).toHaveAttribute("href", /\/admin\/setlists\?eventId=/);

  // 2. Select pieces again and create a new concert set list
  await selectFirst.click();
  await selectSecond.click();
  await page.getByRole("button", { name: "Add to set list (2)" }).click();

  await page.getByLabel("Create new concert").click();
  await page.getByLabel("Concert / Performance title").fill("Winter Concert 2026");
  await page.getByLabel("Date and time").fill("2026-12-10T19:30");
  await page.getByLabel("Venue *").selectOption(mockVenue.id);
  await page.getByRole("button", { name: "Create concert & add set list" }).click();

  await expect(
    page.getByText('Created "Winter Concert 2026" and added 2 piece(s) to its set list.'),
  ).toBeVisible();
  const winterConcertLink = page.getByRole("link", { name: "Winter Concert 2026" });
  await expect(winterConcertLink).toBeVisible();
  await expect(winterConcertLink).toHaveAttribute("href", /\/admin\/setlists\?eventId=/);
});

test("manages genre labels from library settings and aligns the practice save control", async ({
  page,
}) => {
  let genres = ["Christmas"];
  let pieces = [
    {
      ...piece("11111111-1111-4111-8111-111111111111", "First Work", "Jane Doe", "J. Smith"),
      genres: ["Christmas"],
    },
  ];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/api/organization/music-library-settings" &&
      route.request().method() === "PUT"
    ) {
      const parsed = organizationMusicLibrarySettingsRequestSchema.safeParse(
        route.request().postDataJSON(),
      );
      if (parsed.success) {
        genres = parsed.data.genres;
        await fulfill(route, { ...parsed.data, requestId });
        return;
      }
      await fulfill(route, { code: "validation_failed", requestId }, 400);
      return;
    }
    if (url.pathname === "/api/organization/music/genres/batch-add") {
      const parsedBatch = organizationMusicGenreBatchAddRequestSchema.safeParse(
        route.request().postDataJSON(),
      );
      if (!parsedBatch.success) {
        await fulfill(route, { code: "validation_failed", requestId }, 400);
        return;
      }
      for (const label of parsedBatch.data.labels) {
        if (!genres.includes(label)) {
          genres.push(label);
        }
      }
      genres.sort((a, b) => a.localeCompare(b));
      await fulfill(route, {
        pieces,
        requestId,
        settings: { genres, practicePlayerLinkLifetimeDays: 180, publisherSearchTemplate: "" },
      });
      return;
    }
    if (url.pathname === "/api/organization/music/genres/rename") {
      const parsed = organizationMusicGenreRenameRequestSchema.safeParse(
        route.request().postDataJSON(),
      );
      if (!parsed.success) {
        await fulfill(route, { code: "validation_failed", requestId }, 400);
        return;
      }
      genres = genres.map((label) =>
        label === parsed.data.currentLabel ? parsed.data.newLabel : label,
      );
      pieces = pieces.map((item) => ({
        ...item,
        genres: item.genres.map((label) =>
          label === parsed.data.currentLabel ? parsed.data.newLabel : label,
        ),
      }));
      await fulfill(route, {
        pieces,
        requestId,
        settings: { genres, practicePlayerLinkLifetimeDays: 180, publisherSearchTemplate: "" },
      });
      return;
    }
    if (url.pathname === "/api/organization/music/genres/delete") {
      const parsedDelete = organizationMusicGenreDeleteRequestSchema.safeParse(
        route.request().postDataJSON(),
      );
      if (!parsedDelete.success) {
        await fulfill(route, { code: "validation_failed", requestId }, 400);
        return;
      }
      genres = genres.filter((label) => label !== parsedDelete.data.label);
      pieces = pieces.map((item) => ({
        ...item,
        genres: item.genres.filter((label) => label !== parsedDelete.data.label),
      }));
      await fulfill(route, {
        pieces,
        requestId,
        settings: { genres, practicePlayerLinkLifetimeDays: 180, publisherSearchTemplate: "" },
      });
      return;
    }
    if (url.pathname === "/api/organization/music") {
      await fulfill(route, { pieces, requestId });
      return;
    }
    if (url.pathname === "/api/organization/music-library-settings") {
      await fulfill(route, {
        genres,
        practicePlayerLinkLifetimeDays: 180,
        publisherSearchTemplate: "",
        requestId,
      });
      return;
    }
    await fulfill(route, { code: "not_found", message: "Not found", requestId }, 404);
  });
  await page.route("**/api/account/organizations", async (route) => {
    await fulfill(route, {
      organizations: [
        {
          canonicalHostname: "music.example.test",
          canonicalStatus: "active",
          lifecycleState: "active",
          name: "Music Test Choir",
          organizationId: "music-test-organization",
          profileId: null,
          role: "administrator",
          slug: "music-test",
        },
      ],
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await fulfill(route, {
      session: {
        activeOrganizationId: "music-test-organization",
        createdAt: "2026-08-17T00:00:00.000Z",
        expiresAt: "2027-08-17T00:00:00.000Z",
        id: "music-test-session",
        ipAddress: "192.0.2.1",
        token: "browser-test-token",
        updatedAt: "2026-08-17T00:00:00.000Z",
        userAgent: "Playwright",
        userId: "music-test-user",
      },
      user: {
        createdAt: "2026-08-17T00:00:00.000Z",
        email: "music.test@example.test",
        emailVerified: true,
        id: "music-test-user",
        image: null,
        name: "Music Test Administrator",
        twoFactorEnabled: false,
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
    });
  });
  await page.route("**/api/health", async (route) => {
    await fulfill(route, {
      baseHostname: "127.0.0.1",
      environment: "local",
      requestId,
      service: "choir-management-cloudflare",
      status: "ok",
      version: "browser-test",
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await fulfill(route, {
      mfaRequired: false,
      mfaVerifiedUntil: null,
      organizationId: "music-test-organization",
      requestId,
      role: "administrator",
      twoFactorEnabled: false,
      twoFactorVerified: false,
    });
  });
  await page.route("**/api/organization/module-state", async (route) => {
    await fulfill(route, {
      modules: [
        { enabled: true, id: "events" },
        { enabled: true, id: "music_library" },
        { enabled: true, id: "roster" },
        { enabled: true, id: "setlists" },
      ],
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await fulfill(route, {
      activePlatformAdministrator: false,
      enrollmentComplete: false,
      requestId,
      twoFactorEnabled: false,
    });
  });
  await page.route("**/api/public/projection", async (route) => {
    await fulfill(route, { code: "not_found", requestId }, 404);
  });

  await page.goto("/admin/library/settings");

  const lifetimeInput = page.getByLabel("Link lifetime (days)");
  const practiceSave = page.getByRole("button", { name: "Save practice settings" });
  const inputBox = await lifetimeInput.boundingBox();
  const buttonBox = await practiceSave.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  if (!inputBox || !buttonBox) {
    throw new Error("Practice controls should have visible geometry");
  }
  // Below 40rem the form stacks, so bottom-edge alignment is a desktop assertion.
  if ((page.viewportSize()?.width ?? 0) > 640) {
    expect(
      Math.abs(inputBox.y + inputBox.height - (buttonBox.y + buttonBox.height)),
    ).toBeLessThanOrEqual(1);
  }

  const genreInput = page.getByLabel("Add genre labels");
  const genreButton = page.getByRole("button", { name: "Add to list" });
  await expect(genreInput).toBeVisible();
  await expect(genreButton).toBeVisible();
  // Below 40rem the help text can wrap, so center alignment is a desktop
  // assertion; the button must share the input's vertical midline.
  if ((page.viewportSize()?.width ?? 0) > 640) {
    const genreInputBox = await genreInput.boundingBox();
    const genreButtonBox = await genreButton.boundingBox();
    if (!genreInputBox || !genreButtonBox) {
      throw new Error("Genre controls should have visible geometry");
    }
    const inputCenter = genreInputBox.y + genreInputBox.height / 2;
    const buttonCenter = genreButtonBox.y + genreButtonBox.height / 2;
    expect(Math.abs(inputCenter - buttonCenter)).toBeLessThanOrEqual(3);
  }
  const visibleGenreManager = page.locator(".data-table:visible, .data-table-cards:visible");
  const genreRow = (name: string) =>
    visibleGenreManager.locator("tbody tr, .data-table-card").filter({ hasText: name });

  await expect(genreRow("Christmas")).toBeVisible();

  await genreInput.fill("Folk");
  await genreButton.click();
  await expect(genreRow("Folk")).toBeVisible();
  await expect(genreRow("Folk").getByText("Pending")).toBeVisible();
  await page.getByRole("button", { name: "Save 1 new genre" }).click();
  await expect(page.getByText("1 new genre added.")).toBeVisible();
  await expect(genreRow("Folk")).toBeVisible();

  await visibleGenreManager.getByRole("button", { name: "Rename Christmas genre" }).click();
  await visibleGenreManager.getByLabel("Rename Christmas genre").fill("Holiday");
  await visibleGenreManager.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Genre renamed.")).toBeVisible();
  await expect(genreRow("Holiday")).toBeVisible();
  await expect(genreRow("Christmas")).toHaveCount(0);

  await visibleGenreManager.getByRole("button", { name: "Delete Holiday genre" }).click();
  const removeDialog = page.getByRole("dialog", { name: "Remove Holiday?" });
  await expect(removeDialog).toBeVisible();
  await removeDialog.getByRole("button", { name: "Remove genre" }).click();
  await expect(page.getByText("Genre removed.")).toBeVisible();
  await expect(genreRow("Holiday")).toHaveCount(0);
});

test("keeps the piece editor action buttons on a single row", async ({ page }) => {
  await installRoutes(page);
  await page.goto("/admin/library");

  await page.getByRole("button", { name: "Edit music piece: First Work" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit music piece" });
  await expect(dialog).toBeVisible();
  const actionButtons = dialog.locator(".music-piece-form__actions > .button");
  await expect(dialog.locator(".music-piece-form__actions > button")).toHaveCount(5);
  await expect(actionButtons).toHaveCount(4);
  await expect(dialog.getByRole("button", { name: "Delete music piece" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add to set list" })).toBeVisible();
  // Below 40rem the action row wraps, which is the intended narrow-screen
  // behavior; a single shared baseline is a desktop assertion.
  if ((page.viewportSize()?.width ?? 0) > 640) {
    const tops = await actionButtons.evaluateAll((buttons) => [
      ...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))),
    ]);
    expect(tops).toHaveLength(1);
  }
});

test("displays the piece title when editing and on practice tracks tab", async ({ page }) => {
  await installRoutes(page);
  await page.goto("/admin/library");

  await page.getByRole("button", { name: "Edit music piece: First Work" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit music piece: First Work" });
  await expect(dialog).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) <= 767) {
    await dialog.getByRole("combobox", { name: "Music section" }).selectOption("tracks");
  } else {
    await dialog.getByRole("tab", { name: /Practice tracks/ }).click();
  }
  await expect(dialog.getByRole("group", { name: "Learning tracks: First Work" })).toBeVisible();
  await expect(
    dialog.getByText("Attach a full mix, section, or part track for “First Work”"),
  ).toBeVisible();
});

test("allows uploading a Tutti practice track directly from the catalog table row", async ({
  page,
}) => {
  await installRoutes(page);
  await page.goto("/admin/library");

  const fileInput = page.getByLabel("Upload Tutti practice track for First Work").first();
  await expect(fileInput).toBeAttached();

  await fileInput.setInputFiles({
    buffer: Buffer.from("fake-audio-content"),
    mimeType: "audio/mpeg",
    name: "tutti-track.mp3",
  });

  await expect(
    page.getByRole("button", { name: "Play tutti learning track for First Work" }).first(),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`reviews bulk tracks with clear song headings and honest matching in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await installRoutes(page);
    await page.addInitScript((value) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, value);
    }, theme);
    await page.goto("/admin/library");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Bulk upload practice tracks", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Bulk upload practice tracks" });
    await dialog.locator('input[type="file"]').setInputFiles([
      { buffer: Buffer.from("invalid-audio"), mimeType: "audio/mpeg", name: "Applause.mp3" },
      {
        buffer: Buffer.from("invalid-audio"),
        mimeType: "audio/mpeg",
        name: "First Work Tutti.mp3",
      },
    ]);
    await expect(dialog.getByText("Applause.mp3")).toBeVisible();
    await dialog.getByRole("button", { name: "Review groups" }).click();
    const queue = dialog.getByRole("complementary", { name: "Song group queue" });
    const applauseQueueItem = queue.getByRole("button", { name: /Applause/ });
    const firstWorkQueueItem = queue.getByRole("button", { name: /First Work/ });
    await expect(applauseQueueItem).toBeVisible();
    await expect(firstWorkQueueItem).toContainText("Ready to review");

    const applauseGroup = dialog.getByRole("region", { name: "Applause" });
    await expect(applauseGroup.getByRole("heading", { name: "Applause", level: 2 })).toBeVisible();
    await expect(
      applauseGroup.getByRole("heading", { name: "No destination piece selected" }),
    ).toBeVisible();
    await expect(applauseGroup.getByText("Part needed")).toBeVisible();

    await firstWorkQueueItem.click();
    const firstWorkGroup = dialog.getByRole("region", { name: "First Work" });
    await expect(
      firstWorkGroup.getByRole("heading", { name: "First Work", level: 2 }),
    ).toBeVisible();
    await expect(
      firstWorkGroup.getByRole("heading", { name: "First Work", level: 3 }),
    ).toBeVisible();
    await expect(
      firstWorkGroup.getByRole("combobox", {
        name: "Section or voice part for First Work Tutti.mp3",
      }),
    ).toHaveValue("tutti");
    const trackAssignment = firstWorkGroup.getByRole("combobox", {
      name: "Section or voice part for First Work Tutti.mp3",
    });
    await expect(
      trackAssignment.getByRole("option", { name: "Sopranos (S) — section" }),
    ).toHaveCount(1);
    await trackAssignment.selectOption("S");
    await expect(trackAssignment).toHaveValue("S");
    await expect(dialog.getByRole("button", { name: "Mark reviewed & next" })).toBeEnabled();
    await expect(firstWorkQueueItem).toContainText("Ready to review");
    await expect(dialog.getByText("Strong suggestion", { exact: true })).toHaveCount(0);

    await applauseQueueItem.click();
    const destination = applauseGroup.getByRole("button", {
      name: "Search library to change piece",
    });
    await destination.focus();
    await expect(destination).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(applauseGroup.getByRole("button", { name: "Play Applause.mp3" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(applauseGroup.getByLabel("Section or voice part for Applause.mp3")).toBeFocused();
    await dialog.locator(".track-import-wizard-step").evaluate((element) => {
      element.scrollTop = 0;
    });
    await dialog.screenshot({ path: testInfo.outputPath(`bulk-review-${theme}.png`) });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`orders movements and returns from editing without losing the parent draft in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    if (testInfo.project.name === "chromium")
      await page.setViewportSize({ width: 1440, height: 1024 });
    const parent = piece("30000000-0000-4000-8000-000000000001", "Sunrise Mass", "Ola Gjeilo", "");
    const movements = [
      {
        ...piece("30000000-0000-4000-8000-000000000002", "The Spheres", "Ola Gjeilo", ""),
        durationSeconds: 304,
        parentId: parent.id,
      },
      {
        ...piece("30000000-0000-4000-8000-000000000003", "Sunrise", "Ola Gjeilo", ""),
        durationSeconds: 592,
        parentId: parent.id,
      },
      {
        ...piece("30000000-0000-4000-8000-000000000004", "The City", "Ola Gjeilo", ""),
        durationSeconds: 617,
        parentId: parent.id,
      },
      {
        ...piece("30000000-0000-4000-8000-000000000005", "Identity & The Ground", "Ola Gjeilo", ""),
        durationSeconds: 354,
        parentId: parent.id,
      },
    ];
    await installRoutes(page, [
      { ...parent, movementOrder: movements.map(({ id }) => id) },
      ...movements,
    ]);
    await page.addInitScript((value) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, value);
    }, theme);
    await page.goto("/admin/library");
    await page.getByRole("button", { name: "Edit music piece: Sunrise Mass" }).click();
    let dialog = page.getByRole("dialog", { name: "Edit music piece: Sunrise Mass" });
    if (testInfo.project.name === "mobile-chromium") {
      await dialog.getByRole("combobox", { name: "Music section" }).selectOption("movements");
    } else {
      await dialog.getByRole("tab", { name: "Movements (4)" }).click();
    }
    const list = dialog.getByRole("list", { name: "Default movement order" });
    await expect(list.getByRole("listitem")).toHaveCount(4);
    await page.screenshot({
      path: testInfo.outputPath(`music-movements-${theme}.png`),
      fullPage: false,
    });
    if (testInfo.project.name === "chromium") {
      await list.getByRole("listitem").nth(2).dragTo(list.getByRole("listitem").nth(1));
    } else {
      await dialog.getByRole("button", { name: "Move The City up", exact: true }).click();
    }
    if (testInfo.project.name === "mobile-chromium") {
      await expect(
        dialog.getByRole("option", { name: "Movements (4) — Unsaved changes", exact: true }),
      ).toHaveCount(1);
      await expect(dialog.getByRole("option", { name: "Piece details", exact: true })).toHaveCount(
        1,
      );
    } else {
      await expect(
        dialog.getByRole("tab", { name: "Movements (4)", exact: true }),
      ).toHaveAccessibleDescription("Unsaved");
      await expect(
        dialog.getByRole("tab", { name: "Piece details", exact: true }),
      ).not.toHaveAttribute("aria-describedby");
    }
    await page.screenshot({ path: testInfo.outputPath(`music-unsaved-sections-${theme}.png`) });
    await dialog.getByRole("button", { name: "Open movement: The City", exact: true }).click();
    const child = page.getByRole("dialog", { name: "Edit music piece: The City", exact: true });
    await expect(child.getByRole("button", { name: "Back to Sunrise Mass" })).toBeVisible();
    await child.getByLabel("Title", { exact: true }).fill("The City (edited)");
    await page
      .getByRole("dialog", { name: "Edit music piece: The City (edited)", exact: true })
      .getByRole("button", { name: "Back to Sunrise Mass" })
      .click();
    const confirmation = page.getByRole("dialog", { name: "Discard movement changes?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit music piece: The City (edited)", exact: true })
      .getByRole("button", { name: "Save and return" })
      .click();
    dialog = page.getByRole("dialog", { name: "Edit music piece: Sunrise Mass", exact: true });
    const returned = dialog.getByRole("list", { name: "Default movement order" });
    await expect(returned.getByRole("listitem").nth(1)).toContainText("The City (edited)");
    await expect(
      dialog.getByRole("button", { name: "Open movement: The City (edited)", exact: true }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: "Open movement: Sunrise", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit music piece: Sunrise", exact: true })
      .getByLabel("Title", { exact: true })
      .fill("Discard this edit");
    await page
      .getByRole("dialog", { name: "Edit music piece: Discard this edit", exact: true })
      .getByRole("button", { name: "Back to Sunrise Mass" })
      .click();
    await page
      .getByRole("dialog", { name: "Discard movement changes?" })
      .getByRole("button", { name: "Discard and return" })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Open movement: Sunrise", exact: true }),
    ).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await expect(
        dialog.getByRole("tab", { name: "Movements (4)", exact: true }),
      ).toHaveAccessibleDescription("Unsaved");
    }
    await dialog.getByRole("button", { name: "Save order", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Edit music piece: Sunrise Mass" }).click();
    if (testInfo.project.name === "mobile-chromium") {
      await dialog.getByRole("combobox", { name: "Music section" }).selectOption("movements");
    } else {
      await dialog.getByRole("tab", { name: "Movements (4)" }).click();
    }
    await expect(
      dialog.getByRole("list", { name: "Default movement order" }).getByRole("listitem").nth(1),
    ).toContainText("The City (edited)");
    await expect(dialog.getByText("Unsaved", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Sunrise Mass", exact: true }).check();
    await page.getByRole("button", { name: "Add to set list (1)" }).click();
    const eventWrite = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname.startsWith("/api/organization/events/"),
    );
    await page
      .getByRole("dialog", { name: "Add to set list", exact: true })
      .getByRole("button", { name: "Add to set list", exact: true })
      .click();
    const savedSetList = organizationEventRequestSchema.parse(
      (await eventWrite).postDataJSON(),
    ).setList;
    expect(savedSetList.map(({ pieceId }) => pieceId)).toEqual([
      movements[0]?.id,
      movements[2]?.id,
      movements[1]?.id,
      movements[3]?.id,
    ]);
    expect(runtimeErrors).toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`repairs loudness recordings and configures the target in ${theme} theme`, async ({
    page,
  }, info) => {
    const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const current = {
      ...piece("11111111-1111-4111-8111-111111111111", "First Work", "Jane Doe", ""),
      trackFileIds: { tutti: fileId, S1: otherId },
    };
    await installRoutes(page, [current]);
    let settings = organizationMusicLibrarySettingsRequestSchema.parse({
      practiceLoudnessTargetLufs: -18,
    });
    await page.route("**/api/organization/music-library-settings", async (route) => {
      if (route.request().method() === "PUT")
        settings = organizationMusicLibrarySettingsRequestSchema.parse(
          route.request().postDataJSON(),
        );
      await fulfill(route, { ...settings, requestId });
    });
    await page.route("**/api/organization/music/loudness**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/claim")) {
        await fulfill(route, { claim: null });
        return;
      }
      if (route.request().method() === "POST") {
        await fulfill(route, { queued: 1 });
        return;
      }
      await fulfill(route, {
        statuses: [{ status: "failed", count: 1 }],
        failures: [
          {
            fileId,
            fileName: "original.mp3",
            pieceTitle: "First Work",
            status: "failed",
            reasonCode: "invalid_audio",
          },
        ],
      });
    });
    await page.route(`**/api/organization/files/${fileId}`, async (route) => {
      if (route.request().method() === "DELETE") {
        await fulfill(route, { deleted: true, requestId });
        return;
      }
      await route.fulfill({
        body: "original-file-bytes",
        contentType: "audio/mpeg",
        headers: { "content-disposition": 'attachment; filename="original.mp3"' },
      });
    });
    await page.addInitScript((value) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, value);
    }, theme);
    await page.goto("/admin/library/settings");
    const panel = page.getByRole("group", { name: "Practice recording loudness", exact: true });
    await expect(panel).toBeVisible();
    await panel.getByLabel("Target loudness (LUFS)").fill("-14");
    await panel.getByRole("button", { name: "Save loudness target" }).click();
    await expect(page.getByText("Music library settings saved.")).toBeVisible();
    expect(settings.practiceLoudnessTargetLufs).toBe(-14);
    const downloadPromise = page.waitForEvent("download");
    await panel.getByRole("link", { name: "Download", exact: true }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("original.mp3");
    await panel.getByRole("link", { name: "First Work", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit music piece: First Work", exact: true });
    await expect(editor).toBeVisible();
    await editor.getByRole("link", { name: "← Back to Library Settings", exact: true }).click();
    await panel.getByRole("button", { name: "Replace recording original.mp3" }).click();
    const repair = page.getByRole("dialog", { name: "Replace practice recording", exact: true });
    const fileInput = repair.getByLabel("Replace tutti learning track for First Work");
    await expect(fileInput).toBeVisible();
    const layoutProblems = await repair.locator(".music-audio-track").evaluateAll((tracks) =>
      tracks.flatMap((track) => {
        const bounds = track.getBoundingClientRect();
        const controls = Array.from(
          track.querySelectorAll(
            ".music-audio-track__player button, .music-audio-track__scrubber, .music-audio-track__time, .music-audio-track__controls > a, .music-audio-track__controls > label, .music-audio-track__controls > button",
          ),
        )
          .map((control) => control.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        const problems: string[] = [];
        controls.forEach((rect, index) => {
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
            problems.push(`Control ${String(index)} overflows its track`);
          controls.slice(index + 1).forEach((other) => {
            if (
              Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1 &&
              Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1
            )
              problems.push(`Control ${String(index)} overlaps another control`);
          });
        });
        return problems;
      }),
    );
    expect(layoutProblems).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`recording-repair-${theme}.png`),
      fullPage: true,
    });
    const updatePromise = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/api/organization/music/${current.id}`,
    );
    await fileInput.setInputFiles("apps/web/src/account/loudness/fixtures/44100-1-vbr.mp3");
    const updated = organizationMusicPieceRequestSchema.parse((await updatePromise).postDataJSON());
    expect(updated.trackFileIds.S1).toBe(otherId);
    expect(updated.trackFileIds.tutti).not.toBe(fileId);
    await expect(repair).toBeHidden();
    await page.screenshot({
      path: info.outputPath(`loudness-settings-${theme}.png`),
      fullPage: true,
    });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`explains weak AI matches and keeps arrangement choices readable in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({
      width: testInfo.project.name.includes("mobile") ? 390 : 1440,
      height: testInfo.project.name.includes("mobile") ? 2000 : 1400,
    });
    const first = piece(
      "11111111-1111-4111-8111-111111111111",
      "Ave Maria",
      "Franz Biebl",
      "A long arranger credit with multiple collaborators and an extended edition description",
    );
    const second = piece(
      "22222222-2222-4222-8222-222222222222",
      "Ave Maria",
      "Tomás Luis de Victoria",
      "Another arrangement with a long publisher and editor credit",
    );
    await installRoutes(page, [first, second]);
    await page.addInitScript((value) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, value);
    }, theme);
    let attempt = 0;
    await page.route("**/api/organization/music/track-import/match", async (route) => {
      const body = musicTrackImportMatchRequestSchema.parse(route.request().postDataJSON());
      attempt += 1;
      await fulfill(route, {
        model: "internal",
        requestId,
        suggestions: body.groups.map((group) => ({
          groupId: group.groupId,
          confidence: "none",
          suggestedPieceId: null,
          noneProbability: attempt === 1 ? 0.67 : 0.1,
          topCandidates: [
            { pieceId: first.id, probability: attempt === 1 ? 0.2 : 0.48 },
            { pieceId: second.id, probability: attempt === 1 ? 0.13 : 0.42 },
          ],
        })),
      });
    });
    await page.goto("/admin/library");
    await page.getByRole("button", { name: "Bulk upload practice tracks", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Bulk upload practice tracks" });
    await dialog.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from("invalid-audio"),
      mimeType: "audio/mpeg",
      name: "Ave Maria.mp3",
    });
    await expect(dialog.getByText("Ave Maria.mp3")).toBeVisible();
    await dialog.getByRole("radio", { name: /Entire Music Library/ }).check();
    await dialog.getByRole("button", { name: "Review groups" }).click();
    const summary = dialog.locator(".track-import-review-summary");
    expect((await summary.boundingBox())?.height).toBeLessThan(60);
    await expect(dialog.getByText("Your recordings:")).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath(`review-tidy-${theme}.png`) });
    await dialog.getByRole("button", { name: "Choose destination", exact: true }).click();
    await expect(
      dialog.getByRole("searchbox", {
        name: "Search titles, composers, or arrangers",
      }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: "AI Match batch" }).click();
    await expect(
      dialog.getByRole("heading", { name: "AI couldn’t find a reliable match" }),
    ).toBeVisible();
    await expect(dialog.getByText(/AI matching complete/)).toContainText(
      "0 of 1 included song groups have a destination",
    );
    await expect(dialog.getByRole("button", { name: /Select destination:/ })).toHaveCount(0);
    const search = dialog.getByRole("button", { name: "Search library to change piece" });
    await expect(search).toBeVisible();
    const searchBox = await search.boundingBox();
    expect(searchBox?.width).toBeGreaterThan(180);
    await dialog
      .locator(".track-import-review-destination")
      .screenshot({ path: testInfo.outputPath(`ai-no-match-${theme}.png`) });
    await dialog.getByRole("button", { name: "AI Match batch" }).click();
    await expect(dialog.getByRole("heading", { name: "Possible destinations" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Select destination:/ })).toHaveCount(2);
    const picker = dialog.locator(".track-import-piece-picker");
    expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    const result = dialog.getByRole("status", { name: "AI matching result" });
    await expect(result).not.toContainText("48%");
    if (testInfo.project.name.includes("mobile")) {
      const cards = result.getByRole("listitem");
      await cards
        .nth(0)
        .screenshot({ path: testInfo.outputPath(`ai-first-alternative-${theme}.png`) });
      await cards
        .nth(1)
        .screenshot({ path: testInfo.outputPath(`ai-second-alternative-${theme}.png`) });
    } else {
      await result.screenshot({ path: testInfo.outputPath(`ai-alternatives-${theme}.png`) });
    }
    const choose = dialog.getByRole("button", {
      name: /Select destination: Ave Maria, by Franz Biebl, arranged by A long/,
    });
    await choose.scrollIntoViewIfNeeded();
    const choiceBox = await choose.boundingBox();
    const footerBox = await dialog.locator(".track-import-review-footer").boundingBox();
    if (!choiceBox || !footerBox) throw new Error("Missing destination action geometry");
    expect(choiceBox.y + choiceBox.height).toBeLessThanOrEqual(footerBox.y + 1);
    await choose.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.locator(".track-import-piece-picker__summary")).toContainText(
      "Franz Biebl",
    );
    await expect(dialog.getByRole("button", { name: "Continue to confirmation" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Choose voice part", exact: true }).click();
    const part = dialog.getByRole("combobox", { name: "Section or voice part for Ave Maria.mp3" });
    await expect(part).toBeFocused();
    const partBox = await part.boundingBox();
    if (!partBox) throw new Error("Missing focused voice-part control");
    expect(partBox.y + partBox.height).toBeLessThanOrEqual(footerBox.y + 1);
    await part.selectOption("S1");
    await expect(dialog.getByRole("button", { name: "Mark reviewed & next" })).toBeEnabled();
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`accepts and undoes counted Tutti suggestions before explicit review in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await installRoutes(page);
    await page.addInitScript((value) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, value);
    }, theme);
    await page.goto("/admin/library");
    await page.getByRole("button", { name: "Bulk upload practice tracks", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Bulk upload practice tracks" });
    await dialog.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from("invalid-audio"),
      mimeType: "audio/mpeg",
      name: "First Work.mp3",
    });
    await expect(dialog.getByText("First Work.mp3")).toBeVisible();
    await dialog.getByRole("radio", { name: /Entire Music Library/ }).check();
    await dialog.getByRole("button", { name: "Review groups" }).click();
    const batch = dialog.getByRole("region", { name: "Tutti suggestions" });
    await batch.screenshot({ path: testInfo.outputPath(`tutti-batch-${theme}.png`) });
    const apply = batch.getByRole("button", { name: "Use Tutti for 1 unlabeled recording" });
    await apply.focus();
    await page.keyboard.press("Enter");
    const part = dialog.getByRole("combobox", { name: "Section or voice part for First Work.mp3" });
    await expect(part).toHaveValue("tutti");
    await expect(batch.getByRole("button", { name: "Undo Tutti assignments" })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Continue to confirmation" })).toHaveCount(0);
    await batch.getByRole("button", { name: "Undo Tutti assignments" }).click();
    await expect(part).toHaveValue("");
    await expect(apply).toBeFocused();
    await expect(dialog.getByText("Tutti · suggested")).toBeVisible();
    await dialog.getByRole("button", { name: "Use Tutti for First Work.mp3" }).click();
    await expect(part).toHaveValue("tutti");
    await expect(part).toBeFocused();
    await dialog.getByRole("button", { name: "Mark reviewed & next" }).click();
    await expect(dialog.getByRole("button", { name: "Continue to confirmation" })).toBeEnabled();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}
