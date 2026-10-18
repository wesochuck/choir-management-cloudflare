/** Put ticket-enabled Performances first, earliest to latest within each group. */
export function prioritizeTicketedPerformances<
  T extends { readonly isTicketingEnabled: boolean; readonly startsAt: string },
>(performances: readonly T[]): T[] {
  return performances
    .map((performance) => ({ performance, startsAtMs: Date.parse(performance.startsAt) }))
    .sort(
      (left, right) =>
        Number(right.performance.isTicketingEnabled) -
          Number(left.performance.isTicketingEnabled) || left.startsAtMs - right.startsAtMs,
    )
    .map(({ performance }) => performance);
}
