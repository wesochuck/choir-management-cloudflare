import { expect, test } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";
import type { PlayerPlaylistItem } from "../src/public/player/types";

const requestId = "12121212-1212-4121-8121-121212121212";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get() {
        return 180;
      },
    });
    HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("canplay"));
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dispatchEvent(new Event("pause"));
    };
  });

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
  await page.route("**/api/public/player/media/**", async (route) => {
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
      contentType: "image/png",
      status: 200,
    });
  });
});

test("shows player link required when no token is provided", async ({ page }) => {
  await page.goto("/player");
  await expect(page.getByRole("heading", { name: "Player Link Required" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to the Organization site" })).toBeVisible();
});

test("shows not found when player token is invalid or expired", async ({ page }) => {
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: "not_found", error: "Not found", requestId }),
      contentType: "application/json",
      status: 404,
    });
  });

  await page.goto("/player?token=invalid-token");
  await expect(page.getByRole("heading", { name: "Link Not Found" })).toBeVisible();
  await expect(
    page.getByText("This practice-player link is invalid or expired.", { exact: false }),
  ).toBeVisible();
});

test("renders practice player with artwork, track navigation, and set list @webkit-smoke", async ({
  page,
}, testInfo) => {
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventArtworkFileId: "file-art-1",
        eventId: "event-123",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Summer Showcase",
        items: [
          {
            arranger: "Arranger Name",
            composer: "Composer Name",
            durationSeconds: 180,
            pieceId: "piece-1",
            title: "Hallelujah Chorus",
            trackFileIds: {
              alto: "file-alto-1",
              soprano: "file-sop-1",
              soprano1: "file-sop1-1",
              soprano2: "file-sop2-1",
              soprano3: "file-sop3-1",
              tenor: "file-tenor-1",
              tutti: "file-tutti-1",
            },
          },
          {
            composer: "Second Composer",
            durationSeconds: 210,
            pieceId: "piece-2",
            title: "Ave Verum",
            trackFileIds: {
              bass: "file-bass-2",
              tutti: "file-tutti-2",
            },
          },
        ],
        profileName: "Jane Doe",
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?token=valid-player-token");

  await expect(page.getByRole("heading", { name: "Summer Showcase" })).toBeVisible();
  await expect(page.getByText("Welcome, Jane Doe.")).toBeVisible();

  // Artwork
  const artwork = page.getByAltText("Summer Showcase artwork");
  await expect(artwork).toBeVisible();

  // Now playing section
  const nowPlaying = page.locator(".public-player__now-playing-card");
  await expect(nowPlaying).toBeVisible();
  await expect(nowPlaying.getByRole("heading", { name: "Hallelujah Chorus" })).toBeVisible();
  const playBtn = nowPlaying.getByRole("button", { name: "Play" });
  await expect(playBtn).toBeVisible();
  await playBtn.click();
  await expect(nowPlaying.getByRole("button", { name: "Pause" })).toBeVisible();
  await nowPlaying.getByRole("button", { name: "Pause" }).click();
  await expect(nowPlaying.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(nowPlaying.getByRole("button", { name: "Previous track" })).toBeDisabled();
  await expect(nowPlaying.getByRole("button", { name: "Next track" })).toBeEnabled();

  const isMobile = testInfo.project.name.includes("mobile");
  if (isMobile) {
    const mobilePicker = page.locator(".public-player__part-picker-mobile");
    await expect(mobilePicker).toBeVisible();
    await expect(page.locator(".public-player__part-picker-value")).toContainText("Choir Mix");

    // Secondary controls
    await expect(nowPlaying.getByRole("button", { name: "No repeat" })).toBeVisible();
    await expect(nowPlaying.getByRole("button", { name: /Set list \(2 tracks\)/i })).toBeVisible();
    await expect(nowPlaying.getByRole("button", { name: "Rehearsal settings" })).toBeVisible();

    // Selecting individual voice part from mobile native select
    const mobileSelect = page.locator("#mobile-voice-part-select");
    await mobileSelect.selectOption("soprano1");
    await expect(page.locator(".public-player__part-picker-value")).toContainText("Soprano 1");
    await expect(nowPlaying.locator(".public-player__track-badge")).toHaveText("SOPRANO1");

    // Set list verification (responsive)
    const setListBtn = page.getByRole("button", { name: /Set list \(2 tracks\)/i });
    await setListBtn.click();
    const sheet = page.getByRole("dialog", { name: "Set List" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Hallelujah Chorus")).toBeVisible();
    await expect(sheet.getByText("Ave Verum")).toBeVisible();
  } else {
    // Voice part selector trigger defaults to Choir Mix (Tutti)
    const voicePartTrigger = nowPlaying.getByRole("button", { name: /Voice Part/i });
    await expect(voicePartTrigger).toBeVisible();
    await expect(voicePartTrigger).toContainText("Choir Mix");

    // Secondary controls
    await expect(nowPlaying.getByRole("button", { name: "No repeat" })).toBeVisible();
    await expect(
      nowPlaying.getByRole("button", { name: /Set list \(2 tracks\)/i }),
    ).not.toBeVisible();
    await expect(nowPlaying.getByRole("button", { name: "Rehearsal settings" })).toBeVisible();

    // Selecting individual voice part from modal sheet
    await voicePartTrigger.click();
    const voicePartSheet = page.getByRole("dialog", { name: "Choose Voice Part" });
    await expect(voicePartSheet).toBeVisible();
    const soprano1Option = voicePartSheet.getByRole("radio", { name: "Soprano 1" });
    await expect(soprano1Option).toBeVisible();
    await soprano1Option.click();
    await expect(voicePartSheet).not.toBeVisible();
    await expect(page.locator(".dialog__overlay")).toHaveCount(0);
    await expect(voicePartTrigger).toContainText("Soprano 1");
    await expect(nowPlaying.locator(".public-player__track-badge")).toHaveText("SOPRANO1");

    // Set list verification (responsive)
    const setList = page.locator(".public-player__desktop-panel .public-player__set-list");
    await expect(setList).toBeVisible();
    await expect(setList).not.toHaveClass(/public-player__set-list--mobile-picker/);
    await expect(setList.getByText("2 tracks")).toBeVisible();
    await expect(setList.getByText("Hallelujah Chorus")).toBeVisible();
    await expect(setList.getByText("Ave Verum")).toBeVisible();
    await expect(setList).toHaveCSS("border-top-width", "1px");
    await expect(setList).not.toHaveCSS("box-shadow", "none");
    const desktopOptions = page.locator(".public-player__desktop-options");
    await expect(desktopOptions.getByLabel("Volume")).toBeVisible();
  }
});

test("shows a dismissible voice-part nudge for visitors without an assigned part", async ({
  page,
}, testInfo) => {
  await page.route("**/api/singer/profile", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: "unauthorized", error: "No session", requestId }),
      contentType: "application/json",
      status: 401,
    });
  });
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventId: "event-123",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Summer Showcase",
        items: [
          {
            composer: "Composer Name",
            durationSeconds: 180,
            pieceId: "piece-1",
            title: "Hallelujah Chorus",
            trackFileIds: {
              alto: "file-alto-1",
              soprano: "file-sop-1",
              tutti: "file-tutti-1",
            },
          },
        ],
        profileName: "Jane Doe",
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?token=valid-player-token");
  const nowPlaying = page.locator(".public-player__now-playing-card");
  await expect(nowPlaying.getByRole("heading", { name: "Hallelujah Chorus" })).toBeVisible();

  // Exact nudge copy next to the unmodified selector.
  await expect(nowPlaying.getByText("Choose yours")).toBeVisible();
  await expect(
    nowPlaying.getByText(
      "Your individual part may have its own recording. Select your part above to hear it when available.",
    ),
  ).toBeVisible();
  await expect(nowPlaying.getByRole("button", { name: "Dismiss voice-part tip" })).toBeVisible();
  await testInfo.attach("voice-part-nudge-visible", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  // Dismissing hides the nudge and it stays hidden after a same-tab reload.
  await nowPlaying.getByRole("button", { name: "Dismiss voice-part tip" }).click();
  await expect(nowPlaying.getByText("Choose yours")).not.toBeVisible();
  await page.reload();
  const reloaded = page.locator(".public-player__now-playing-card");
  await expect(reloaded.getByRole("heading", { name: "Hallelujah Chorus" })).toBeVisible();
  await expect(reloaded.getByText("Choose yours")).not.toBeVisible();
  await testInfo.attach("voice-part-nudge-dismissed", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("suppresses the voice-part nudge for assigned parts and after manual selection", async ({
  page,
}) => {
  await page.route("**/api/singer/profile", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        displayName: "Jane Doe",
        email: "",
        globalStatus: "Active",
        id: "00000000-0000-4000-8000-000000000000",
        phone: "",
        photoFileId: null,
        receiveOtherEventReminders: true,
        receivePerformanceReminders: true,
        receiveRehearsalReminders: true,
        requestId,
        showInDirectory: true,
        voicePart: "Alto",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventId: "event-123",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Summer Showcase",
        items: [
          {
            composer: "Composer Name",
            durationSeconds: 180,
            pieceId: "piece-1",
            title: "Hallelujah Chorus",
            trackFileIds: {
              alto: "file-alto-1",
              soprano: "file-sop-1",
              tutti: "file-tutti-1",
            },
          },
        ],
        profileName: "Jane Doe",
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?token=valid-player-token");
  const nowPlaying = page.locator(".public-player__now-playing-card");
  await expect(nowPlaying.getByRole("heading", { name: "Hallelujah Chorus" })).toBeVisible();

  // Assigned Alto resolves to the alto track and never shows the nudge.
  await expect(nowPlaying.locator(".public-player__track-badge")).toHaveText("ALTO");
  await expect(nowPlaying.getByText("Choose yours")).not.toBeVisible();
});

test("retains the selected part across reloads without a login", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name.includes("mobile");
  await page.route("**/api/singer/profile", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: "unauthorized", error: "No session", requestId }),
      contentType: "application/json",
      status: 401,
    });
  });
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventId: "event-123",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Summer Showcase",
        items: [
          {
            composer: "Composer Name",
            durationSeconds: 180,
            pieceId: "piece-1",
            title: "Hallelujah Chorus",
            trackFileIds: {
              alto: "file-alto-1",
              soprano: "file-sop-1",
              tutti: "file-tutti-1",
            },
          },
        ],
        profileName: "Jane Doe",
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?token=valid-player-token");
  const nowPlaying = page.locator(".public-player__now-playing-card");
  await expect(nowPlaying.getByRole("heading", { name: "Hallelujah Chorus" })).toBeVisible();
  await expect(nowPlaying.getByText("Choose yours")).toBeVisible();

  if (isMobile) {
    await page.locator("#mobile-voice-part-select").selectOption("soprano");
  } else {
    await nowPlaying.getByRole("button", { name: /Voice Part/i }).click();
    await page
      .getByRole("dialog", { name: "Choose Voice Part" })
      .getByRole("radio", {
        name: "Soprano",
      })
      .click();
  }
  await expect(nowPlaying.locator(".public-player__track-badge")).toHaveText("SOPRANO");

  await page.reload();
  const reloaded = page.locator(".public-player__now-playing-card");
  await expect(reloaded.getByRole("heading", { name: "Hallelujah Chorus" })).toBeVisible();
  await expect(reloaded.locator(".public-player__track-badge")).toHaveText("SOPRANO");
  await expect(reloaded.getByText("Choose yours")).not.toBeVisible();
});

