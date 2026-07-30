import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: "integration-test-only-secret-with-at-least-32-characters",
          SIGNED_LINK_SECRET:
            "different-integration-signed-link-secret-with-at-least-32-characters",
        },
      },
      wrangler: {
        configPath: "./apps/worker/wrangler.jsonc",
      },
    }),
  ],
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    fileParallelism: false,
    include: ["apps/**/*.integration.test.ts"],
    provide: {
      controlMigrations: await readD1Migrations("apps/worker/src/control/migrations"),
    },
    testTimeout: 10_000,
  },
}));
