import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // RELEASE_QUALIFICATION=1 (set by `npm run check:release`) forbids focused
    // tests even outside CI. The key is omitted entirely otherwise so plain
    // `npm test` keeps the default local behavior (`.only` permitted for fast
    // dev iteration); an explicit `allowOnly: undefined` would override it.
    ...(process.env.RELEASE_QUALIFICATION === "1" ? { allowOnly: false } : {}),
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // Future ratchet scaffold (report-only for now; do not enforce yet):
      // Once a baseline is established, uncomment and tune per-directory
      // thresholds for critical areas such as packages/domain/**.
      // thresholds: {
      //   "packages/domain/**": { lines: 80, functions: 80, branches: 75, statements: 80 },
      // },
    },
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.integration.test.ts",
      // UI interaction specs run in vitest.ui.config.ts (jsdom); keep the unit
      // layer in Node so pure domain/Worker tests stay fast (plan §4.12).
      "**/*.ui.test.{ts,tsx}",
    ],
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
