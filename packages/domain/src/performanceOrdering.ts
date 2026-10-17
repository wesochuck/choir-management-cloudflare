/** Put ticket-enabled Performances first, retaining date order within each group. */
export function prioritizeTicketedPerformances<T extends { readonly isTicketingEnabled: boolean }>(
  performances: readonly T[],
): T[] {
  const ticketed: T[] = [];
  const others: T[] = [];
  for (const performance of performances) {
    (performance.isTicketingEnabled ? ticketed : others).push(performance);
  }
  return [...ticketed, ...others];
}