test("opens and interacts with rehearsal settings drawer", async ({ page }) => {
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventId: "event-123",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Summer Showcase",
        items: [
          {
            title: "Hallelujah Chorus",
            trackFileIds: { tutti: "file-tutti-1" },
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?token=valid-player-token");
  const settingsBtn = page.getByRole("button", { name: "Rehearsal settings" });
  await settingsBtn.click();

  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass("sheet--mobile-fullscreen");
  await expect(sheet.getByRole("heading", { name: "Rehearsal Settings" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Close Rehearsal Settings" })).toBeVisible();
  await expect(sheet.getByLabel("Start track at")).toBeVisible();
  await expect(sheet.getByLabel("Volume")).not.toBeVisible();
  await expect(sheet.getByLabel("Gap between tracks")).toBeVisible();
});

test("mobile Set List is a full-screen picker with a revealed active track", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "This flow covers the mobile picker.");
  await page.emulateMedia({ reducedMotion: "reduce" });

  const items: PlayerPlaylistItem[] = Array.from({ length: 12 }, (_, index) => ({
    composer: `Composer ${String(index + 1)}`,
    pieceId: `piece-${String(index + 1)}`,
    title: `Track ${String(index + 1)}`,
    trackFileIds: { tutti: `file-track-${String(index + 1)}` },
  }));
  items.push({
    composer: "Fallback Composer",
    pieceId: "piece-fallback",
    title: "Fallback track",
    trackFileIds: { alto: "file-track-fallback" },
  });
  items.push({
    pieceId: "piece-unavailable",
    title: "Unrecorded track",
    trackFileIds: {},
  });

  await page.setViewportSize({ height: 844, width: 320 });
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventId: "event-123",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Autumn Concert",
        items,
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?token=mobile-picker-token");
  const nowPlaying = page.locator(".public-player__now-playing-card");
  const trigger = page.getByRole("button", { name: "Set list (13 tracks)" });
  await trigger.click();

  const sheet = page.getByRole("dialog", { name: "Set List" });
  await expect(sheet).toBeVisible();
  const heading = sheet.locator(".public-player__sheet-header--set-list");
  await expect(heading.getByRole("heading", { name: "Set List" })).toBeVisible();
  await expect(heading).toContainText("Autumn Concert · 13 tracks");
  await expect(sheet.locator(".public-player__set-list-heading")).toHaveCount(0);
  await expect(sheet.locator(".public-player__set-list-help")).toHaveCount(0);
  await expect(sheet.locator(".public-player__sheet-header--set-list h2")).toHaveCount(1);

  const unavailableTrack = sheet.getByRole("button", { name: /Unrecorded track/ });
  await expect(unavailableTrack).toBeDisabled();
  await expect(sheet.getByText("Unavailable")).toBeVisible();
  const fallbackTrack = sheet.getByRole("button", { name: /Fallback track/ });
  await expect(fallbackTrack).toContainText("Fallback Composer");
  await expect(fallbackTrack.getByText("ALTO fallback", { exact: true })).toBeVisible();

  await sheet.getByRole("button", { name: /Track 12/ }).click();
  await expect(sheet).not.toBeVisible();
  await expect(nowPlaying.getByRole("heading", { name: "Track 12" })).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(sheet).toBeVisible();
  const activeRow = sheet.locator(".public-player__queue-list--mobile-picker li.is-active");
  const activeButton = activeRow.getByRole("button", { name: /Track 12/ });
  await expect(activeButton).toHaveAttribute("aria-current", "true");
  await expect(activeRow.getByText("Now Playing")).toBeVisible();
  await expect(activeRow).toContainText("Composer 12");
  await expect(activeRow).toContainText("Tutti");
  await expect(activeRow.getByRole("link", { name: "Download Track 12" })).toBeVisible();
  await expect(activeRow.getByRole("button", { name: "Save offline" })).toBeVisible();
  expect(await activeButton.locator("a, button, input, select").count()).toBe(0);

  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ height: 844, width });
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox?.x).toBe(0);
    expect(sheetBox?.y).toBe(0);
    expect(sheetBox?.width).toBeGreaterThanOrEqual(width - 1);
    expect(sheetBox?.height).toBeGreaterThanOrEqual(843);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      sheetClientWidth: document.querySelector<HTMLElement>(".sheet")?.clientWidth ?? 0,
      sheetScrollWidth: document.querySelector<HTMLElement>(".sheet")?.scrollWidth ?? 0,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(width);
    expect(overflow.sheetScrollWidth).toBeLessThanOrEqual(overflow.sheetClientWidth);
  }

  const activeGeometry = await activeRow.evaluate((row) => {
    const list = row.closest("ol");
    const rowBounds = row.getBoundingClientRect();
    const listBounds = list?.getBoundingClientRect();
    return {
      listBottom: listBounds?.bottom ?? 0,
      listScrollTop: list?.scrollTop ?? 0,
      listTop: listBounds?.top ?? 0,
      rowBottom: rowBounds.bottom,
      rowTop: rowBounds.top,
    };
  });
  expect(activeGeometry.listScrollTop).toBeGreaterThan(0);
  expect(activeGeometry.rowTop).toBeGreaterThanOrEqual(activeGeometry.listTop);
  expect(activeGeometry.rowBottom).toBeLessThanOrEqual(activeGeometry.listBottom);
  const primaryBounds = await activeButton.boundingBox();
  expect(primaryBounds?.height).toBeGreaterThanOrEqual(44);
});

