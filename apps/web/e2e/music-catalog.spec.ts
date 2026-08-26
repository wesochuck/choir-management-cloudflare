import type { OrganizationEvent } from "@choir/contracts";
import {
  organizationEventRequestSchema,
  organizationMusicGenreDeleteRequestSchema,
  organizationMusicGenreRenameRequestSchema,
  organizationMusicLibrarySettingsRequestSchema,
} from "@choir/contracts";
import { expect, test, type Page, type Route } from "@playwright/test";

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

function mockEvent(
  id: string,
  title: string,
  startsAt: string,
  setList: OrganizationEvent["setList"] = [],
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
    startsAt,
    ticketCapacity: null,
    title,
    type: "Performance",
    updatedAt: "2026-08-17T00:00:00.000Z",
    venueId: null,
  };
}

async function installRoutes(page: Page): Promise<void> {
  let pieces = [
    piece("11111111-1111-4111-8111-111111111111", "First Work", "Jane Doe", "J. Smith"),
    piece("22222222-2222-4222-8222-222222222222", "Second Work", "Jane Doe", "Jane Doe"),
  ];
  let events: OrganizationEvent[] = [
    mockEvent(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "Spring Gala 2026",
      "2026-09-15T19:00:00.000Z",
    ),
  ];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/organization/music/credits/rename") {
      const body: unknown = route.request().postDataJSON();
      if (!isCreditRenameRequest(body)) {
        await fulfill(route, { code: "validation_failed", requestId }, 400);
        return;
      }
      expect(body).toEqual({ currentName: "Jane Doe", newName: "Jane Q. Doe" });
      pieces = pieces.map((item) => ({
        ...item,
        arranger: item.arranger === body.currentName ? body.newName : item.arranger,
        composer: item.composer === body.currentName ? body.newName : item.composer,
      }));
      await fulfill(route, { pieces, requestId });
      return;
    }
    if (url.pathname === "/api/organization/events" && route.request().method() === "POST") {
      const parsed = organizationEventRequestSchema.safeParse(route.request().postDataJSON());
      if (parsed.success) {
        const newEvent = mockEvent(
          crypto.randomUUID(),
          parsed.data.title,
          parsed.data.startsAt,
          parsed.data.setList,
        );
        events = [...events, newEvent];
        await fulfill(route, newEvent);
        return;
      }
    }
    if (
      url.pathname.startsWith("/api/organization/events/") &&
      route.request().method() === "PUT"
    ) {
      const id = url.pathname.split("/").pop() ?? "";
      const parsed = organizationEventRequestSchema.safeParse(route.request().postDataJSON());
      if (parsed.success) {
        events = events.map((e): OrganizationEvent => {
          if (e.id !== id) return e;
          return {
            ...e,
            ...parsed.data,
            updatedAt: "2026-08-17T00:00:00.000Z",
          };
        });
        const updated = events.find((e) => e.id === id);
        if (updated) {
          await fulfill(route, updated);
          return;
        }
      }
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
      "/api/organization/venues": { requestId, venues: [] },
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

  // 2. Select pieces again and create a new concert set list
  await selectFirst.click();
  await selectSecond.click();
  await page.getByRole("button", { name: "Add to set list (2)" }).click();

  await page.getByLabel("Create new concert").click();
  await page.getByLabel("Concert / Performance title").fill("Winter Concert 2026");
  await page.getByLabel("Date and time").fill("2026-12-10T19:30");
  await page.getByRole("button", { name: "Create concert & add set list" }).click();

  await expect(
    page.getByText('Created "Winter Concert 2026" and added 2 piece(s) to its set list.'),
  ).toBeVisible();
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

  const genreInput = page.getByLabel("Add a genre label");
  const genreButton = page.getByRole("button", { name: "Add genre" });
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
  await expect(page.locator(".music-genre-chip").filter({ hasText: "Christmas" })).toBeVisible();

  await page.getByLabel("Add a genre label").fill("Folk");
  await page.getByRole("button", { name: "Add genre" }).click();
  await expect(page.getByText("Genre added.")).toBeVisible();
  await expect(page.locator(".music-genre-chip").filter({ hasText: "Folk" })).toBeVisible();

  await page.getByRole("button", { name: "Rename Christmas genre" }).click();
  await page.getByLabel("Rename Christmas genre").fill("Holiday");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Genre renamed.")).toBeVisible();
  await expect(page.locator(".music-genre-chip").filter({ hasText: "Holiday" })).toBeVisible();
  await expect(page.locator(".music-genre-chip").filter({ hasText: "Christmas" })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete Holiday genre" }).click();
  const removeDialog = page.getByRole("dialog", { name: "Remove Holiday?" });
  await expect(removeDialog).toBeVisible();
  await removeDialog.getByRole("button", { name: "Remove genre" }).click();
  await expect(page.getByText("Genre removed.")).toBeVisible();
  await expect(page.locator(".music-genre-chip").filter({ hasText: "Holiday" })).toHaveCount(0);
});

test("keeps the piece editor action buttons on a single row", async ({ page }) => {
  await installRoutes(page);
  await page.goto("/admin/library");

  await page.getByRole("button", { name: "Edit music piece: First Work" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit music piece" });
  await expect(dialog).toBeVisible();
  const actionButtons = dialog.locator(".music-piece-form__actions > .button");
  await expect(actionButtons).toHaveCount(4);
  // Below 40rem the action row wraps, which is the intended narrow-screen
  // behavior; a single shared baseline is a desktop assertion.
  if ((page.viewportSize()?.width ?? 0) > 640) {
    const tops = await actionButtons.evaluateAll((buttons) => [
      ...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))),
    ]);
    expect(tops).toHaveLength(1);
  }
});
