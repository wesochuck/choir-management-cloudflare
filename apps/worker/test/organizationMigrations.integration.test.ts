import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { applyOrganizationMigration } from "../src/organization/migrations";

const stores = env.ORGANIZATION_STORE;

if (!stores) throw new Error("The ORGANIZATION_STORE integration-test binding is missing.");

afterEach(async () => {
  await reset();
});

describe("Organization schema migrations", () => {
  it("rolls back a migration and its version marker together", async () => {
    const stub = stores.getByName("organization-migration-atomicity");
    const failedMigration = {
      statements: [
        "CREATE TABLE migration_atomicity_probe (id INTEGER PRIMARY KEY)",
        "THIS IS NOT VALID SQL",
      ],
      version: 10_000,
    } as const;

    await expect(
      runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
        applyOrganizationMigration(state.storage, failedMigration);
        return null;
      }),
    ).rejects.toThrow();

    await expect(
      runInDurableObject<OrganizationStore, { tableExists: number; versionExists: number }>(
        stub,
        (_instance, state) => ({
          tableExists: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
              "migration_atomicity_probe",
            )
            .one().count,
          versionExists: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM organization_schema_migrations WHERE version = ?",
              failedMigration.version,
            )
            .one().count,
        }),
      ),
    ).resolves.toEqual({ tableExists: 0, versionExists: 0 });

    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      applyOrganizationMigration(state.storage, {
        statements: ["CREATE TABLE migration_atomicity_probe (id INTEGER PRIMARY KEY)"],
        version: failedMigration.version,
      });
      return null;
    });

    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM organization_schema_migrations WHERE version = ?",
              failedMigration.version,
            )
            .one().count,
      ),
    ).resolves.toBe(1);
  });
});
