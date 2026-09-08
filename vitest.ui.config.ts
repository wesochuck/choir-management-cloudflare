import { defineConfig } from "vitest/config";

// Phase 4 UI interaction layer (plan §4.12): browser-like component tests run
// here under jsdom + React Testing Library. Pure domain/Worker tests stay in
// vitest.config.ts (Node, no DOM) so they remain fast. UI behavior specs use
// the `*.ui.test.{ts,tsx}` suffix and are excluded from the unit config.
export default defineConfig({
  test: {
    // RELEASE_QUALIFICATION=1 (set by `npm run check:release`) forbids focused
    // tests even outside CI. The key is omitted entirely otherwise so plain
    // `npm run test:ui` keeps the default local behavior (`.only` permitted for
    // fast dev iteration); an explicit `allowOnly: undefined` would override it.
    ...(process.env.RELEASE_QUALIFICATION === "1" ? { allowOnly: false } : {}),
    environment: "jsdom",
    setupFiles: ["./vitest.ui.setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    include: ["packages/ui/src/**/*.ui.test.{ts,tsx}", "apps/web/src/**/*.ui.test.{ts,tsx}"],
    testTimeout: 15_000,
  },
});
