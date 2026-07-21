import { env } from "cloudflare:workers";
import { applyD1Migrations, introspectWorkflow, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { beginFleetSchemaPreparation } from "../src/control/prepareFleetSchema";
import { currentOrganizationSchemaVersion } from "../src/organization/schema";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const fleetSchemaWorkflow = requireBinding(env.FLEET_SCHEMA_WORKFLOW, "FLEET_SCHEMA_WORKFLOW");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
});

afterEach(async () => {
  await reset();
});

describe("fleet Organization schema preparation", () => {
  it("chains bounded batches and verifies each Durable Object identity before advancing D1", async () => {
    const organizations = Array.from({ length: 21 }, (_, index) => {
      const suffix = String(index).padStart(2, "0");
      return {
        id: `fleet-organization-${suffix}`,
        name: `Fleet Organization ${suffix}`,
        slug: `fleet-${suffix}`,
      };
    });
    for (const organization of organizations) {
      const timestamp = "2026-07-21T18:00:00.000Z";
      await controlDatabase
        .prepare(
          `INSERT INTO organizations
            (id, name, slug, lifecycle_state, durable_object_key,
             operational_schema_version, created_at, updated_at, provisioned_at)
           VALUES (?, ?, ?, 'active', ?, 0, ?, ?, ?)`,
        )
        .bind(
          organization.id,
          organization.name,
          organization.slug,
          organization.id,
          timestamp,
          timestamp,
          timestamp,
        )
        .run();
      const response = await organizationStore
        .get(organizationStore.idFromName(organization.id))
        .fetch("https://organization.internal/internal/provision", {
          body: JSON.stringify({
            actorUserId: "platform-administrator-test",
            canonicalHostname: `${organization.slug}.localhost`,
            canonicalStatus: "active",
            name: organization.name,
            organizationId: organization.id,
            requestId: crypto.randomUUID(),
            slug: organization.slug,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
      expect(response.status).toBe(200);
    }

    const introspector = await introspectWorkflow(fleetSchemaWorkflow);
    try {
      const started = await beginFleetSchemaPreparation(
        { CONTROL_DB: controlDatabase, FLEET_SCHEMA_WORKFLOW: fleetSchemaWorkflow },
        {
          actorUserId: "platform-administrator-test",
          requestId: "44444444-4444-4444-8444-444444444444",
        },
      );
      let instances = await introspector.get();
      expect(instances).toHaveLength(1);
      await instances[0]?.waitForStatus("complete");
      instances = await introspector.get();
      expect(instances).toHaveLength(2);
      await Promise.all(instances.map((instance) => instance.waitForStatus("complete")));

      await expect(
        controlDatabase
          .prepare(
            `SELECT status, processed_count AS processedCount,
              target_version AS targetVersion
             FROM fleet_schema_preparations WHERE id = ?`,
          )
          .bind(started.runId)
          .first(),
      ).resolves.toEqual({
        processedCount: 21,
        status: "completed",
        targetVersion: currentOrganizationSchemaVersion,
      });
      await expect(
        controlDatabase
          .prepare(
            `SELECT COUNT(*) AS count FROM organizations
             WHERE operational_schema_version = ?`,
          )
          .bind(currentOrganizationSchemaVersion)
          .first<number>("count"),
      ).resolves.toBe(21);

      const mismatched = await organizationStore
        .get(organizationStore.idFromName(organizations[0]?.id ?? "missing"))
        .fetch("https://organization.internal/internal/schema/prepare", {
          body: JSON.stringify({
            organizationId: organizations[1]?.id,
            targetVersion: currentOrganizationSchemaVersion,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
      expect(mismatched.status).toBe(409);
    } finally {
      await introspector.dispose();
    }
  });

  it("marks the run failed when a registry row cannot prove its Durable Object identity", async () => {
    const timestamp = "2026-07-21T18:00:00.000Z";
    await controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key,
           operational_schema_version, created_at, updated_at, provisioned_at)
         VALUES ('missing-store', 'Missing Store', 'missing-store', 'active',
           'missing-store', 0, ?, ?, ?)`,
      )
      .bind(timestamp, timestamp, timestamp)
      .run();

    const introspector = await introspectWorkflow(fleetSchemaWorkflow);
    try {
      const started = await beginFleetSchemaPreparation(
        { CONTROL_DB: controlDatabase, FLEET_SCHEMA_WORKFLOW: fleetSchemaWorkflow },
        {
          actorUserId: "platform-administrator-test",
          requestId: "55555555-5555-4555-8555-555555555555",
        },
      );
      const instances = await introspector.get();
      await instances[0]?.waitForStatus("errored");
      await expect(
        controlDatabase
          .prepare(
            `SELECT status, failure_code AS failureCode
             FROM fleet_schema_preparations WHERE id = ?`,
          )
          .bind(started.runId)
          .first(),
      ).resolves.toEqual({
        failureCode: "workflow_segment_failed",
        status: "failed",
      });
    } finally {
      await introspector.dispose();
    }
  });
});
