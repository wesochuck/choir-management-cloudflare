import { expect, test } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";

const requestId = "13131313-1313-4131-8131-131313131313";
const audioBytes = Buffer.alloc(2048, 0);
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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
  await page.route("**/api/singer/profile", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 401 });
  });
  await page.route("**/api/public/player/media/**", async (route) => {
    const url = new URL(route.request().url());
    const fileId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (fileId === "file-art-1") {
      await route.fulfill({ body: pngBytes, contentType: "image/png", status: 200 });
      return;
    }
    await route.fulfill({ body: audioBytes, contentType: "audio/mpeg", status: 200 });
  });
  await page.route("**/api/public/player/playlist*", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        event: {
          artworkFileId: "file-art-1",
          date: futureIsoDate({ days: 30 }),
          id: "event-set-list",
          title: "Winter Concert Set List",
        },
        pieces: [
          {
            composer: "Vivaldi",
            durationSeconds: 180,
            pieceId: "piece-set-1",
            title: "Gloria in Excelsis",
            trackFileIds: {
              soprano: "file-soprano-1",
              tutti: "file-tutti-1",
            },
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventArtworkFileId: "file-art-1",
        eventId: "event-offline",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Offline Rehearsal",
        items: [
          {
            composer: "Composer Name",
            durationSeconds: 180,
            pieceId: "piece-1",
            title: "Hallelujah Chorus",
            trackFileIds: {
              alto: "file-alto-1",
              tutti: "file-tutti-1",
            },
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
});

test("caches the open event offline and explains uncached parts", async ({ page }, testInfo) => {
  await page.goto("/player?token=offline-test-token");
  await expect(page.getByRole("heading", { name: "Offline Rehearsal" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Transparent auto-cache stores the default part while online.
  const cachedPill = page.locator(".public-player__desktop-panel .public-player__offline-pill");
  await expect(cachedPill.first()).toBeAttached();

  // Cached playback works through the blob URL.
  const nowPlaying = page.locator(".public-player__now-playing-card");
  await nowPlaying.getByRole("button", { name: "Play" }).click();
  await expect(nowPlaying.getByRole("button", { name: "Pause" })).toBeVisible();

  // The mobile picker keeps its offline controls available while online.
  const isMobile = testInfo.project.name.includes("mobile");
  if (isMobile) {
    const queueTrigger = nowPlaying.getByRole("button", { name: /Set list/i });
    await queueTrigger.click();
    const picker = page.getByRole("dialog", { name: "Set List" });
    const pickerTrack = picker.locator(".public-player__queue-list--mobile-picker li").first();
    await expect(pickerTrack.getByText("Saved offline", { exact: true })).toBeVisible();

    await pickerTrack.getByRole("button", { name: "Remove" }).click();
    const saveButton = pickerTrack.getByRole("button", { name: "Save offline" });
    await expect(saveButton).toBeVisible();

    let releaseManualSave: (() => void) | undefined;
    let markManualSaveStarted: (() => void) | undefined;
    const manualSaveGate = new Promise<void>((resolve) => {
      releaseManualSave = resolve;
    });
    const manualSaveStarted = new Promise<void>((resolve) => {
      markManualSaveStarted = resolve;
    });
    await page.unroute("**/api/public/player/media/**");
    await page.route("**/api/public/player/media/**", async (route) => {
      const url = new URL(route.request().url());
      const fileId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (fileId === "file-tutti-1") {
        markManualSaveStarted?.();
        await manualSaveGate;
        await route.fulfill({ body: audioBytes, contentType: "audio/mpeg", status: 200 });
        return;
      }
      await route.fulfill({ body: pngBytes, contentType: "image/png", status: 200 });
    });
    await saveButton.click();
    await manualSaveStarted;
    await expect(pickerTrack.getByRole("status")).toContainText("Saving…");
    releaseManualSave?.();
    await expect(pickerTrack.getByText("Saved offline", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Close Set List" }).click();

    // Going offline, then switching to a part that was never cached, explains itself.
    await page.context().setOffline(true);

    const mobileSelect = page.locator("#mobile-voice-part-select");
    await mobileSelect.selectOption("alto");
    await expect(page.locator(".public-player__part-picker-value")).toContainText("Alto");
    await expect(page.getByText("saved offline. Reconnect", { exact: false })).toBeVisible();

    // Switching back to the cached part clears the message.
    await mobileSelect.selectOption("tutti");
    await expect(page.locator(".public-player__part-picker-value")).toContainText("Choir Mix");
    await expect(page.getByText("saved offline. Reconnect", { exact: false })).not.toBeVisible();
  } else {
    // Going offline, then switching to a part that was never cached, explains itself.
    await page.context().setOffline(true);
    const voicePartTrigger = nowPlaying.getByRole("button", { name: /Voice Part/i });
    await voicePartTrigger.click();
    const voicePartSheet = page.getByRole("dialog", { name: "Choose Voice Part" });
    await voicePartSheet.getByRole("radio", { name: "Alto" }).click();
    await expect(voicePartTrigger).toContainText("Alto");
    await expect(page.getByText("saved offline. Reconnect", { exact: false })).toBeVisible();

    // Switching back to the cached part clears the message.
    await voicePartTrigger.click();
    await page
      .getByRole("dialog", { name: "Choose Voice Part" })
      .getByRole("radio", {
        name: "Choir Mix",
      })
      .click();
    await expect(voicePartTrigger).toContainText("Choir Mix");
    await expect(page.getByText("saved offline. Reconnect", { exact: false })).not.toBeVisible();
  }

  // Reloading the page while offline serves the cached shell and enables offline playback.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Offline Rehearsal" })).toBeVisible();
  const reloadedNowPlaying = page.locator(".public-player__now-playing-card");
  await reloadedNowPlaying.getByRole("button", { name: "Play" }).click();
  await expect(reloadedNowPlaying.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("explains offline state when visiting an un-cached player link while offline", async ({
  page,
}) => {
  await page.goto("/player?token=offline-test-token");
  await expect(page.getByRole("heading", { name: "Offline Rehearsal" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await page.context().setOffline(true);
  await page.goto("/player?token=uncached-token-123");
  await expect(page.getByRole("heading", { name: "You Are Offline" })).toBeVisible();
  await expect(
    page.getByText("This practice player has not been cached on this device yet", {
      exact: false,
    }),
  ).toBeVisible();
});

test("supports offline reload and playback for set-list player mode", async ({ page }) => {
  await page.goto("/player?mode=set-list&token=set-list-token");
  await expect(page.getByRole("heading", { name: "Winter Concert Set List" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Transparent auto-cache stores default track while online.
  const cachedPill = page.locator(".public-player__desktop-panel .public-player__offline-pill");
  await expect(cachedPill.first()).toBeAttached();

  // Reloading the set-list page while offline serves the cached shell and enables offline playback.
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Winter Concert Set List" })).toBeVisible();

  const reloadedNowPlaying = page.locator(".public-player__now-playing-card");
  await reloadedNowPlaying.getByRole("button", { name: "Play" }).click();
  await expect(reloadedNowPlaying.getByRole("button", { name: "Pause" })).toBeVisible();
});
