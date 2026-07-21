import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
    },
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
