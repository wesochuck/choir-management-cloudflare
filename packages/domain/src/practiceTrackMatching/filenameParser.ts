import type { ParsedId3Metadata } from "../id3Metadata";
import type { ConfiguredPartOption, ParsedTrackFile } from "./types";

const DEFAULT_PART_ALIASES: readonly {
  readonly alias: string;
  readonly key: string;
  readonly label: string;
}[] = [
  // Tutti / Full Mix
  { alias: "tutti", key: "tutti", label: "Tutti" },
  { alias: "full", key: "tutti", label: "Tutti" },
  { alias: "mix", key: "tutti", label: "Tutti" },
  { alias: "all", key: "tutti", label: "Tutti" },

  { alias: "ensemble", key: "tutti", label: "Tutti" },

  // Soprano
  { alias: "soprano 1", key: "soprano1", label: "Soprano 1" },
  { alias: "soprano1", key: "soprano1", label: "Soprano 1" },
  { alias: "sop 1", key: "soprano1", label: "Soprano 1" },
  { alias: "s1", key: "soprano1", label: "Soprano 1" },
  { alias: "soprano 2", key: "soprano2", label: "Soprano 2" },
  { alias: "soprano2", key: "soprano2", label: "Soprano 2" },
  { alias: "sop 2", key: "soprano2", label: "Soprano 2" },
  { alias: "s2", key: "soprano2", label: "Soprano 2" },
  { alias: "soprano", key: "soprano", label: "Soprano" },
  { alias: "sop", key: "soprano", label: "Soprano" },

  // Alto
  { alias: "alto 1", key: "alto1", label: "Alto 1" },
  { alias: "alto1", key: "alto1", label: "Alto 1" },
  { alias: "alt 1", key: "alto1", label: "Alto 1" },
  { alias: "a1", key: "alto1", label: "Alto 1" },
  { alias: "alto 2", key: "alto2", label: "Alto 2" },
  { alias: "alto2", key: "alto2", label: "Alto 2" },
  { alias: "alt 2", key: "alto2", label: "Alto 2" },
  { alias: "a2", key: "alto2", label: "Alto 2" },
  { alias: "contralto", key: "alto", label: "Alto" },
  { alias: "alto", key: "alto", label: "Alto" },
  { alias: "alt", key: "alto", label: "Alto" },

  // Tenor
  { alias: "tenor 1", key: "tenor1", label: "Tenor 1" },
  { alias: "tenor1", key: "tenor1", label: "Tenor 1" },
  { alias: "ten 1", key: "tenor1", label: "Tenor 1" },
  { alias: "t1", key: "tenor1", label: "Tenor 1" },
  { alias: "tenor 2", key: "tenor2", label: "Tenor 2" },
  { alias: "tenor2", key: "tenor2", label: "Tenor 2" },
  { alias: "ten 2", key: "tenor2", label: "Tenor 2" },
  { alias: "t2", key: "tenor2", label: "Tenor 2" },
  { alias: "tenor", key: "tenor", label: "Tenor" },
  { alias: "ten", key: "tenor", label: "Tenor" },

  // Baritone
  { alias: "baritone", key: "baritone", label: "Baritone" },
  { alias: "barit", key: "baritone", label: "Baritone" },
  { alias: "bari", key: "baritone", label: "Baritone" },
  { alias: "bar", key: "baritone", label: "Baritone" },

  // Bass
  { alias: "bass 1", key: "bass1", label: "Bass 1" },
  { alias: "bass1", key: "bass1", label: "Bass 1" },
  { alias: "b1", key: "bass1", label: "Bass 1" },
  { alias: "bass 2", key: "bass2", label: "Bass 2" },
  { alias: "bass2", key: "bass2", label: "Bass 2" },
  { alias: "b2", key: "bass2", label: "Bass 2" },
  { alias: "bass", key: "bass", label: "Bass" },
  { alias: "bas", key: "bass", label: "Bass" },

  // Accompaniment
  { alias: "accompaniment", key: "accompaniment", label: "Accompaniment" },
  { alias: "accomp", key: "accompaniment", label: "Accompaniment" },
  { alias: "acc", key: "accompaniment", label: "Accompaniment" },
  { alias: "piano", key: "accompaniment", label: "Accompaniment" },
  { alias: "instrumental", key: "accompaniment", label: "Accompaniment" },
];

function normalizePartName(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/gu, "")
    .replace(/^(soprano|alto|tenor|baritone)s$/u, "$1")
    .replace(/^basses$/u, "bass");
}

function skipUnconfiguredPart(
  parts: readonly ConfiguredPartOption[],
  match: ConfiguredPartOption | null | undefined,
  key: string,
): boolean {
  return parts.length > 0 && !match && !["tutti", "accompaniment"].includes(key);
}

