import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { ticketMessageTemplates } from "../src/organization/ticketMessageTemplates";
import { paymentMessageTemplates } from "../src/organization/paymentMessageTemplates";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { applyOrganizationMigration } from "../src/organization/migrations";
import { organizationSchemaMigrations } from "../src/organization/schema";
import {
  getSystemCommunicationTemplateDefault,
  refreshUnmodifiedSystemCommunicationTemplates,
} from "../src/organization/schema/templates";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

afterEach(async () => {
  await reset();
});

describe("Organization schema migrations", () => {
  it("uses the canonical recipient placeholder in ticket and payment system template defaults", () => {
    for (const template of [...ticketMessageTemplates, ...paymentMessageTemplates]) {
      expect(template.contentMarkdown).toContain("Hi {recipientName}");
      expect(template.contentMarkdown).not.toMatch(/\{(?:singerName|buyerName)\}/);
    }

    for (const templateId of [
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000002",
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000004",
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000005",
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000006",
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000010",
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000011",
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000012",
      "5f0ca4a5-7e4c-4e1a-9a1c-000000000015",
    ]) {
      const template = getSystemCommunicationTemplateDefault(templateId);
      if (!template) throw new Error(`System template ${templateId} is unavailable.`);
      expect(template.contentMarkdown).toContain("Hi {recipientName}");
      expect(template.contentMarkdown).not.toMatch(/\{(?:singerName|buyerName)\}/);
    }
  });

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
        organizationEditedPaymentBody: string;
        organizationEditedPaymentSubject: string;
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
         SET title = ?, subject = ?, content_markdown = ?, updated_at = '2099-01-01T00:00:00.000Z'
         WHERE id = ?`,
        "Donation Payment Receipt",
        "Donation receipt from {organizationName}",
        "Hi {singerName},\n\n## Thank you for your donation\n\nYour donation to {organizationName} was received.\n\n- **Amount:** {paymentAmount}\n- **Status:** {paymentStatus}\n\n{{DONATION_RECEIPT_LINK}}\n\nPlease keep this receipt for your records.",
        "5f0ca4a5-7e4c-4e1a-9a1c-000000000013",
      );

      refreshUnmodifiedSystemCommunicationTemplates(state.storage.sql);
      const donationReceiptMigration = organizationSchemaMigrations.find(
        ({ version }) => version === 89,
      );
      if (!donationReceiptMigration) {
        throw new Error("The donation receipt template migration is missing.");
      }
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version = ?", 89);
      applyOrganizationMigration(state.storage, donationReceiptMigration);

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

      state.storage.sql.exec(
        `UPDATE communication_templates
         SET subject = 'Organization donation receipt', content_markdown = 'Organization receipt copy',
           updated_at = '2099-01-01T00:00:00.000Z'
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000013'`,
      );
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version = ?", 89);
      applyOrganizationMigration(state.storage, donationReceiptMigration);
      const organizationEditedPayment = readTemplate("5f0ca4a5-7e4c-4e1a-9a1c-000000000013");

      return {
        customizedBody: customized.contentMarkdown,
        customizedSubject: customized.subject,
        organizationEditedPaymentBody: organizationEditedPayment.contentMarkdown,
        organizationEditedPaymentSubject: organizationEditedPayment.subject,
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
    expect(result.paymentBody).toContain("{paymentAmount}");
    expect(result.paymentBody).not.toContain("{processingFee}");
    expect(result.paymentBody).not.toContain("{totalCharged}");
    expect(result.paymentBody).not.toContain("{paymentDate}");
    expect(result.paymentBody).not.toContain("{{DONATION_RECEIPT_LINK}}");
    expect(result.paymentBody).not.toContain("View your donation receipt");
    expect(result.organizationEditedPaymentSubject).toBe("Organization donation receipt");
    expect(result.organizationEditedPaymentBody).toBe("Organization receipt copy");
    expect(result.customizedSubject).toBe("Custom ticket subject");
    expect(result.customizedBody).toBe("Custom ticket body");
  });

  it("refreshes only unmodified bundle ticket templates in the forward migration", async () => {
    const stub = stores.getByName("organization-bundle-ticket-template-refresh");
    const previousBundleConfirmationBody = [
      "Hi {buyerName},",
      "",
      "## Your ticket bundle is confirmed",
      "",
      "- **Bundle:** {ticketBundleName}",
      "- **Tickets:** {ticketQuantity}",
      "- **Total paid:** {ticketAmount}",
      "",
      "### Included performances",
      "",
      "{{TICKET_EVENT_LIST}}",
      "",
      "{{TICKET_LINK}}",
      "",
      "Open your ticket to display the QR code for admission. Keep this confirmation for your records. We look forward to seeing you.",
    ].join("\n");
    const result = await runInDurableObject<
      OrganizationStore,
      {
        bundleConfirmationBody: string;
        bundleConfirmationSubject: string;
        bundleRefundBody: string;
        bundleRefundSubject: string;
        singleConfirmationBody: string;
        migrationVersionCount: number;
      }
    >(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE communication_templates
         SET title = 'Bundle Ticket Confirmation',
           subject = 'Ticket bundle confirmed: {ticketBundleName}',
           content_markdown = ?, updated_at = '2026-08-01T00:00:00.000Z'
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000008'`,
        previousBundleConfirmationBody,
      );
      state.storage.sql.exec(
        `UPDATE communication_templates
         SET title = 'Organization Bundle Refund', subject = 'Custom refund subject',
           content_markdown = 'Custom bundle refund copy',
           updated_at = '2099-01-01T00:00:00.000Z'
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000018'`,
      );

      const migration = organizationSchemaMigrations.find(({ version }) => version === 90);
      if (!migration) throw new Error("The bundle ticket template migration is missing.");
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version = ?", 90);
      applyOrganizationMigration(state.storage, migration);

      const readTemplate = (id: string) =>
        state.storage.sql
          .exec<{ contentMarkdown: string; subject: string }>(
            `SELECT content_markdown AS contentMarkdown, subject
             FROM communication_templates WHERE id = ?`,
            id,
          )
          .one();
      const confirmation = readTemplate("5f0ca4a5-7e4c-4e1a-9a1c-000000000008");
      const refund = readTemplate("5f0ca4a5-7e4c-4e1a-9a1c-000000000018");
      const singleConfirmation = readTemplate("5f0ca4a5-7e4c-4e1a-9a1c-000000000007");

      return {
        bundleConfirmationBody: confirmation.contentMarkdown,
        bundleConfirmationSubject: confirmation.subject,
        bundleRefundBody: refund.contentMarkdown,
        bundleRefundSubject: refund.subject,
        migrationVersionCount: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM organization_schema_migrations WHERE version = ?",
            90,
          )
          .one().count,
        singleConfirmationBody: singleConfirmation.contentMarkdown,
      };
    });

    const canonicalConfirmation = ticketMessageTemplates.find(
      ({ kind }) => kind === "bundle_confirmation",
    );
    const canonicalSingleConfirmation = ticketMessageTemplates.find(
      ({ kind }) => kind === "confirmation",
    );
    if (!canonicalConfirmation || !canonicalSingleConfirmation) {
      throw new Error("The canonical ticket templates are unavailable.");
    }
    expect(result.bundleConfirmationBody).toBe(canonicalConfirmation.contentMarkdown);
    expect(result.bundleConfirmationSubject).toBe(canonicalConfirmation.subject);
    expect(result.bundleConfirmationBody).toContain("### Included concerts");
    expect(result.bundleConfirmationBody.indexOf("{{TICKET_EVENT_LIST}}")).toBeLessThan(
      result.bundleConfirmationBody.indexOf("{{TICKET_LINK}}"),
    );
    expect(result.bundleRefundSubject).toBe("Custom refund subject");
    expect(result.bundleRefundBody).toBe("Custom bundle refund copy");
    expect(result.singleConfirmationBody).toBe(canonicalSingleConfirmation.contentMarkdown);
    expect(result.migrationVersionCount).toBe(1);
  });

  it("refreshes default refund link wording without replacing customized refund templates", async () => {
    const stub = stores.getByName("organization-refund-ticket-template-refresh");
    const result = await runInDurableObject<
      OrganizationStore,
      {
        readonly bundleRefundBody: string;
        readonly refundBody: string;
        readonly versionCount: number;
      }
    >(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE communication_templates
         SET content_markdown = 'Old refund copy', updated_at = created_at
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000017'`,
      );
      state.storage.sql.exec(
        `UPDATE communication_templates
         SET content_markdown = 'Organization refund copy',
             updated_at = '2099-01-01T00:00:00.000Z'
         WHERE id = '5f0ca4a5-7e4c-4e1a-9a1c-000000000018'`,
      );

      const migration = organizationSchemaMigrations.find(({ version }) => version === 91);
      if (!migration) throw new Error("The refund ticket template migration is missing.");
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version = ?", 91);
      applyOrganizationMigration(state.storage, migration);

      const readBody = (id: string) =>
        state.storage.sql
          .exec<{ readonly contentMarkdown: string }>(
            "SELECT content_markdown AS contentMarkdown FROM communication_templates WHERE id = ?",
            id,
          )
          .one().contentMarkdown;
      return {
        bundleRefundBody: readBody("5f0ca4a5-7e4c-4e1a-9a1c-000000000018"),
        refundBody: readBody("5f0ca4a5-7e4c-4e1a-9a1c-000000000017"),
        versionCount: state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM organization_schema_migrations WHERE version = ?",
            91,
          )
          .one().count,
      };
    });

    const canonicalRefund = ticketMessageTemplates.find(({ kind }) => kind === "refund");
    if (!canonicalRefund) throw new Error("The canonical ticket refund template is unavailable.");
    expect(result.refundBody).toBe(canonicalRefund.contentMarkdown);
    expect(result.refundBody).toContain("Review your order details and refund status");
    expect(result.bundleRefundBody).toBe("Organization refund copy");
    expect(result.versionCount).toBe(1);
  });

  it("adds the refund notification kind while preserving queued history and indexes", async () => {
    const stub = stores.getByName("organization-ticket-refund-notification-kind");
    const result = await runInDurableObject<
      OrganizationStore,
      {
        readonly existing: {
          readonly attempts: number;
          readonly contentMarkdown: string;
          readonly destination: string;
          readonly providerEventId: string | null;
          readonly providerMessageId: string;
          readonly providerStatus: string;
          readonly status: string;
        };
        readonly indexes: string[];
        readonly refundKind: string;
        readonly versionCount: number;
      }
    >(stub, (_instance, state) => {
      const previousSchema = state.storage.sql
        .exec<{ readonly sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ticket_notifications'",
        )
        .one()
        .sql.replace(
          "kind IN ('confirmation', 'reminder', 'refund')",
          "kind IN ('confirmation', 'reminder')",
        );
      state.storage.sql.exec("DROP TABLE ticket_notifications");
      state.storage.sql.exec(previousSchema);
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications
          (id, purchase_id, dedupe_key, kind, destination, subject, content_markdown,
           status, attempts, provider_message_id, failure_detail, scheduled_for,
           created_at, updated_at, provider_status, provider_event_id, provider_reason)
         VALUES ('queued-before-v92', 'purchase-before-v92', 'ticket-confirmation:purchase-before-v92',
           'confirmation', 'legacy@example.test', 'Existing receipt', 'Existing body',
           'queued', 3, 'provider-message-1', 'retrying', '2026-09-20T12:00:00.000Z',
           '2026-09-20T12:00:00.000Z', '2026-09-20T12:00:00.000Z', 'accepted',
           'provider-event-1', 'temporary deferral')`,
      );

      const migration = organizationSchemaMigrations.find(({ version }) => version === 92);
      if (!migration) throw new Error("The refund notification kind migration is missing.");
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version = ?", 92);
      applyOrganizationMigration(state.storage, migration);
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications
          (id, purchase_id, dedupe_key, kind, destination, subject, content_markdown,
           status, scheduled_for, created_at, updated_at)
         VALUES ('refund-after-v92', 'refunded-purchase', 'ticket-refund:refunded-purchase',
           'refund', 'refund@example.test', 'Refund processed', 'Order details',
           'queued', '2026-09-22T12:00:00.000Z', '2026-09-22T12:00:00.000Z',
           '2026-09-22T12:00:00.000Z')`,
      );

      const existing = state.storage.sql
        .exec<{
          readonly attempts: number;
          readonly contentMarkdown: string;
          readonly destination: string;
          readonly providerEventId: string | null;
          readonly providerMessageId: string;
          readonly providerStatus: string;
          readonly status: string;
        }>(
          `SELECT attempts, content_markdown AS contentMarkdown, destination,
             provider_event_id AS providerEventId, provider_message_id AS providerMessageId,
             provider_status AS providerStatus, status
           FROM ticket_notifications WHERE id = 'queued-before-v92'`,
        )
        .one();
      const indexes = state.storage.sql
        .exec<{ readonly name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'index'
             AND name LIKE 'idx_ticket_notifications_%' ORDER BY name`,
        )
        .toArray()
        .map(({ name }) => name);
      return {
        existing,
        indexes,
        refundKind: state.storage.sql
          .exec<{ readonly kind: string }>(
            "SELECT kind FROM ticket_notifications WHERE id = 'refund-after-v92'",
          )
          .one().kind,
        versionCount: state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM organization_schema_migrations WHERE version = ?",
            92,
          )
          .one().count,
      };
    });

    expect(result.existing).toEqual({
      attempts: 3,
      contentMarkdown: "Existing body",
      destination: "legacy@example.test",
      providerEventId: "provider-event-1",
      providerMessageId: "provider-message-1",
      providerStatus: "accepted",
      status: "queued",
    });
    expect(result.indexes).toEqual([
      "idx_ticket_notifications_provider_message",
      "idx_ticket_notifications_purchase",
      "idx_ticket_notifications_status",
    ]);
    expect(result.refundKind).toBe("refund");
    expect(result.versionCount).toBe(1);
  });
});
