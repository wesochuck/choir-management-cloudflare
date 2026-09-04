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

test("caches the open event offline and explains uncached parts", async ({ page }) => {
  await page.goto("/player?token=offline-test-token");
  await expect(page.getByRole("heading", { name: "Offline Rehearsal" })).toBeVisible();

  // Transparent auto-cache stores the default part while online.
  const cachedPill = page.locator(".public-player__desktop-panel .public-player__offline-pill");
  await expect(cachedPill.first()).toBeAttached();

  // Cached playback works through the blob URL.
  const nowPlaying = page.locator(".public-player__now-playing-card");
  await nowPlaying.getByRole("button", { name: "Play" }).click();
  await expect(nowPlaying.getByRole("button", { name: "Pause" })).toBeVisible();

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
});
