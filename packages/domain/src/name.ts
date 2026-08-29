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

/**
 * Parse a display name using the convention used by the legacy seating list.
 * Names with three or more parts keep the final two words together so names
 * such as "Ron Van Dyke" remain recognizable.
 */
export function getLastName(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  const length = parts.length;
  if (length <= 1) return parts[0] ?? "";

  const suffixes = new Set(["Jr", "Sr", "II", "III", "IV", "V", "Jr.", "Sr."]);
  const lastPart = parts[length - 1] ?? "";
  if (suffixes.has(lastPart)) {
    const namePartCount = length - 1;
    if (namePartCount >= 3) {
      const thirdLastPart = parts[length - 3] ?? "";
      const secondLastPart = parts[length - 2] ?? "";
      return `${thirdLastPart} ${secondLastPart} ${lastPart}`;
    }
    if (namePartCount === 2) {
      const secondLastPart = parts[length - 2] ?? "";
      return `${secondLastPart} ${lastPart}`;
    }
    return lastPart;
  }

  if (length >= 3) {
    const secondLastPart = parts[length - 2] ?? "";
    return `${secondLastPart} ${lastPart}`;
  }
  return lastPart;
}

export function getFirstName(fullName: string): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  const lastName = getLastName(trimmed);
  if (!lastName || trimmed === lastName) return "";
  const index = trimmed.lastIndexOf(lastName);
  return index === -1 ? "" : trimmed.substring(0, index).trim();
}

export function getInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();
}

export interface DisplayNamed {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Returns compact last-first display names, expanding the first-name prefix
 * only as far as necessary to distinguish duplicate last names.
 */
export function getUniqueDisplayNames(items: readonly DisplayNamed[]): ReadonlyMap<string, string> {
  const displayNames = new Map<string, string>();
  const byLastName = new Map<string, DisplayNamed[]>();

  for (const item of items) {
    const lastName = getLastName(item.displayName);
    const key = lastName.toLowerCase();
    const group = byLastName.get(key) ?? [];
    group.push(item);
    byLastName.set(key, group);
  }

  for (const group of byLastName.values()) {
    if (group.length === 1) {
      const item = group[0];
      if (item) displayNames.set(item.id, getLastName(item.displayName));
      continue;
    }

    const names = group.map((item) => ({
      firstName: getFirstName(item.displayName),
      item,
      lastName: getLastName(item.displayName),
    }));
    const maxFirstNameLength = Math.max(...names.map(({ firstName }) => firstName.length), 0);
    let prefixLength = 1;
    while (prefixLength <= maxFirstNameLength) {
      const prefixes = names.map(({ firstName }) => firstName.slice(0, prefixLength).toLowerCase());
      if (new Set(prefixes).size === group.length) break;
      prefixLength += 1;
    }

    for (const { item, firstName, lastName } of names) {
      const prefix = firstName.slice(0, prefixLength);
      displayNames.set(item.id, prefix ? `${lastName}, ${prefix}` : lastName);
    }
  }

  return displayNames;
}
