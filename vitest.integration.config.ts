/* Known benign log noise: miniflare's per-file isolated-storage teardown can emit one
 * "Application called deleteAllDurableObjects()" uncaught-exception line when a Durable
 * Object from the previous file still has in-flight work. It does not affect results;
 * pool-workers 0.22.0 was evaluated and made the noise worse, so stay on 0.20.1. */
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
    hookTimeout: 15_000,
    teardownTimeout: 10_000,
    testTimeout: 15_000,
  },
}));
