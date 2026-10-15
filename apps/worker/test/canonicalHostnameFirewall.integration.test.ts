import { provisionOrganization, seedAuthUser } from "@choir/testkit";
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  getFakeFirewallState,
  readDesiredCanonicalHostnames,
  reconcileCanonicalHostnameFirewall,
  resetFakeFirewallState,
  type CanonicalHostnameFirewallEnv,
} from "../src/security/canonicalHostnameFirewall";

function requireBinding<T>(bindingValue: T | undefined, name: string): T {
  if (bindingValue === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return bindingValue;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  resetFakeFirewallState();
});

afterEach(async () => {
  resetFakeFirewallState();
  await reset();
});

describe("Canonical Hostname Firewall integration", () => {
  it("reconciles desired canonical hostnames from D1 and updates fake provider state", async () => {
    await seedAuthUser(controlDatabase, "test-user-1", "user1@example.com", "Test User");

    // 1. Provision an organization
    await provisionOrganization(controlDatabase, organizationStores, {
      id: "org-alpha",
      name: "Alpha Chorus",
      role: "admin",
      slug: "alphachoir",
      userId: "test-user-1",
    });

    // 2. Add an explicit production canonical hostname to D1
    const now = new Date().toISOString();
    await controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind("dom-alpha", "org-alpha", "alphachoir.musicsite.org", now, now)
      .run();

    // Also add a custom_public domain to verify it is excluded from the WAF canonical allowlist
    await controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'custom_public', 'active', 1, ?, ?)`,
      )
      .bind("dom-custom", "org-alpha", "tickets.customchoir.org", now, now)
      .run();

    const firewallEnv: CanonicalHostnameFirewallEnv = {
      APP_ENV: "production",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "fake",
      CONTROL_DB: controlDatabase,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };

    // 3. Verify desired selection
    const desired = await readDesiredCanonicalHostnames(
      controlDatabase,
      "musicsite.org",
      "production",
    );
    expect(desired).toContain("alphachoir.musicsite.org");
    expect(desired).not.toContain("tickets.customchoir.org");

    // 4. Run reconciliation
    const result = await reconcileCanonicalHostnameFirewall(firewallEnv);
    expect(result.changed).toBe(true);
    expect(result.action).toBe("block");
    expect(result.desiredHostnameCount).toBe(desired.length);

    const state = getFakeFirewallState();
    expect(state).not.toBeNull();
    expect(state?.action).toBe("block");
    expect(state?.expression).toContain('"alphachoir.musicsite.org"');
    expect(state?.expression).not.toContain("tickets.customchoir.org");

    // 5. Disable the canonical hostname
    await controlDatabase
      .prepare("UPDATE organization_domains SET status = 'disabled' WHERE id = ?")
      .bind("dom-alpha")
      .run();

    // 6. Reconcile again
    const reconciledAfterDisable = await reconcileCanonicalHostnameFirewall(firewallEnv);
    expect(reconciledAfterDisable.changed).toBe(true);

    const stateAfterDisable = getFakeFirewallState();
    expect(stateAfterDisable?.expression).not.toContain('"alphachoir.musicsite.org"');
  });

  it("strictly separates staging and production namespaces in D1 selection and expressions", async () => {
    const now = new Date().toISOString();

    // Add production host and staging host
    await controlDatabase.batch([
      controlDatabase
        .prepare(
          `INSERT INTO organizations (id, name, slug, lifecycle_state, durable_object_key, created_at, updated_at)
           VALUES ('org-1', 'Org 1', 'org1', 'active', 'key-1', ?, ?)`,
        )
        .bind(now, now),
      controlDatabase
        .prepare(
          `INSERT INTO organization_domains
            (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
           VALUES
             ('d-prod', 'org-1', 'prodchoir.musicsite.org', 'canonical', 'active', 1, ?, ?),
             ('d-stage', 'org-1', 'stagechoir.staging.musicsite.org', 'canonical', 'active', 1, ?, ?)`,
        )
        .bind(now, now, now, now),
    ]);

    // Check production reading
    const prodHosts = await readDesiredCanonicalHostnames(
      controlDatabase,
      "musicsite.org",
      "production",
    );
    expect(prodHosts).toContain("prodchoir.musicsite.org");
    expect(prodHosts).not.toContain("stagechoir.staging.musicsite.org");

    // Check staging reading
    const stagingHosts = await readDesiredCanonicalHostnames(
      controlDatabase,
      "musicsite.org",
      "staging",
    );
    expect(stagingHosts).toContain("stagechoir.staging.musicsite.org");
    expect(stagingHosts).not.toContain("prodchoir.musicsite.org");

    // Check staging firewall reconciliation defaults to log action
    const stagingEnv: CanonicalHostnameFirewallEnv = {
      APP_ENV: "staging",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "fake",
      CONTROL_DB: controlDatabase,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };
    const stagingResult = await reconcileCanonicalHostnameFirewall(stagingEnv);
    expect(stagingResult.action).toBe("log");
    expect(getFakeFirewallState()?.expression).toContain('"stagechoir.staging.musicsite.org"');
    expect(getFakeFirewallState()?.expression).not.toContain("prodchoir.musicsite.org");
  });
});
