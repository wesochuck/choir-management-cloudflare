// WebKit smoke runner (test plan Phase 6).
//
// Runs only the `webkit-smoke` Playwright project: the small `@webkit-smoke`
//-tagged critical-path set on the Safari engine (mobile navigation, music
// playback, forms/dialogs, mobile-viewport layout; one mocked and one
// full-stack journey per style). Extra CLI arguments pass through to
// Playwright, so a single failure reproduces with e.g.
// `npm run test:e2e:webkit -- apps/web/e2e/player.spec.ts -g "renders practice player"`.
//
// Chromium stays the normal fast path (`npm run test:e2e`); this command is
// the opt-in cross-browser check and `npm run test:e2e:all-browsers` is the
// full local matrix. WebKit is not part of `npm run check:release`.
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "npx",
  [
    "playwright",
    "test",
    "--config",
    "playwright.config.ts",
    "--project=webkit-smoke",
    ...process.argv.slice(2),
  ],
  { cwd: process.cwd(), stdio: "inherit" },
);

if (result.error) {
  console.error(`\n✗ Failed to launch Playwright: ${result.error.message}`);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  console.error(
    "\n✗ WebKit smoke failed. If the output reports a missing browser executable, install it " +
      "once per machine with `npx playwright install webkit` and re-run `npm run test:e2e:webkit`. " +
      'To reproduce one failure, run `npm run test:e2e:webkit -- <spec-file> -g "<test-title>"`.',
  );
  process.exit(result.status ?? 1);
}

console.log("\n✓ WebKit smoke passed (webkit-smoke project).");
