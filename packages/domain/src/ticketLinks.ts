/** Stable URL names are allocated once in Organization storage, never on the client. */
export function ticketSlugBase(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  // Reserve route words and the legacy ID namespace.
  return !base || ["bundles", "order"].includes(base) || /^[0-9a-f-]+$/.test(base)
    ? `concert-${base || "tickets"}`
    : base;
}

export function ticketSalesPath(
  item: { readonly id: string; readonly ticketSlug?: string | null | undefined },
  kind: "performance" | "bundle" = "performance",
): string {
  return `${kind === "bundle" ? "/tickets/bundles/" : "/tickets/"}${item.ticketSlug ?? item.id}`;
}

/** Sharing ends after the configured duration, or at the start when no duration is set. */
export function isTicketEventShareable(
  event: { readonly startsAt: string; readonly durationMinutes: number | null },
  nowMs: number,
): boolean {
  return Date.parse(event.startsAt) + (event.durationMinutes ?? 0) * 60_000 > nowMs;
}
