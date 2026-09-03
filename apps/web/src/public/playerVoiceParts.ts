const PART_ORDER: Record<string, number> = {
  soprano: 10,
  soprano1: 11,
  soprano2: 12,
  soprano3: 13,
  mezzo: 20,
  mezzosoprano: 20,
  alto: 30,
  alto1: 31,
  alto2: 32,
  alto3: 33,
  tenor: 40,
  tenor1: 41,
  tenor2: 42,
  tenor3: 43,
  baritone: 50,
  baritone1: 51,
  baritone2: 52,
  bass: 60,
  bass1: 61,
  bass2: 62,
  bass3: 63,
  solo: 70,
  choirmix: 90,
  tutti: 99,
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

export function formatVoicePartName(key: string): string {
  const lower = key.trim().toLowerCase();
  if (lower === "tutti" || lower === "choir mix" || lower === "choirmix") {
    return "Choir Mix";
  }
  const match = /^([a-zA-Z]+)[_\s-]*(\d+)$/.exec(key);
  if (match?.[1] && match[2]) {
    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    return `${name} ${match[2]}`;
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}
