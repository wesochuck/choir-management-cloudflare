import { renderCommunicationTemplate } from "@choir/domain";

export type PaymentMessageTemplateKind = "donation_confirmation" | "dues_confirmation";

export interface PaymentMessageTemplate {
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
      "Hello {singerName},\n\nThank you for your donation to {organizationName}.\n\nAmount: {paymentAmount}\nStatus: {paymentStatus}\n\n{{DONATION_RECEIPT_LINK}}\n\nPlease keep this message for your records.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000013",
    kind: "donation_confirmation",
    subject: "Donation receipt from {organizationName}",
    title: "Donation Payment Receipt",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hello {singerName},\n\nYour seasonal dues payment to {organizationName} has been received.\n\nAmount: {paymentAmount}\nStatus: {paymentStatus}\n\nPlease keep this message for your records.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000014",
    kind: "dues_confirmation",
    subject: "Dues payment receipt from {organizationName}",
    title: "Dues Payment Receipt",
  },
] as const;

export function paymentMessageTemplateFor(
  kind: PaymentMessageTemplateKind,
): PaymentMessageTemplate {
  const template = paymentMessageTemplates.find((candidate) => candidate.kind === kind);
  if (!template) throw new Error(`Unknown payment message template: ${kind}`);
  return template;
}

export function readPaymentMessageTemplate(
  storage: DurableObjectStorage,
  kind: PaymentMessageTemplateKind,
): PaymentMessageTemplate {
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
  return row
    ? { ...fallback, contentMarkdown: row.contentMarkdown, subject: row.subject, title: row.title }
    : fallback;
}

export function renderPaymentMessageTemplate(
  storage: DurableObjectStorage,
  kind: PaymentMessageTemplateKind,
  recipientName: string,
  values: Readonly<Record<string, string>>,
): { readonly contentMarkdown: string; readonly subject: string } {
  const template = readPaymentMessageTemplate(storage, kind);
  return {
    contentMarkdown: renderCommunicationTemplate(template.contentMarkdown, recipientName, values),
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