test("shows each event's own artwork in set-list mode without stale carryover", async ({
  page,
}) => {
  const playlistResponse = (suffix: string, title: string) => ({
    event: {
      artworkFileId: `art-file-${suffix}`,
      date: futureIsoDate({ days: 60 }),
      id: `event-${suffix}`,
      title,
    },
    organizationName: "Ticket Card Choir",
    pieces: [
      {
        composer: "Composer Name",
        durationSeconds: 180,
        pieceId: `piece-${suffix}`,
        title: `Song ${suffix.toUpperCase()}`,
        trackFileIds: { tutti: `file-tutti-${suffix}` },
      },
    ],
    requestId,
  });
  await page.route("**/api/public/player/playlist**", async (route) => {
    const token = new URL(route.request().url()).searchParams.get("token") ?? "";
    const suffix = token === "token-event-b" ? "b" : "a";
    const title = suffix === "b" ? "Event B" : "Event A";
    await route.fulfill({
      body: JSON.stringify(playlistResponse(suffix, title)),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?mode=set-list&token=token-event-a");
  const artworkA = page.getByAltText("Event A artwork");
  await expect(artworkA).toBeVisible();
  await expect(artworkA).toHaveAttribute(
    "src",
    "/api/public/player/media/art-file-a?token=token-event-a",
  );

  await page
    .locator(".public-player__now-playing-card")
    .getByRole("button", { name: "Play" })
    .click();
  const metadata = await page.evaluate(() => {
    const current = navigator.mediaSession.metadata;
    if (!current) return null;
    return {
      album: current.album,
      artwork: current.artwork.map((entry) => ({
        sizes: entry.sizes,
        src: entry.src,
        type: entry.type,
      })),
    };
  });
  expect(metadata?.album).toBe("Event A");
  expect(metadata?.artwork).toHaveLength(1);
  expect(metadata?.artwork[0]?.src).toContain("art-file-a?token=token-event-a");
  expect(metadata?.artwork[0]?.type ?? "").toBe("");
  expect(metadata?.artwork[0]?.sizes ?? "").toBe("");

  await page.goto("/player?mode=set-list&token=token-event-b");
  const artworkB = page.getByAltText("Event B artwork");
  await expect(artworkB).toBeVisible();
  await expect(artworkB).toHaveAttribute(
    "src",
    "/api/public/player/media/art-file-b?token=token-event-b",
  );
  await expect(page.getByAltText("Event A artwork")).toHaveCount(0);
});
