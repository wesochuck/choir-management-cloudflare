import { expect, test } from "@playwright/test";

const requestId = "12121212-1212-4121-8121-121212121212";

test.beforeEach(async ({ page }) => {
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

test("renders practice player with artwork, track navigation, and set list", async ({
  page,
}, testInfo) => {
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventArtworkFileId: "file-art-1",
        eventId: "event-123",
        eventStartsAt: "2026-08-20T19:00:00.000Z",
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

  // Track selection nav
  const trackNav = page.getByRole("navigation", { name: "Track selection" });
  await expect(trackNav).toBeVisible();
  await expect(trackNav.getByRole("button", { name: "Tutti" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Now playing section
  const nowPlaying = page.locator(".public-player__now-playing-card");
  await expect(nowPlaying).toBeVisible();
  await expect(nowPlaying.getByRole("heading", { name: "Hallelujah Chorus" })).toBeVisible();
  await expect(nowPlaying.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(nowPlaying.getByRole("button", { name: "Previous track" })).toBeDisabled();
  await expect(nowPlaying.getByRole("button", { name: "Next track" })).toBeEnabled();

  // Secondary controls
  await expect(nowPlaying.getByRole("button", { name: "No repeat" })).toBeVisible();
  await expect(nowPlaying.getByRole("button", { name: /Set list \(2 tracks\)/i })).toBeVisible();
  await expect(nowPlaying.getByRole("button", { name: "Rehearsal settings" })).toBeVisible();

  // Selecting individual voice part from dropdown
  const voiceSelect = trackNav.getByLabel("Add individual part");
  await expect(voiceSelect).toBeVisible();
  await voiceSelect.selectOption("soprano1");
  await expect(trackNav.getByRole("button", { name: "SOPRANO1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Set list verification (responsive)
  const isMobile = testInfo.project.name.includes("mobile");
  if (isMobile) {
    const setListBtn = page.getByRole("button", { name: /Set list \(2 tracks\)/i });
    await setListBtn.click({ force: true });
    const sheet = page.locator(".sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Hallelujah Chorus")).toBeVisible();
    await expect(sheet.getByText("Ave Verum")).toBeVisible();
  } else {
    const setList = page.locator(".public-player__desktop-panel .public-player__set-list");
    await expect(setList).toBeVisible();
    await expect(setList.getByText("2 tracks")).toBeVisible();
    await expect(setList.getByText("Hallelujah Chorus")).toBeVisible();
    await expect(setList.getByText("Ave Verum")).toBeVisible();
  }
});

test("opens and interacts with rehearsal settings drawer", async ({ page }) => {
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventId: "event-123",
        eventStartsAt: "2026-08-20T19:00:00.000Z",
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
  await expect(sheet.getByRole("heading", { name: "Rehearsal Settings" })).toBeVisible();
  await expect(sheet.getByLabel("Start track at")).toBeVisible();
  await expect(sheet.getByLabel("Volume")).toBeVisible();
  await expect(sheet.getByLabel("Gap between tracks")).toBeVisible();
});
