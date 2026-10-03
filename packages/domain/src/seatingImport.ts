import type { SeatingFormation, SeatingTemplate } from "@choir/contracts";

export function normalizeSeatingName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

interface TemplateProfile {
  readonly id: string;
  readonly displayName: string;
}
function nameIndex(profiles: readonly TemplateProfile[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const profile of profiles) {
    const key = normalizeSeatingName(profile.displayName);
    const ids = index.get(key) ?? [];
    ids.push(profile.id);
    index.set(key, ids);
  }
  return index;
}
function nameCounts(chart: SeatingTemplate["charts"][number]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { name } of chart.assignments) {
    const key = normalizeSeatingName(name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
function matchOne(
  name: string,
  chosen: string | undefined,
  context: {
    readonly byName: ReadonlyMap<string, readonly string[]>;
    readonly profileIds: ReadonlySet<string>;
    readonly sourceCounts: ReadonlyMap<string, number>;
    readonly eligibleIds: ReadonlySet<string> | undefined;
  },
): { id: string | undefined; reason: string | null } {
  const key = normalizeSeatingName(name);
  const ids = context.byName.get(key) ?? [];
  const explicit = chosen && context.profileIds.has(chosen) ? chosen : undefined;
  const id = explicit ?? (ids.length === 1 ? ids[0] : undefined);
  if (!explicit && ((context.sourceCounts.get(key) ?? 0) > 1 || ids.length > 1))
    return { id, reason: "Name is ambiguous" };
  if (!id) return { id, reason: "No matching Profile" };
  if (context.eligibleIds && !context.eligibleIds.has(id))
    return { id, reason: "Must be Active, have a voice part, and RSVP Yes" };
  return { id, reason: null };
}

export function matchSeatingTemplate(
  chart: SeatingTemplate["charts"][number],
  profiles: readonly TemplateProfile[],
  eligibleIds?: ReadonlySet<string>,
  resolutions: Readonly<Record<string, string>> = {},
) {
  const context = {
    byName: nameIndex(profiles),
    profileIds: new Set(profiles.map(({ id }) => id)),
    sourceCounts: nameCounts(chart),
    eligibleIds,
  };
  const assignments = new Map<string, string>();
  const unresolved: { name: string; seatKey: string; reason: string }[] = [];
  for (const { name, seatKey } of chart.assignments) {
    const { id, reason } = matchOne(name, resolutions[seatKey], context);
    if (reason || !id) unresolved.push({ name, seatKey, reason: reason ?? "No matching Profile" });
    else assignments.set(seatKey, id);
  }
  // Reject every seat involved in a collision, including automatic versus explicit matches.
  const counts = new Map<string, number>();
  for (const id of assignments.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const { name, seatKey } of chart.assignments) {
    const id = assignments.get(seatKey);
    if (id && (counts.get(id) ?? 0) > 1) {
      assignments.delete(seatKey);
      unresolved.push({ name, seatKey, reason: "Profile is assigned to multiple seats" });
    }
  }
  return { assignments: Object.fromEntries(assignments), unresolved };
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
