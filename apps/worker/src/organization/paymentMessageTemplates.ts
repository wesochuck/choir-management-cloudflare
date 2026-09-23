import { renderCommunicationTemplate } from "@choir/domain";

export type PaymentMessageTemplateKind = "donation_confirmation" | "dues_confirmation";

interface PaymentMessageTemplate {
  readonly channel: "Email";
  readonly contentMarkdown: string;
  readonly id: string;
  readonly kind: PaymentMessageTemplateKind;
  readonly subject: string;
  readonly title: string;
}

export const paymentMessageTemplates: readonly PaymentMessageTemplate[] = [
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Thank you for your donation\n\nYour gift to {organizationName} was received.\n\n**Donation receipt**\n\n- **Donation amount:** {paymentAmount}\n- **Payment status:** {paymentStatus}\n\nPlease keep this email for your records.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000013",
    kind: "donation_confirmation",
    subject: "Donation receipt from {organizationName}",
    title: "Donation Payment Receipt",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Dues payment received\n\nYour seasonal dues payment to {organizationName} is confirmed.\n\n- **Amount:** {paymentAmount}\n- **Status:** {paymentStatus}\n\nPlease keep this receipt for your records.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000014",
    kind: "dues_confirmation",
    subject: "Dues payment receipt from {organizationName}",
    title: "Dues Payment Receipt",
  },
] as const;

const previousDonationConfirmationTemplate = {
  contentMarkdown:
    "Hi {singerName},\n\n## Thank you for your donation\n\nYour donation to {organizationName} was received.\n\n- **Amount:** {paymentAmount}\n- **Status:** {paymentStatus}\n\n{{DONATION_RECEIPT_LINK}}\n\nPlease keep this receipt for your records.",
  subject: "Donation receipt from {organizationName}",
  title: "Donation Payment Receipt",
} as const;

function paymentMessageTemplateFor(kind: PaymentMessageTemplateKind): PaymentMessageTemplate {
  const template = paymentMessageTemplates.find((candidate) => candidate.kind === kind);
  if (!template) throw new Error(`Unknown payment message template: ${kind}`);
  return template;
}

function readPaymentMessageTemplate(
  storage: DurableObjectStorage,
  kind: PaymentMessageTemplateKind,
): { readonly hasCanonicalReceiptBody: boolean; readonly template: PaymentMessageTemplate } {
  const fallback = paymentMessageTemplateFor(kind);
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly contentMarkdown: string;
      readonly subject: string;
      readonly title: string;
    }>(
      `SELECT content_markdown AS contentMarkdown, subject, title
       FROM communication_templates
       WHERE id = ? AND is_system = 1 AND channel = 'Email'
       LIMIT 1`,
      fallback.id,
    )
    .toArray()
    .at(0);
  if (!row) {
    return {
      hasCanonicalReceiptBody: kind === "donation_confirmation",
      template: fallback,
    };
  }
  return {
    hasCanonicalReceiptBody:
      kind === "donation_confirmation" &&
      (row.contentMarkdown === fallback.contentMarkdown ||
        row.contentMarkdown === previousDonationConfirmationTemplate.contentMarkdown),
    template: {
      ...fallback,
      contentMarkdown: row.contentMarkdown,
      subject: row.subject,
      title: row.title,
    },
  };
}

export function renderPaymentMessageTemplate(
  storage: DurableObjectStorage,
  kind: PaymentMessageTemplateKind,
  recipientName: string,
  values: Readonly<Record<string, string>>,
): {
  readonly contentMarkdown: string;
  readonly hasCanonicalReceiptBody: boolean;
  readonly subject: string;
} {
  const { hasCanonicalReceiptBody, template } = readPaymentMessageTemplate(storage, kind);
  return {
    contentMarkdown: renderCommunicationTemplate(template.contentMarkdown, recipientName, values),
    hasCanonicalReceiptBody,
    subject: renderCommunicationTemplate(template.subject, recipientName, values),
  };
}

export function seedPaymentSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of paymentMessageTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

export function refreshUnmodifiedPaymentMessageTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of paymentMessageTemplates) {
    sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ? AND is_system = 1 AND updated_at = created_at`,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      template.id,
    );
  }
}

export function refreshUnmodifiedDonationConfirmationTemplate(sql: SqlStorage): void {
  const template = paymentMessageTemplateFor("donation_confirmation");
  const now = new Date().toISOString();
  sql.exec(
    `UPDATE communication_templates
     SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
     WHERE id = ? AND is_system = 1 AND channel = 'Email'
       AND (updated_at = created_at OR
         (title = ? AND subject = ? AND content_markdown = ?))`,
    template.title,
    template.channel,
    template.subject,
    template.contentMarkdown,
    now,
    template.id,
    previousDonationConfirmationTemplate.title,
    previousDonationConfirmationTemplate.subject,
    previousDonationConfirmationTemplate.contentMarkdown,
  );
}
