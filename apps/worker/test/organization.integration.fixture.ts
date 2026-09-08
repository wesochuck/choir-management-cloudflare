/**
 * Shared Organization integration-test isolation harness.
 *
 * State-isolation rules (Phase 5, plan section 4.15). Read before adding or
 * editing an `*.integration.test.ts` file:
 *
 * 1. Every integration file owns its Miniflare isolated storage. Seed all
 *    D1/DO state in `beforeEach` via {@link setupOrganizationIntegration} and
 *    release it in `afterEach` via {@link teardownOrganizationIntegration}.
 *    Never rely on state left behind by another file or another test.
 * 2. Tests within one file must not depend on execution order. There is no
 *    `beforeAll`/`afterAll` shared mutable state; each `it` starts from the
 *    same seed and signs in with its own session cookie.
 * 3. Tenant isolation is per test, not per file. Every test uses the
 *    `alpha.localhost` / `bravo.localhost` pair (or its own seeded slugs) and
 *    must assert cross-organization rejection where the route touches
 *    operational data. Reusing the same slugs across files is safe because
 *    storage is isolated per file; do not invent unique slugs per file to
 *    "avoid collisions" -- that hides leakage instead of preventing it.
 * 4. Keep provider side effects fake (`EXTERNAL_EFFECTS_MODE: "fake"` is the
 *    test default) and clear captured platform emails as part of setup so OTP
 *    reads cannot observe a previous test's messages.
 * 5. New per-file boilerplate (`requireBinding` copies, hand-rolled
 *    migration/seed/provision sequences) belongs here, not in test files.
 *    `auth.*` suites keep their own `auth.integration.fixture.ts` because
 *    they exercise the Better Auth session layer directly; ticketing suites
 *    keep `ticketing.integration.fixture.ts` for the custom public-domain
 *    seed. Everything else should use this harness.
 *
 * DO-runtime note: this harness runs in the Vitest host process (it calls
 * `applyD1Migrations`/`reset` from `cloudflare:test`), never inside the
 * Organization Durable Object, so it stays outside the hibernation-friendly
 * runtime boundary enforced by `npm run check:do-runtime`.
 */

import type { D1Database } from "@cloudflare/workers-types";
import {
  provisionOrganization,
  seedAuthUser,
  type OrganizationStoreNamespace,
} from "@choir/testkit";
import { applyD1Migrations, reset } from "cloudflare:test";
import { inject } from "vitest";

import { clearCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";

export function requireIntegrationBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

export interface SeededOrganization {
  readonly id: string;
  readonly slug: string;
  readonly name?: string | undefined;
  readonly role?: "admin" | "member" | "owner" | undefined;
}

export interface OrganizationIntegrationSetup {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly organizations: readonly SeededOrganization[];
}

export async function setupOrganizationIntegration(
  database: D1Database,
  stores: OrganizationStoreNamespace,
  setup: OrganizationIntegrationSetup,
): Promise<void> {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, setup.userId, setup.email, setup.displayName);
  for (const organization of setup.organizations) {
    await provisionOrganization(database, stores, {
      id: organization.id,
      slug: organization.slug,
      userId: setup.userId,
      ...(organization.name === undefined ? {} : { name: organization.name }),
      ...(organization.role === undefined ? {} : { role: organization.role }),
    });
  }
}

export async function teardownOrganizationIntegration(): Promise<void> {
  await reset();
}
