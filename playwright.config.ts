import { defineConfig, devices } from "@playwright/test";

// RELEASE_QUALIFICATION=1 is set by `npm run check:release` so focused tests
// fail full release qualification even outside CI. Plain `npm run test:e2e`
// still permits `.only` locally for fast dev iteration.
const isReleaseQualification = process.env.RELEASE_QUALIFICATION === "1";

// WebKit smoke tags (plan Phase 6). Tests whose title contains `@webkit-smoke`
// form the small cross-browser smoke set: mobile navigation, music playback,
// forms/dialogs, and mobile-viewport layout on the Safari engine, plus one
// mocked and one full-stack journey per style. The tag is only a selector for
// the `webkit-smoke` project below; Chromium projects keep running every test,
// tagged or not.
const webkitSmokeTag = /@webkit-smoke/;

export default defineConfig({
  testDir: "./apps/web/e2e",
  forbidOnly: isReleaseQualification || Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: isReleaseQualification
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : process.env.CI
      ? "github"
      : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    // Clipboard permissions are Chromium-only: WebKit rejects
    // `clipboard-read`/`clipboard-write` as unknown permissions, so they are
    // granted per Chromium project instead of globally.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], permissions: ["clipboard-read", "clipboard-write"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], permissions: ["clipboard-read", "clipboard-write"] },
    },
    // Smaller WebKit smoke project (plan Phase 6). Desktop Safari exercises
    // the non-Chromium engine without making every local run a full browser
    // matrix: `npm run test:e2e` stays Chromium-only, `npm run test:e2e:webkit`
    // runs just this project, and `npm run test:e2e:all-browsers` runs both.
    // Needs `npx playwright install webkit` once per machine. Firefox is
    // deliberately deferred (periodic-only, see apps/web/e2e/fixtures/README.md).
    // `devices["Desktop Safari"]` carries `defaultBrowserType: "webkit"`, so no
    // explicit browserName is needed.
    { name: "webkit-smoke", grep: webkitSmokeTag, use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node scripts/run-e2e-servers.mjs",
    port: 4173,
    reuseExistingServer: !process.env.CI && !isReleaseQualification,
  },
});
