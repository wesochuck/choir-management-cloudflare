const nameSuffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Returns the stable, locale-independent key used by Organization exports when
 * sorting people by surname. The same rule is shared by RSVP and donation CSVs.
 */
export function lastNameSortKey(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const lastPart = parts.at(-1) ?? "";
  const normalizedLastPart = lastPart.replace(/\.$/, "").toLowerCase();
  if (nameSuffixes.has(normalizedLastPart)) {
    return `${parts.at(-2) ?? ""} ${lastPart}`.trim().toLowerCase();
  }
  return (parts.length >= 3 ? `${parts.at(-2) ?? ""} ${lastPart}` : lastPart).toLowerCase();
}
