export type TicketMessageTemplateKind =
  "bundle_confirmation" | "bundle_refund" | "confirmation" | "refund" | "reminder";

export interface TicketMessageTemplate {
  readonly channel: "Email";
  readonly contentMarkdown: string;
  readonly id: string;
  readonly kind: TicketMessageTemplateKind;
  readonly subject: string;
  readonly title: string;
}

export const ticketMessageTemplates: readonly TicketMessageTemplate[] = [
  {
    channel: "Email",
    contentMarkdown:
      "Hi {recipientName},\n\n## Your ticket order is confirmed\n\n- **Event:** {eventTitle}\n- **Date:** {eventDate}\n- **Venue:** {venueName}\n- **Address:** {venueAddress}\n- **Tickets:** {ticketQuantity}\n- **Total paid:** {ticketAmount}\n\n{{TICKET_LINK}}\n\nOpen your ticket to display the QR code for admission. Keep this confirmation for your records. We look forward to seeing you.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000007",
    kind: "confirmation",
    subject: "Tickets confirmed: {eventTitle}",
    title: "Ticket Confirmation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {recipientName},\n\n## Your ticket bundle is confirmed\n\n- **Bundle:** {ticketBundleName}\n- **Tickets:** {ticketQuantity}\n- **Total paid:** {ticketAmount}\n\n### Included concerts\n\n{{TICKET_EVENT_LIST}}\n\n{{TICKET_LINK}}\n\nOpen your ticket to display the QR code for admission. Keep this confirmation for your records. We look forward to seeing you.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000008",
    kind: "bundle_confirmation",
    subject: "Ticket bundle confirmed: {ticketBundleName}",
    title: "Bundle Ticket Confirmation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {recipientName},\n\n## Your event is coming up\n\n- **Event:** {eventTitle}\n- **Date:** {eventDate}\n- **Venue:** {venueName}\n- **Address:** {venueAddress}\n- **Tickets:** {ticketQuantity}\n\n{{TICKET_LINK}}\n\nOpen your ticket to display the QR code for admission. We look forward to seeing you.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000009",
    kind: "reminder",
    subject: "Reminder: {eventTitle}",
    title: "Ticket Concert Reminder",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {recipientName},\n\n## Your ticket refund has been processed\n\n- **Event:** {eventTitle}\n- **Date:** {eventDate}\n- **Tickets:** {ticketQuantity}\n- **Refund amount:** {refundAmount}\n- **Refund processed:** {refundDate}\n\nReview your order details and refund status using the link below:\n\n{{TICKET_ORDER_LINK}}\n\nYour refund has been processed by the organization. Your bank or card provider may take additional time to post the credit to your account.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000017",
    kind: "refund",
    subject: "Refund processed: {eventTitle}",
    title: "Ticket Refund Confirmation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {recipientName},\n\n## Your ticket bundle refund has been processed\n\n- **Bundle:** {ticketBundleName}\n- **Tickets:** {ticketQuantity}\n- **Refund amount:** {refundAmount}\n- **Refund processed:** {refundDate}\n\n### Included concerts\n\n{{TICKET_EVENT_LIST}}\n\nReview your order details and refund status using the link below:\n\n{{TICKET_ORDER_LINK}}\n\nYour refund has been processed by the organization. Your bank or card provider may take additional time to post the credit to your account.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000018",
    kind: "bundle_refund",
    subject: "Refund processed: {ticketBundleName}",
    title: "Bundle Ticket Refund Confirmation",
  },
] as const;

function ticketMessageTemplateFor(kind: TicketMessageTemplateKind): TicketMessageTemplate {
  const template = ticketMessageTemplates.find((candidate) => candidate.kind === kind);
  if (!template) throw new Error(`Unknown ticket message template: ${kind}`);
  return template;
}

export function readTicketMessageTemplate(
  storage: DurableObjectStorage,
  kind: TicketMessageTemplateKind,
): TicketMessageTemplate {
  const fallback = ticketMessageTemplateFor(kind);
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly contentMarkdown: string;
      readonly id: string;
      readonly subject: string;
      readonly title: string;
    }>(
      `SELECT id, title, subject, content_markdown AS contentMarkdown
       FROM communication_templates WHERE id = ? LIMIT 1`,
      fallback.id,
    )
    .toArray()
    .at(0);
  return row
    ? { ...fallback, contentMarkdown: row.contentMarkdown, subject: row.subject, title: row.title }
    : fallback;
}

export function refreshUnmodifiedTicketRefundTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of ticketMessageTemplates.filter(
    ({ kind }) => kind === "refund" || kind === "bundle_refund",
  )) {
    sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ? AND is_system = 1 AND channel = 'Email' AND updated_at = created_at`,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      template.id,
    );
  }
}
