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
