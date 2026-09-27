import type { OrganizationAttendanceRow, OrganizationRosterConfiguration } from "@choir/contracts";
import { lastNameSortKey } from "@choir/domain";

export interface AttendanceGroup {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly OrganizationAttendanceRow[];
}

export function sortAttendanceRows(
  rows: readonly OrganizationAttendanceRow[],
): readonly OrganizationAttendanceRow[] {
  return [...rows].sort((a, b) => {
    const lastNameA = lastNameSortKey(a.displayName);
    const lastNameB = lastNameSortKey(b.displayName);
    const lastNameCmp = lastNameA.localeCompare(lastNameB);
    if (lastNameCmp !== 0) return lastNameCmp;

    const nameCmp = a.displayName.localeCompare(b.displayName);
    if (nameCmp !== 0) return nameCmp;

    return a.profileId.localeCompare(b.profileId);
  });
}

function fallbackGrouping(rows: readonly OrganizationAttendanceRow[]): readonly AttendanceGroup[] {
  const groups = new Map<string, OrganizationAttendanceRow[]>();
  for (const row of rows) {
    const label = row.voicePart || "Other";
    const existing = groups.get(label) ?? [];
    existing.push(row);
    groups.set(label, existing);
  }
  return [...groups.entries()].map(([label, groupRows]) => ({
    key: label,
    name: label,
    rows: sortAttendanceRows(groupRows),
  }));
}

function resolveSectionCode(
  voicePart: string,
  partToSectionCode: ReadonlyMap<string, string>,
  sectionByCode: ReadonlyMap<string, unknown>,
): string | undefined {
  const trimmed = voicePart.trim();
  if (!trimmed) return undefined;
  return (
    partToSectionCode.get(trimmed.toLowerCase()) ??
    (sectionByCode.has(trimmed) ? trimmed : undefined)
  );
}

export function groupRowsBySection(
  rows: readonly OrganizationAttendanceRow[],
  configuration?: OrganizationRosterConfiguration | null,
): readonly AttendanceGroup[] {
  if (
    !configuration ||
    !Array.isArray(configuration.sections) ||
    configuration.sections.length === 0
  ) {
    return fallbackGrouping(rows);
  }

  const partToSectionCode = new Map<string, string>();
  for (const part of configuration.voiceParts) {
    partToSectionCode.set(part.label.trim().toLowerCase(), part.sectionCode);
  }

  const sectionByCode = new Map<string, { readonly code: string; readonly name: string }>();
  const sectionBuckets = new Map<string, OrganizationAttendanceRow[]>();
  for (const section of configuration.sections) {
    sectionByCode.set(section.code, section);
    sectionBuckets.set(section.code, []);
  }
  const otherBucket: OrganizationAttendanceRow[] = [];

  for (const row of rows) {
    const matchedSectionCode = resolveSectionCode(row.voicePart, partToSectionCode, sectionByCode);
    const bucket = matchedSectionCode ? sectionBuckets.get(matchedSectionCode) : undefined;
    if (bucket) {
      bucket.push(row);
    } else {
      otherBucket.push(row);
    }
  }

  const result: AttendanceGroup[] = [];
  for (const section of configuration.sections) {
    const bucket = sectionBuckets.get(section.code);
    if (bucket && bucket.length > 0) {
      result.push({
        key: section.code,
        name: section.name,
        rows: sortAttendanceRows(bucket),
      });
    }
  }

  if (otherBucket.length > 0) {
    result.push({
      key: "other",
      name: "Other",
      rows: sortAttendanceRows(otherBucket),
    });
  }

  return result;
}
