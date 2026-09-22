const PART_ORDER: Record<string, number> = {
  soprano: 10,
  soprano1: 11,
  soprano2: 12,
  soprano3: 13,
  s: 10,
  s1: 11,
  s2: 12,
  s3: 13,
  mezzo: 20,
  mezzosoprano: 20,
  alto: 30,
  alto1: 31,
  alto2: 32,
  alto3: 33,
  a: 30,
  a1: 31,
  a2: 32,
  a3: 33,
  tenor: 40,
  tenor1: 41,
  tenor2: 42,
  tenor3: 43,
  t: 40,
  t1: 41,
  t2: 42,
  t3: 43,
  baritone: 50,
  baritone1: 51,
  baritone2: 52,
  bass: 60,
  bass1: 61,
  bass2: 62,
  bass3: 63,
  b: 60,
  b1: 61,
  b2: 62,
  b3: 63,
  solo: 70,
  choirmix: 90,
  tutti: 99,
};

const DEFAULT_PART_NAMES: Record<string, string> = {
  a: "Alto",
  a1: "Alto 1",
  a2: "Alto 2",
  a3: "Alto 3",
  alto: "Alto",
  alto1: "Alto 1",
  alto2: "Alto 2",
  alto3: "Alto 3",
  b: "Bass",
  b1: "Bass 1",
  b2: "Bass 2",
  b3: "Bass 3",
  baritone: "Baritone",
  baritone1: "Baritone 1",
  baritone2: "Baritone 2",
  bass: "Bass",
  bass1: "Bass 1",
  bass2: "Bass 2",
  bass3: "Bass 3",
  "choir mix": "Choir Mix",
  choirmix: "Choir Mix",
  mezzo: "Mezzo-Soprano",
  mezzosoprano: "Mezzo-Soprano",
  s: "Soprano",
  s1: "Soprano 1",
  s2: "Soprano 2",
  s3: "Soprano 3",
  solo: "Solo",
  soprano: "Soprano",
  soprano1: "Soprano 1",
  soprano2: "Soprano 2",
  soprano3: "Soprano 3",
  t: "Tenor",
  t1: "Tenor 1",
  t2: "Tenor 2",
  t3: "Tenor 3",
  tenor: "Tenor",
  tenor1: "Tenor 1",
  tenor2: "Tenor 2",
  tenor3: "Tenor 3",
  tutti: "Choir Mix",
};

function getPartOrderWeight(key: string): number {
  const normalized = key.toLowerCase().replace(/[\s_-]+/g, "");
  if (PART_ORDER[normalized] !== undefined) {
    return PART_ORDER[normalized];
  }
  const match = /^([a-z]+)(\d+)$/.exec(normalized);
  if (match?.[1] && match[2]) {
    const baseWeight = PART_ORDER[match[1]];
    if (baseWeight !== undefined) {
      return baseWeight + Number(match[2]);
    }
  }
  return 80;
}

export function sortVoiceParts(keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => {
    const weightA = getPartOrderWeight(a);
    const weightB = getPartOrderWeight(b);
    if (weightA !== weightB) return weightA - weightB;
    return a.localeCompare(b);
  });
}

export function displayTrackName(
  key: string,
  trackLabels?: Readonly<Record<string, string>>,
): string {
  const trimmed = key.trim();
  if (!trimmed) return key;

  // 1. Check configured trackLabels (exact key first, then case-insensitive lookup)
  if (trackLabels) {
    if (typeof trackLabels[trimmed] === "string" && trackLabels[trimmed].trim().length > 0) {
      return trackLabels[trimmed].trim();
    }
    const lower = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(trackLabels)) {
      if (k.trim().toLowerCase() === lower && typeof v === "string" && v.trim().length > 0) {
        return v.trim();
      }
    }
  }

  // 2. Check predefined choral abbreviations & common defaults
  const normalized = trimmed.toLowerCase();
  if (DEFAULT_PART_NAMES[normalized] !== undefined) {
    return DEFAULT_PART_NAMES[normalized];
  }

  // 3. Heuristic for letter prefix + number (e.g. B3, T4, Alto1, etc.)
  const match = /^([a-zA-Z]+)[_\s-]*(\d+)$/.exec(trimmed);
  if (match?.[1] && match[2]) {
    const prefixLower = match[1].toLowerCase();
    const mappedPrefix =
      DEFAULT_PART_NAMES[prefixLower] ??
      match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    return `${mappedPrefix} ${match[2]}`;
  }

  // 4. Default: capitalize first letter, preserve the rest
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function formatVoicePartName(
  key: string,
  trackLabels?: Readonly<Record<string, string>>,
): string {
  return displayTrackName(key, trackLabels);
}
