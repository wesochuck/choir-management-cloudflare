export const STANDARD_SCORE_KEYS = [
  { key: "primary", label: "Choral Score (Primary)" },
  { key: "full_score", label: "Full Score" },
  { key: "accompaniment", label: "Accompaniment" },
  { key: "vocal_score", label: "Vocal Score" },
] as const;

export const SCORE_MAX_BYTES = 20 * 1024 * 1024;
export const SCORE_BUNDLE_MAX_BYTES = 48 * 1024 * 1024;
export const SCORE_MIME_TYPE = "application/pdf";

export interface DigitalScoreRosterConfiguration {
  readonly voiceParts?: readonly { readonly label: string; readonly fullName: string }[];
  readonly sections?: readonly { readonly code: string; readonly name: string }[];
}

export function scoreDescription(
  key: string,
  configuration?: DigitalScoreRosterConfiguration | null,
): string {
  if (key === "primary") return "Choral Score";
  if (key === "full_score") return "Full Score";
  if (key === "accompaniment") return "Accompaniment";
  if (key === "vocal_score") return "Vocal Score";

  if (configuration) {
    const matchingPart = configuration.voiceParts?.find(
      ({ label }) => label.toLowerCase() === key.toLowerCase(),
    );
    if (matchingPart) return matchingPart.fullName;

    const matchingSection = configuration.sections?.find(
      ({ code }) => code.toLowerCase() === key.toLowerCase(),
    );
    if (matchingSection) return matchingSection.name;
  }

  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function safeScoreNamePart(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.charCodeAt(0);
    sanitized += codePoint <= 31 || codePoint === 127 ? " " : character;
  }
  return sanitized.replace(/[\\/]/g, " - ").replace(/\s+/g, " ").trim();
}

export function digitalScoreFileName(
  title: string,
  parentTitle: string | null | undefined,
  key: string,
  configuration?: DigitalScoreRosterConfiguration | null,
): string {
  const parts: string[] = [];
  if (parentTitle && parentTitle.trim().length > 0) {
    parts.push(safeScoreNamePart(parentTitle));
  }
  parts.push(safeScoreNamePart(title));
  parts.push(safeScoreNamePart(scoreDescription(key, configuration)));

  const base = parts.filter(Boolean).join(" - ");
  return `${(base || "digital-score").slice(0, 251).trim()}.pdf`;
}

export interface ResolvedPieceScore {
  readonly fileId: string;
  readonly isParentFallback: boolean;
  readonly key: string;
}

export function resolveMemberScoreFile(
  piece: { readonly scoreFileIds?: Readonly<Record<string, string>> },
  memberVoicePartLabel?: string | null,
  parentPiece?: { readonly scoreFileIds?: Readonly<Record<string, string>> } | null,
): ResolvedPieceScore | null {
  const pieceScores = piece.scoreFileIds ?? {};

  if (memberVoicePartLabel && pieceScores[memberVoicePartLabel]) {
    return {
      fileId: pieceScores[memberVoicePartLabel],
      isParentFallback: false,
      key: memberVoicePartLabel,
    };
  }

  if (pieceScores.primary) {
    return {
      fileId: pieceScores.primary,
      isParentFallback: false,
      key: "primary",
    };
  }

  const pieceEntries = Object.entries(pieceScores).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  if (pieceEntries.length > 0 && pieceEntries[0]) {
    return {
      fileId: pieceEntries[0][1],
      isParentFallback: false,
      key: pieceEntries[0][0],
    };
  }

  if (parentPiece?.scoreFileIds) {
    const parentScores = parentPiece.scoreFileIds;
    if (memberVoicePartLabel && parentScores[memberVoicePartLabel]) {
      return {
        fileId: parentScores[memberVoicePartLabel],
        isParentFallback: true,
        key: memberVoicePartLabel,
      };
    }
    if (parentScores.primary) {
      return {
        fileId: parentScores.primary,
        isParentFallback: true,
        key: "primary",
      };
    }
    const parentEntries = Object.entries(parentScores).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    );
    if (parentEntries.length > 0 && parentEntries[0]) {
      return {
        fileId: parentEntries[0][1],
        isParentFallback: true,
        key: parentEntries[0][0],
      };
    }
  }

  return null;
}