function buildPartCandidates(
  configuredParts: readonly ConfiguredPartOption[],
): { alias: string; key: string; label: string }[] {
  const candidates: { alias: string; key: string; label: string }[] = [];
  const aliases = new Set<string>();
  const defaultKeys = new Map(
    DEFAULT_PART_ALIASES.map((part) => [normalizePartName(part.alias), part.key]),
  );
  const canonicalName = (value: string) => {
    const normalized = normalizePartName(value);
    return defaultKeys.get(normalized) ?? normalized;
  };
  const configuredByKey = new Map<string, ConfiguredPartOption>();
  const configuredByName = new Map<string, ConfiguredPartOption | null>();
  for (const part of configuredParts) {
    configuredByKey.set(normalizePartName(part.key), part);
    for (const value of [part.label, part.key]) {
      const alias = value.toLowerCase();
      if (!aliases.has(alias)) {
        candidates.push({ alias, key: part.key, label: part.label });
        aliases.add(alias);
      }
      const name = canonicalName(value);
      const existing = configuredByName.get(name);
      // An ambiguous name must not silently choose one configured track slot.
      configuredByName.set(
        name,
        existing === undefined || existing?.key === part.key ? part : null,
      );
    }
  }
  for (const def of DEFAULT_PART_ALIASES) {
    if (aliases.has(def.alias)) continue;
    const configuredMatch =
      configuredByKey.get(normalizePartName(def.key)) ?? configuredByName.get(def.key);
    if (skipUnconfiguredPart(configuredParts, configuredMatch, def.key)) continue;
    candidates.push({
      alias: def.alias,
      key: configuredMatch?.key ?? def.key,
      label: configuredMatch?.label ?? def.label,
    });
    aliases.add(def.alias);
  }
  candidates.sort((a, b) => b.alias.length - a.alias.length);
  return candidates;
}

function detectVoicePart(
  baseName: string,
  candidates: readonly { alias: string; key: string; label: string }[],
): { alias: string; key: string; label: string } | null {
  const normalizedForSearch = baseName.toLowerCase().replaceAll(/[-_.]/gu, " ");
  for (const candidate of candidates) {
    const escapedAlias = candidate.alias.replaceAll(/[\\^$*+?.()|[\]{}]/gu, "\\$&");
    // Single-letter section codes need a filename edge, so articles in song titles do not match.
    const pattern =
      candidate.alias.length === 1
        ? `(?:^${escapedAlias}\\s*[-_.]|(?:^|[\\s_.-])${escapedAlias}$)`
        : `(?:^|[\\s_-])${escapedAlias}(?:[\\s_-]|$)`;
    const regex = new RegExp(pattern, "iu");
    if (regex.test(baseName) || regex.test(normalizedForSearch)) {
      return candidate;
    }
  }
  return null;
}

function cleanInferredTitle(
  baseName: string,
  partMatchAlias: string | null,
  sequenceNumber: string | null,
): string {
  let inferredTitle = baseName;
  if (partMatchAlias) {
    const escaped = partMatchAlias.replaceAll(/[\\^$*+?.()|[\]{}]/gu, "\\$&");
    inferredTitle = inferredTitle.replaceAll(
      new RegExp(`(^|[\\s_.-])${escaped}(?=[\\s_.-]|$)`, "giu"),
      "$1 ",
    );
  }
  if (sequenceNumber) {
    const numStr = String(Number.parseInt(sequenceNumber, 10));
    inferredTitle = inferredTitle.replaceAll(
      new RegExp(`(?:^|\\b)(?:track[\\s_-]*)?#?0*${numStr}(?:[\\s_-]|$)`, "giu"),
      " ",
    );
  }
  inferredTitle = inferredTitle
    .replaceAll(/\b(?:v\d+|final|master|mix|demo|rec|audio|choir|take\s*\d+)\b/giu, " ")
    .replaceAll(/[-_.]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

  return inferredTitle.length > 0 ? inferredTitle : baseName;
}

function extractSequenceNumber(baseName: string): string | null {
  const seqMatch = /(?:^|[^0-9])(\d{1,3})(?=[_\s-]|$)/u.exec(baseName);
  if (seqMatch?.[1]) {
    return seqMatch[1].padStart(2, "0");
  }
  return null;
}

function resolveInferredTitle(
  baseName: string,
  detectedAlias: string | null,
  sequenceNumber: string | null,
  metadata?: ParsedId3Metadata | null,
): { inferredTitle: string; sequenceNumber: string | null } {
  let inferredTitle = cleanInferredTitle(baseName, detectedAlias, sequenceNumber);
  const resolvedSeq = sequenceNumber;

  if (metadata?.title && metadata.title.trim().length > 0) {
    const isGeneric =
      /^(?:track|audio|take|rec|file|recording)?\s*#?\d*$/iu.test(inferredTitle) ||
      inferredTitle.length <= 2;
    if (isGeneric) {
      inferredTitle = metadata.title.trim();
    }
  }

  return { inferredTitle, sequenceNumber: resolvedSeq };
}

export function parsePracticeTrackFilename(
  fileName: string,
  configuredParts: readonly ConfiguredPartOption[] = [],
  clientFileId = fileName,
  durationSeconds: number | null = null,
  metadata?: ParsedId3Metadata | null,
): ParsedTrackFile {
  const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/u, "").trim();
  const rawSeq = extractSequenceNumber(baseName);
  const partCandidates = buildPartCandidates(configuredParts);
  const unsupportedNumberedPart = /\b(soprano|alto|tenor|bass|sop|alt|ten)\s*([12])\b/iu.exec(
    baseName.replaceAll(/[_-]/gu, " "),
  );
  const detectedCandidate = detectVoicePart(baseName, partCandidates);
  const detected =
    unsupportedNumberedPart &&
    detectedCandidate &&
    !/[12]$/u.test(normalizePartName(detectedCandidate.key)) &&
    !/[12]$/u.test(normalizePartName(detectedCandidate.label))
      ? null
      : detectedCandidate;
  const { inferredTitle, sequenceNumber } = resolveInferredTitle(
    baseName,
    detected?.alias ?? null,
    rawSeq,
    metadata,
  );

  return {
    clientFileId,
    detectedPartKey: detected?.key ?? null,
    detectedPartLabel: detected?.label ?? null,
    durationSeconds,
    fileName,
    inferredTitle,
    metadata: metadata ?? null,
    sequenceNumber,
  };
}
