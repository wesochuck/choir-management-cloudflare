const nameSuffixes = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "esq",
  "esq.",
  "phd",
  "ph.d.",
  "md",
  "m.d.",
]);

const surnameParticles = new Set([
  // Dutch / German / Afrikaans
  "van",
  "von",
  "der",
  "den",
  "ter",
  "ten",
  "te",
  "zu",
  "zum",
  "zur",
  "am",
  "vom",
  // Romance (French, Spanish, Italian, Portuguese)
  "de",
  "del",
  "della",
  "delle",
  "dello",
  "dei",
  "degli",
  "da",
  "das",
  "do",
  "dos",
  "du",
  "des",
  "di",
  "la",
  "le",
  "les",
  "lo",
  "li",
  // Saints / Spanish / Catalan
  "st",
  "st.",
  "ste",
  "ste.",
  "saint",
  "sainte",
  "san",
  "santa",
  // Celtic / Arabic / Hebrew
  "fitz",
  "mac",
  "mc",
  "al",
  "el",
  "ben",
  "bin",
  "ibn",
  "bar",
]);

function cleanTokenForSuffixCheck(token: string): string {
  return token
    .replace(/^["'([{]+/, "")
    .replace(/["')\]},;]+$/, "")
    .toLowerCase()
    .replace(/\.$/, "");
}

function cleanTokenForParticleCheck(token: string): string {
  return token
    .replace(/^["'([{]+/, "")
    .replace(/["')\]},;]+$/, "")
    .toLowerCase()
    .replace(/\.$/, "");
}

/**
 * Returns the stable, locale-independent key used by Organization exports when
 * sorting people by surname. The same canonical surname logic is shared across
 * exports and UI surname sorting.
 */
export function lastNameSortKey(name: string): string {
  return getLastName(name).toLowerCase();
}

function stripTrailingSuffixes(tokens: string[]): void {
  while (tokens.length > 1) {
    const lastToken = tokens[tokens.length - 1] ?? "";
    const normalized = cleanTokenForSuffixCheck(lastToken);
    if (!nameSuffixes.has(normalized)) {
      break;
    }
    tokens.pop();
    const prev = tokens[tokens.length - 1];
    if (prev?.endsWith(",")) {
      tokens[tokens.length - 1] = prev.slice(0, -1);
    }
  }
}

function findCompoundSurnameStartIndex(tokens: readonly string[]): number {
  const lastIndex = tokens.length - 1;
  let startIndex = lastIndex;

  for (let i = lastIndex - 1; i >= 0; i--) {
    const token = tokens[i] ?? "";
    const particleCandidate = cleanTokenForParticleCheck(token);
    if (!surnameParticles.has(particleCandidate)) {
      break;
    }
    if (i > 0) {
      startIndex = i;
    } else if (startIndex < lastIndex || token === token.toLowerCase()) {
      // i === 0: the first token of the entire name.
      // Include if it's a particle and either part of an already extended compound
      // (e.g. "De la Cruz") or lowercase (e.g. "van Beethoven").
      startIndex = 0;
    }
  }

  return startIndex;
}

/**
 * Parse a display name into a canonical surname/last-name string.
 * Handles common compound surname particles (e.g. "Van Dyke", "van Beethoven",
 * "de la Cruz"), generational/academic suffixes (e.g. "Jr.", "III", "MD"),
 * middle names ("Mary Ann Smith" -> "Smith"), and single-token names ("Cher" -> "Cher").
 */
export function getLastName(fullName: string): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  if (!trimmed) return "";

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0] ?? "";

  stripTrailingSuffixes(tokens);
  if (tokens.length <= 1) {
    return tokens[0] ?? "";
  }

  const startIndex = findCompoundSurnameStartIndex(tokens);
  return tokens.slice(startIndex).join(" ");
}

export function getFirstName(fullName: string): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  const lastName = getLastName(trimmed);
  if (!lastName || trimmed === lastName) return "";
  const index = trimmed.indexOf(lastName);
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
