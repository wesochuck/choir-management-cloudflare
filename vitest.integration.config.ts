/* Known benign log noise: miniflare's per-file isolated-storage teardown can emit one
 * "Application called deleteAllDurableObjects()" uncaught-exception line when a Durable
 * Object from the previous file still has in-flight work. It does not affect results;
 * pool-workers 0.22.0 was evaluated and made the noise worse, so stay on 0.20.1.
 *
 * Parallelism (Phase 5, 2026-09-07): fileParallelism with maxWorkers 2 measured ~37%
 * faster than serial (~116s vs ~185s) across 4 parallel + 2 serial full-suite runs with
 * zero failures and byte-identical benign log noise. State-isolation rules live in
 * apps/worker/test/organization.integration.fixture.ts; full evidence and the re-run
 * procedure live in docs/runbooks/integration-test-isolation.md. Force serial locally
 * with `npx vitest run --config vitest.integration.config.ts --no-file-parallelism`. */
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
    // RELEASE_QUALIFICATION=1 (set by `npm run check:release`) forbids focused
    // tests even outside CI. The key is omitted entirely otherwise so plain
    // integration runs keep the default local `.only` behavior.
    ...(process.env.RELEASE_QUALIFICATION === "1" ? { allowOnly: false } : {}),
    exclude: ["**/node_modules/**", "**/dist/**"],
    fileParallelism: true,
    include: ["apps/**/*.integration.test.ts"],
    maxWorkers: 2,
    provide: {
      controlMigrations: await readD1Migrations("apps/worker/src/control/migrations"),
    },
    hookTimeout: 15_000,
    teardownTimeout: 10_000,
    testTimeout: 15_000,
  },
}));
