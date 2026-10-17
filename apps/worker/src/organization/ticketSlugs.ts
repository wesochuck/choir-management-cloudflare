import { ticketSlugBase } from "@choir/domain";

type Kind = "performance" | "bundle";

export function readTicketSlug(sql: SqlStorage, kind: Kind, resourceId: string): string | null {
  return (
    sql
      .exec<{ slug: string }>(
        "SELECT slug FROM ticket_url_names WHERE kind = ? AND resource_id = ?",
        kind,
        resourceId,
      )
      .toArray()
      .at(0)?.slug ?? null
  );
}

/** Call inside the caller's synchronous write/migration transaction. Tombstones are retained. */
export function ensureTicketSlug(
  sql: SqlStorage,
  kind: Kind,
  resourceId: string,
  title: string,
): string {
  const existing = readTicketSlug(sql, kind, resourceId);
  if (existing) return existing;
  const base = ticketSlugBase(title);
  let suffix = sql
    .exec<{ suffix: number }>(
      "SELECT COALESCE(MAX(suffix), 0) + 1 AS suffix FROM ticket_url_names WHERE kind = ? AND base = ?",
      kind,
      base,
    )
    .one().suffix;
  let slug = suffix === 1 ? base : `${base}-${String(suffix)}`;
  // A title such as 'Spring Concert 2' can occupy a suffix of 'Spring Concert'.
  while (
    sql.exec("SELECT 1 FROM ticket_url_names WHERE kind = ? AND slug = ?", kind, slug).toArray()
      .length
  ) {
    suffix += 1;
    slug = `${base}-${String(suffix)}`;
  }
  sql.exec(
    "INSERT INTO ticket_url_names (kind, resource_id, slug, base, suffix) VALUES (?, ?, ?, ?, ?)",
    kind,
    resourceId,
    slug,
    base,
    suffix,
  );
  return slug;
}
