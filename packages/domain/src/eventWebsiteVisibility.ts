export function eventWebsiteVisibility(event: {
  readonly type: "Performance" | "Rehearsal" | "Other";
  readonly isTicketingEnabled: boolean;
  readonly publishOnWebsite: boolean;
}): boolean {
  return event.publishOnWebsite || (event.type === "Performance" && event.isTicketingEnabled);
}
