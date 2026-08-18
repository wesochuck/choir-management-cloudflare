import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { applyOrganizationMigration } from "../src/organization/migrations";
import { refreshUnmodifiedPaymentMessageTemplates } from "../src/organization/paymentMessageTemplates";
import { refreshUnmodifiedSystemCommunicationTemplates } from "../src/organization/schema/templates";

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

  it("refreshes pristine system email copy without overwriting customized templates", async () => {
    const stub = stores.getByName("organization-template-refresh");
    const result = await runInDurableObject<
      OrganizationStore,
      {
        customizedBody: string;
        customizedSubject: string;
        paymentBody: string;
        paymentSubject: string;
        refreshedBody: string;
        refreshedSubject: string;
      }
    >(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE communication_templates
         SET subject = 'Old announcement', content_markdown = 'Old announcement body',
           updated_at = created_at
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000001'`,
      );
      state.storage.sql.exec(
        `UPDATE communication_templates
         SET subject = 'Custom ticket subject', content_markdown = 'Custom ticket body',
           updated_at = '2099-01-01T00:00:00.000Z'
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000007'`,
      );
      state.storage.sql.exec(
        `UPDATE communication_templates
         SET subject = 'Old receipt', content_markdown = 'Old receipt body',
           updated_at = created_at
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000013'`,
      );

      refreshUnmodifiedSystemCommunicationTemplates(state.storage.sql);
      refreshUnmodifiedPaymentMessageTemplates(state.storage.sql);

      const readTemplate = (id: string) =>
        state.storage.sql
          .exec<{ contentMarkdown: string; subject: string }>(
            `SELECT content_markdown AS contentMarkdown, subject
             FROM communication_templates WHERE id = ?`,
            id,
          )
          .one();
      const refreshed = readTemplate("5f0ca4a5-7e4c-4e1a-9a1c-000000000001");
      const customized = readTemplate("5f0ca4a5-7e4c-4e1a-9a1c-000000000007");
      const payment = readTemplate("5f0ca4a5-7e4c-4e1a-9a1c-000000000013");
      return {
        customizedBody: customized.contentMarkdown,
        customizedSubject: customized.subject,
        paymentBody: payment.contentMarkdown,
        paymentSubject: payment.subject,
        refreshedBody: refreshed.contentMarkdown,
        refreshedSubject: refreshed.subject,
      };
    });

    expect(result.refreshedSubject).toBe("Choir update: [Key message]");
    expect(result.refreshedBody).toContain("Lead with the most important update");
    expect(result.paymentSubject).toBe("Donation receipt from {organizationName}");
    expect(result.paymentBody).toContain("Thank you for your donation");
    expect(result.customizedSubject).toBe("Custom ticket subject");
    expect(result.customizedBody).toBe("Custom ticket body");
  });
});
