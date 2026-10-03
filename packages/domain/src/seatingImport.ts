import type { SeatingFormation, SeatingTemplate } from "@choir/contracts";

export function normalizeSeatingName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function matchSeatingTemplate(
  chart: SeatingTemplate["charts"][number],
  profiles: readonly { readonly id: string; readonly displayName: string }[],
  eligibleIds: ReadonlySet<string>,
) {
  const byName = new Map<string, string[]>();
  for (const profile of profiles) {
    const key = normalizeSeatingName(profile.displayName);
    const ids = byName.get(key) ?? [];
    ids.push(profile.id);
    byName.set(key, ids);
  }
  const sourceCounts = new Map<string, number>();
  for (const { name } of chart.assignments) {
    const key = normalizeSeatingName(name);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const assignments: Record<string, string> = {};
  const unresolved: { name: string; seatKey: string; reason: string }[] = [];
  for (const { name, seatKey } of chart.assignments) {
    const key = normalizeSeatingName(name);
    const ids = byName.get(key) ?? [];
    const id = ids[0];
    const reason =
      (sourceCounts.get(key) ?? 0) > 1 || ids.length > 1
        ? "Name is ambiguous"
        : !id
          ? "No matching Profile"
          : !eligibleIds.has(id)
            ? "Must be Active, have a voice part, and RSVP Yes"
            : null;
    if (reason || !id) unresolved.push({ name, seatKey, reason: reason ?? "No matching Profile" });
    else assignments[seatKey] = id;
  }
  return { assignments, unresolved };
}

export function equivalentSeatingFormation(
  source: SeatingFormation,
  formations: readonly SeatingFormation[],
): SeatingFormation | undefined {
  return formations.find(
    (formation) =>
      formation.isVoicePartLayout === source.isVoicePartLayout &&
      formation.strategy === source.strategy &&
      JSON.stringify(formation.sectionOrder) === JSON.stringify(source.sectionOrder),
  );
}

export function importedSeatingFormation(
  source: SeatingFormation,
  formations: readonly SeatingFormation[],
): SeatingFormation {
  const existing = equivalentSeatingFormation(source, formations);
  if (existing) return existing;
  const used = new Set(formations.map(({ id }) => id));
  const base = `import-${source.id.slice(0, 48)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${String(suffix++)}`;
  return { ...source, id };
}
