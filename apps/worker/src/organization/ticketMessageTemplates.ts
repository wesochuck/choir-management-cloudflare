export type TicketMessageTemplateKind = "bundle_confirmation" | "confirmation" | "reminder";

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
      "Hi {singerName},\n\n## Your ticket order is confirmed\n\n- **Event:** {eventTitle}\n- **Date:** {eventDate}\n- **Tickets:** {ticketQuantity}\n- **Total paid:** {ticketAmount}\n\n{{TICKET_LINK}}\n\nOpen your tickets before arriving and keep this confirmation for your records. We look forward to seeing you.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000007",
    kind: "confirmation",
    subject: "Tickets confirmed: {eventTitle}",
    title: "Ticket Confirmation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Your ticket bundle is confirmed\n\n- **Bundle:** {ticketBundleName}\n- **Tickets:** {ticketQuantity}\n- **Total paid:** {ticketAmount}\n\n{{TICKET_LINK}}\n\nOpen your tickets before arriving and keep this confirmation for your records. We look forward to seeing you.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000008",
    kind: "bundle_confirmation",
    subject: "Ticket bundle confirmed: {ticketBundleName}",
    title: "Bundle Ticket Confirmation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Your event is coming up\n\n- **Event:** {eventTitle}\n- **Date:** {eventDate}\n- **Tickets:** {ticketQuantity}\n\n{{TICKET_LINK}}\n\nOpen your tickets before arriving. We look forward to seeing you.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000009",
    kind: "reminder",
    subject: "Reminder: {eventTitle}",
    title: "Ticket Concert Reminder",
  },
] as const;

export function ticketMessageTemplateFor(kind: TicketMessageTemplateKind): TicketMessageTemplate {
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
