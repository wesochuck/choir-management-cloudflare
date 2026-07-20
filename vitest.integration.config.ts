import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./apps/worker/wrangler.jsonc",
      },
    }),
  ],
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    include: ["apps/**/*.integration.test.ts"],
    testTimeout: 10_000,
  },
});
