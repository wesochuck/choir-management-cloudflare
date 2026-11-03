export const checkoutReminderTemplates = [
  {
    id: "97fb0b60-4841-4dc1-a0c0-7e87cc984601",
    kind: "ticket",
    channel: "Email",
    title: "Incomplete ticket checkout reminder",
    subject: "Your unfinished ticket checkout with {organizationName}",
    contentMarkdown:
      "Hi {recipientName},\n\n## Your unfinished ticket checkout\n\nYou recently started a ticket purchase with {organizationName}, but checkout was not completed. If you meant to finish, you can review your selections and current availability below.\n\n{checkoutSummary}\n\nIf you changed your mind, no action is needed.",
  },
  {
    id: "97fb0b60-4841-4dc1-a0c0-7e87cc984602",
    kind: "donation",
    channel: "Email",
    title: "Incomplete donation checkout reminder",
    subject: "Your unfinished donation to {organizationName}",
    contentMarkdown:
      "Hi {recipientName},\n\n## Your unfinished donation\n\nYou recently started a donation to {organizationName}, but it was not completed. If you meant to finish, you can review your donation below.\n\n{checkoutSummary}\n\nIf you changed your mind, no action is needed. Thank you for considering supporting {organizationName}.",
  },
] as const;

export function isCheckoutReminderTemplate(id: string): boolean {
  return checkoutReminderTemplates.some((template) => template.id === id);
}

export function composeCheckoutReminderActions(
  content: string,
  returnUrl: string,
  stopUrl: string,
) {
  return `${content}\n\n[Review and continue](${returnUrl})\n\n[Stop these reminders](${stopUrl})`;
}

export const checkoutReminderCommonPlaceholderTags = [
  "{organizationName}",
  "{recipientName}",
  "{checkoutSummary}",
  "{returnUrl}",
] as const;
export function checkoutReminderPlaceholderTags(kind: "ticket" | "donation"): readonly string[] {
  return [
    ...checkoutReminderCommonPlaceholderTags,
    ...(kind === "ticket"
      ? ["{eventTitle}", "{eventDate}"]
      : ["{donationAmount}", "{donationLevel}"]),
  ];
}
