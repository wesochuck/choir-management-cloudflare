import { seedAuthUser } from "@choir/testkit";
import { env } from "cloudflare:workers";
import { applyD1Migrations, introspectWorkflow, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { beginOrganizationProvisioning } from "../src/control/provisionOrganization";
import { resetFakeFirewallState } from "../src/security/canonicalHostnameFirewall";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { currentOrganizationSchemaVersion } from "../src/organization/schema";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const provisioningWorkflow = requireBinding(env.PROVISIONING_WORKFLOW, "PROVISIONING_WORKFLOW");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  resetFakeFirewallState();
});

afterEach(async () => {
  resetFakeFirewallState();
  await reset();
});

describe("ProvisioningWorkflow", () => {
  it("provisions operational store, owner membership, and owner profile with preferences", async () => {
    const userId = "founding-owner-user";
    const userEmail = "founding.owner@example.test";
    const userName = "Founding Owner";
    await seedAuthUser(controlDatabase, userId, userEmail, userName);

    const startRequestId = crypto.randomUUID();
    const introspector = await introspectWorkflow(provisioningWorkflow);
    const start = await beginOrganizationProvisioning(env, {
      actorUserId: userId,
      name: "Acme Choir",
      requestId: startRequestId,
      slug: "acme-choir",
    });

    const instances = await introspector.get();
    expect(instances).toHaveLength(1);
    await instances[0]?.waitForStatus("complete");

    // Verify D1 organization record is active
    const org = await controlDatabase
      .prepare(`SELECT lifecycle_state, operational_schema_version FROM organizations WHERE id = ?`)
      .bind(start.organizationId)
      .first<{ lifecycle_state: string; operational_schema_version: number }>();
    expect(org?.lifecycle_state).toBe("active");
    expect(org?.operational_schema_version).toBe(currentOrganizationSchemaVersion);

    // Verify D1 member record has profileId
    const member = await controlDatabase
      .prepare(`SELECT id, role, profileId FROM member WHERE organizationId = ? AND userId = ?`)
      .bind(start.organizationId, userId)
      .first<{ id: string; role: string; profileId: string | null }>();
    expect(member?.role).toBe("owner");
    expect(member?.profileId).toBeTruthy();

    // Verify DO profile record has name and admin preferences
    await runInDurableObject<OrganizationStore, undefined>(
      organizationStore.get(organizationStore.idFromName(start.organizationId)),
      (_instance, state) => {
        const rows = state.storage.sql
          .exec(
            `SELECT id, display_name AS displayName, receive_admin_notifications AS receiveAdminNotifications,
                    receive_financial_alerts AS receiveFinancialAlerts,
                    receive_rsvp_decline_notices AS receiveRsvpDeclineNotices
             FROM profiles WHERE id = ?`,
            member?.profileId,
          )
          .toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          displayName: userName,
          id: member?.profileId,
          receiveAdminNotifications: 1,
          receiveFinancialAlerts: 1,
          receiveRsvpDeclineNotices: 1,
        });
      },
    );
  });
});
