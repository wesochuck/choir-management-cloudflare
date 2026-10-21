import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Block the shell caching service worker so Playwright's network routing can
// reliably intercept synthetic media fixture fetches across track changes in WebKit.
test.use({ serviceWorkers: "block" });

// Real codec/WASM/Web Audio path. No HTMLMediaElement or AudioContext mocks.
// This does not establish physical-device or lock-screen compatibility.
test("bundled analyzer loads under CSP and real MP3 produces Web Audio output @webkit-smoke", async ({
  page,
}) => {
  const worker = readdirSync("apps/web/dist/assets").find((name) =>
    /^analysis\.worker-.*\.js$/.test(name),
  );
  expect(worker).toBeTruthy();
  const headers = readFileSync("apps/web/public/_headers", "utf8");
  const csp = headers
    .split("\n")
    .find((line) => line.trim().startsWith("Content-Security-Policy:"))
    ?.trim()
    .slice("Content-Security-Policy:".length)
    .trim();
  if (!worker || !csp) throw new Error("Build the web artifact first.");
  const mp3 = readFileSync("apps/web/src/account/loudness/fixtures/44100-1-vbr.mp3");
  await page.route("**/loudness-fixture.mp3", (route) =>
    route.fulfill({ body: mp3, contentType: "audio/mpeg" }),
  );
  await page.route("**/loudness-verification", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "content-security-policy": csp },
      body: '<button type="button">Start audio verification</button><output></output><audio src="/loudness-fixture.mp3"></audio><script src="/loudness-verification.js"></script>',
    }),
  );
  await page.route("**/loudness-verification.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    const output = document.querySelector('output');
    document.querySelector('button').onclick = async () => {
      try {
        const audio = document.querySelector('audio');
        const context = new AudioContext();
        const gain = context.createGain(); gain.gain.value = 10 ** (2/20);
        const analyser = context.createAnalyser();
        context.createMediaElementSource(audio).connect(gain); gain.connect(analyser); analyser.connect(context.destination);
        await Promise.all([context.resume(), audio.play()]);
        let energy = 0;
        const pcm = new Float32Array(analyser.fftSize);
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 25)); analyser.getFloatTimeDomainData(pcm);
          energy = Math.max(energy, ...pcm.map(Math.abs));
        }
        audio.pause(); await context.close();
        const worker = new Worker('/assets/${worker}', {type:'module'});
        worker.onmessage = event => {
          if (event.data.type === 'ready') { output.textContent = JSON.stringify({energy, ...event.data.result}); worker.terminate(); }
          if (event.data.type === 'failed') { output.textContent = JSON.stringify(event.data); worker.terminate(); }
        };
        worker.onerror = () => { output.textContent = 'Worker failed'; };
        const response = await fetch('/loudness-fixture.mp3');
        worker.postMessage({type:'analyze', file:new File([await response.blob()], 'fixture.mp3', {type:'audio/mpeg'})});
      } catch (error) { output.textContent = String(error); }
    };
  `,
    }),
  );
  await page.goto("/loudness-verification");
  await page.getByRole("button", { name: "Start audio verification" }).click();
  await expect(page.locator("output")).toContainText('"integratedLufs"');
  const result = await page.locator("output").textContent();
  expect(result).toContain('"decoderVersion":"1.0.3"');
  expect(result).not.toContain('"energy":0,');
});

test("shared player plays real cached MP3s and reuses its gain graph across tracks @webkit-smoke", async ({
  page,
}) => {
  const enabled = process.env.VITE_PRACTICE_LOUDNESS_ENABLED === "true";
  const first = "3a2a96d6-8da6-4fb4-8361-7e535a6bfc53";
  const second = "072c21e5-f1d2-4459-951d-c8c161ac100b";
  await page.addInitScript(() => {
    const NativeContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends NativeContext {
      override createMediaElementSource(audio: HTMLMediaElement): MediaElementAudioSourceNode {
        const previous: unknown = Reflect.get(window, "loudnessSourceCount");
        Reflect.set(window, "loudnessSourceCount", typeof previous === "number" ? previous + 1 : 1);
        return super.createMediaElementSource(audio);
      }
      override createGain(): GainNode {
        const node = super.createGain();
        Reflect.set(window, "loudnessGainNode", node);
        return node;
      }
    };
  });
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/api/public/player-details", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        eventId: "event-test",
        eventTitle: "Real playback",
        eventStartsAt: "",
        items: [
          { title: "First recording", trackFileIds: { tutti: first } },
          { title: "Second recording", trackFileIds: { tutti: second } },
        ],
        loudnessByFileId: {
          [first]: {
            analysisVersion: 1,
            contentVersion: "upload-v1",
            integratedLufs: -26,
            truePeakDbtp: -12,
          },
        },
      },
    }),
  );
  const bytes = readFileSync("apps/web/src/account/loudness/fixtures/44100-1-vbr.mp3");
  await page.route("**/api/public/player/media/**", (route) =>
    route.fulfill({
      body: bytes,
      contentType: "audio/mpeg",
      headers: { "x-audio-content-version": "upload-v1" },
    }),
  );
  await page.goto("/player?token=synthetic-loudness-test");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio) => (audio instanceof HTMLAudioElement ? audio.currentTime : 0)),
    )
    .toBeGreaterThan(0);
  if (enabled) {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const value: unknown = Reflect.get(window, "loudnessGainNode");
          return value instanceof GainNode ? value.gain.value : 0;
        }),
      )
      .toBeCloseTo(10 ** (8 / 20), 4);
    expect(
      await page.evaluate(() => {
        const value: unknown = Reflect.get(window, "loudnessSourceCount");
        return typeof value === "number" ? value : 0;
      }),
    ).toBe(1);
  }
  await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio) => (audio instanceof HTMLAudioElement ? audio.currentTime : 0)),
    )
    .toBeGreaterThan(0);
  if (enabled) {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const value: unknown = Reflect.get(window, "loudnessGainNode");
          return value instanceof GainNode ? value.gain.value : 0;
        }),
      )
      .toBeCloseTo(1, 4);
    expect(
      await page.evaluate(() => {
        const value: unknown = Reflect.get(window, "loudnessSourceCount");
        return typeof value === "number" ? value : 0;
      }),
    ).toBe(1);
  }
  expect(new URL(page.url()).searchParams.get("token")).toBe("synthetic-loudness-test");
});
