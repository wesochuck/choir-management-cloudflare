import type { OrganizationMusicPiece, OrganizationMusicPieceRequest } from "@choir/contracts";

export interface MusicCreditSummary {
  readonly arrangerPieces: number;
  readonly composerPieces: number;
  readonly name: string;
  readonly totalPieces: number;
}

interface MusicCreditCounts {
  readonly arrangerPieceIds: Set<string>;
  readonly composerPieceIds: Set<string>;
  readonly pieceIds: Set<string>;
}

export function summarizeMusicCredits(
  pieces: readonly OrganizationMusicPiece[],
): readonly MusicCreditSummary[] {
  const credits = new Map<string, MusicCreditCounts>();
  for (const piece of pieces) {
    for (const [role, rawName] of [
      ["composer", piece.composer],
      ["arranger", piece.arranger],
    ] as const) {
      const name = rawName.trim();
      if (!name) continue;
      const counts = credits.get(name) ?? {
        arrangerPieceIds: new Set<string>(),
        composerPieceIds: new Set<string>(),
        pieceIds: new Set<string>(),
      };
      counts.pieceIds.add(piece.id);
      if (role === "composer") counts.composerPieceIds.add(piece.id);
      else counts.arrangerPieceIds.add(piece.id);
      credits.set(name, counts);
    }
  }
  return [...credits]
    .map(([name, counts]) => ({
      arrangerPieces: counts.arrangerPieceIds.size,
      composerPieces: counts.composerPieceIds.size,
      name,
      totalPieces: counts.pieceIds.size,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export const maximumAudioBytes = 20 * 1024 * 1024;

export type MusicEditorTab = "details" | "performances" | "tracks";

export const emptyPiece: OrganizationMusicPieceRequest = {
  arranger: "",
  catalogId: "",
  composer: "",
  copies: null,
  durationSeconds: null,
  genres: [],
  notes: "",
  parentId: null,
  purchaseDate: null,
  sectionBuckets: [],
  title: "",
  trackFileIds: {},
};

export function requestFrom(piece: OrganizationMusicPiece): OrganizationMusicPieceRequest {
  return {
    arranger: piece.arranger,
    catalogId: piece.catalogId,
    composer: piece.composer,
    copies: piece.copies,
    durationSeconds: piece.durationSeconds,
    genres: piece.genres,
    notes: piece.notes,
    parentId: piece.parentId,
    purchaseDate: piece.purchaseDate,
    sectionBuckets: piece.sectionBuckets,
    title: piece.title,
    trackFileIds: piece.trackFileIds,
  };
}

export function durationText(seconds: number | null): string {
  if (seconds === null) return "";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function audioTimeText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export function normalizeDurationInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const minutesOnly = /^(\d{1,4})$/.exec(trimmed);
  if (minutesOnly) return `${String(Number(minutesOnly[1]))}:00`;

  const minutesAndSeconds = /^(\d{1,4}):(\d{0,2})$/.exec(trimmed);
  if (!minutesAndSeconds) return trimmed;
  const minutes = Number(minutesAndSeconds[1]);
  const seconds = minutesAndSeconds[2] ? Number(minutesAndSeconds[2]) : 0;
  if (seconds > 59) return trimmed;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export function parseDuration(value: string): number | null | undefined {
  const normalized = normalizeDurationInput(value);
  if (!normalized) return null;
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(normalized);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const total = minutes * 60 + seconds;
  return total <= 86_400 ? total : undefined;
}

export function uniqueLabels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
}

const genreChipColors = [
  "teal",
  "blue",
  "violet",
  "rose",
  "orange",
  "green",
  "indigo",
  "gold",
] as const;

export type GenreChipColor = (typeof genreChipColors)[number];

export function genreKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

export function uniqueGenreLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  return labels.reduce<string[]>((result, label) => {
    const trimmed = label.trim();
    const key = genreKey(trimmed);
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
    return result;
  }, []);
}

export function genreChipColor(label: string): GenreChipColor {
  const value = genreKey(label);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = hash * 31 + value.charCodeAt(index);
  }
  return genreChipColors[Math.abs(hash) % genreChipColors.length] ?? "teal";
}

export function composerText(piece: OrganizationMusicPiece): string {
  if (piece.composer && piece.arranger) return `${piece.composer} / arr. ${piece.arranger}`;
  return piece.composer || piece.arranger || "—";
}

export interface PreferredPracticeTrack {
  readonly fileId: string;
  readonly key: string;
  readonly label: string;
}

export function resolvePreferredPracticeTrack(
  piece: OrganizationMusicPiece,
): PreferredPracticeTrack | null {
  const entries = Object.entries(piece.trackFileIds).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  if (entries.length === 0) return null;

  const tuttiEntry = entries.find(([key]) => key.trim().toLowerCase() === "tutti");
  if (tuttiEntry) {
    return {
      fileId: tuttiEntry[1],
      key: tuttiEntry[0],
      label: "Tutti",
    };
  }

  const everyoneEntry = entries.find(([key]) => key.trim().toLowerCase() === "everyone");
  if (everyoneEntry) {
    return {
      fileId: everyoneEntry[1],
      key: everyoneEntry[0],
      label: "Everyone",
    };
  }

  const sortedEntries = [...entries].toSorted(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const firstEntry = sortedEntries[0];
  if (!firstEntry) return null;
  const [firstKey, firstFileId] = firstEntry;
  const formattedLabel =
    firstKey.length > 0 ? firstKey.charAt(0).toUpperCase() + firstKey.slice(1) : "Practice track";

  return {
    fileId: firstFileId,
    key: firstKey,
    label: formattedLabel,
  };
}

export function pieceTrackCount(piece: OrganizationMusicPiece): number {
  return Object.values(piece.trackFileIds).filter(
    (fileId) => typeof fileId === "string" && fileId.trim().length > 0,
  ).length;
}

export function trackCount(
  piece: OrganizationMusicPiece,
  pieces: readonly OrganizationMusicPiece[],
): number {
  const directTracks = pieceTrackCount(piece);
  const movementTracks = pieces
    .filter(({ parentId }) => parentId === piece.id)
    .reduce((total, movement) => total + pieceTrackCount(movement), 0);
  return directTracks + movementTracks;
}
