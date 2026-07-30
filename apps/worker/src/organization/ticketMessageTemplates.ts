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
      "Hello {singerName},\n\nYour ticket order is confirmed.\n\nEvent: {eventTitle}\nDate: {eventDate}\nQuantity: {ticketQuantity}\nTotal paid: {ticketAmount}\n\n{{TICKET_LINK}}\n\nWe look forward to seeing you!",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000007",
    kind: "confirmation",
    subject: "Your tickets for {eventTitle}",
    title: "Ticket Confirmation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hello {singerName},\n\nYour bundle order is confirmed.\n\nBundle: {ticketBundleName}\nQuantity: {ticketQuantity}\nTotal paid: {ticketAmount}\n\n{{TICKET_LINK}}\n\nWe look forward to seeing you!",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000008",
    kind: "bundle_confirmation",
    subject: "Your {ticketBundleName} order is confirmed",
    title: "Bundle Ticket Confirmation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hello {singerName},\n\nThis is a reminder for {eventTitle}.\n\nDate: {eventDate}\nQuantity: {ticketQuantity}\n\n{{TICKET_LINK}}\n\nWe look forward to seeing you!",
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
