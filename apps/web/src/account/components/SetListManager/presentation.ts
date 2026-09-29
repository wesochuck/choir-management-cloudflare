import type { OrganizationMusicPiece } from "@choir/contracts";
import type { SetListItem } from "./types";

export interface PresentationMovementItem {
  readonly builderCredit?: string | undefined;
  readonly credit?: string | undefined;
  readonly flatIndex: number;
  readonly item: SetListItem;
  readonly notes: string;
  readonly piece: OrganizationMusicPiece;
}

export interface PresentationStandaloneEntry {
  readonly builderCredit?: string | undefined;
  readonly credit?: string | undefined;
  readonly flatIndex: number;
  readonly item: SetListItem;
  readonly kind: "standalone";
  readonly notes: string;
  readonly parentPiece?: OrganizationMusicPiece | undefined;
  readonly piece?: OrganizationMusicPiece | undefined;
  readonly programNumber: number;
}

export interface PresentationGroupEntry {
  readonly builderCredit?: string | undefined;
  readonly credit?: string | undefined;
  readonly kind: "movement-group";
  readonly movements: readonly PresentationMovementItem[];
  readonly notes?: string | undefined;
  readonly parentFlatIndex?: number | undefined;
  readonly parentItem?: SetListItem | undefined;
  readonly parentPiece: OrganizationMusicPiece;
  readonly programNumber: number;
}

export interface PresentationIntermissionEntry {
  readonly flatIndex: number;
  readonly item: SetListItem;
  readonly kind: "intermission";
  readonly notes: string;
}

export type SetListPresentationEntry =
  PresentationStandaloneEntry | PresentationGroupEntry | PresentationIntermissionEntry;

function trimmedOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function isSongItem(item: SetListItem): boolean {
  return item.type !== "intermission";
}

function pieceForSetListItem(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): OrganizationMusicPiece | undefined {
  return item.pieceId ? music.find(({ id }) => id === item.pieceId) : undefined;
}

export function effectiveSetListItemNotes(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): string {
  return (
    trimmedOrUndefined(item.notes) ??
    trimmedOrUndefined(pieceForSetListItem(item, music)?.notes) ??
    ""
  );
}

export function effectiveSetListItemComposer(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): string | undefined {
  if (!isSongItem(item)) return undefined;
  return (
    trimmedOrUndefined(item.composer) ??
    trimmedOrUndefined(pieceForSetListItem(item, music)?.composer)
  );
}

export function effectiveSetListItemArranger(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): string | undefined {
  if (!isSongItem(item)) return undefined;
  const itemCandidate: unknown = item;
  const itemArranger =
    typeof itemCandidate === "object" &&
    itemCandidate !== null &&
    "arranger" in itemCandidate &&
    typeof itemCandidate.arranger === "string"
      ? itemCandidate.arranger
      : undefined;
  return (
    trimmedOrUndefined(itemArranger) ??
    trimmedOrUndefined(pieceForSetListItem(item, music)?.arranger)
  );
}

export function setListPrintedCredit(
  arranger: string | null | undefined,
  composer: string | null | undefined,
): string {
  const normalizedArranger = arranger?.trim();
  if (normalizedArranger) {
    return `arr. ${normalizedArranger}`;
  }

  const normalizedComposer = composer?.trim();
  return normalizedComposer ?? "";
}

export function setListBuilderCredit(
  composer: string | null | undefined,
  arranger: string | null | undefined,
): string | undefined {
  const normalizedComposer = composer?.trim();
  const normalizedArranger = arranger?.trim();

  if (normalizedComposer && normalizedArranger) {
    return `${normalizedComposer} · arr. ${normalizedArranger}`;
  }
  if (normalizedComposer) {
    return normalizedComposer;
  }
  if (normalizedArranger) {
    return `arr. ${normalizedArranger}`;
  }
  return undefined;
}

export function formatPerformerCredits(item: SetListItem): string {
  const isFeatured = item.isFeaturedNumber ?? item.soloSmallGroup ?? false;
  return isFeatured
    ? (item.performerCredits ?? []).map(({ displayName }) => displayName).join(", ")
    : "";
}

export function indentedNoteLines(notes: string, indent = "   "): string[] {
  const [firstLine, ...restLines] = notes.split("\n");
  return [`${indent}Notes: ${firstLine ?? ""}`, ...restLines.map((line) => `${indent}${line}`)];
}

function resolvePresentationCredits(
  composer: string | undefined,
  arranger: string | undefined,
): { readonly builderCredit?: string | undefined; readonly credit?: string | undefined } {
  const credit = trimmedOrUndefined(setListPrintedCredit(arranger, composer));
  const builderCredit = setListBuilderCredit(composer, arranger);
  return { builderCredit, credit };
}

function filterContiguousMovements(
  items: readonly SetListItem[],
  startIndex: number,
  parentId: string,
  musicById: ReadonlyMap<string, OrganizationMusicPiece>,
  music: readonly OrganizationMusicPiece[],
): PresentationMovementItem[] {
  const childMovements: PresentationMovementItem[] = [];
  for (let j = startIndex; j < items.length; j++) {
    const nextItem = items[j];
    if (!nextItem || nextItem.type === "intermission" || !nextItem.pieceId) break;
    const nextPiece = musicById.get(nextItem.pieceId);
    if (nextPiece?.parentId !== parentId) break;
    childMovements.push({
      flatIndex: j,
      item: nextItem,
      notes: effectiveSetListItemNotes(nextItem, music),
      piece: nextPiece,
    });
  }
  return childMovements;
}

function applyMovementCredits(
  movements: readonly PresentationMovementItem[],
  parentCredit: string | undefined,
  parentBuilderCredit: string | undefined,
  music: readonly OrganizationMusicPiece[],
): readonly PresentationMovementItem[] {
  return movements.map((movement) => {
    const mComposer = effectiveSetListItemComposer(movement.item, music);
    const mArranger = effectiveSetListItemArranger(movement.item, music);
    const { builderCredit, credit } = resolvePresentationCredits(mComposer, mArranger);

    return {
      ...movement,
      builderCredit:
        parentBuilderCredit && builderCredit === parentBuilderCredit ? undefined : builderCredit,
      credit: parentCredit && credit === parentCredit ? undefined : credit,
    };
  });
}

function tryCreateParentGroup(
  item: SetListItem,
  flatIndex: number,
  piece: OrganizationMusicPiece,
  items: readonly SetListItem[],
  musicById: ReadonlyMap<string, OrganizationMusicPiece>,
  music: readonly OrganizationMusicPiece[],
  programNumber: number,
): { readonly entry: PresentationGroupEntry; readonly nextIndex: number } | null {
  const childMovements = filterContiguousMovements(
    items,
    flatIndex + 1,
    piece.id,
    musicById,
    music,
  );
  if (childMovements.length === 0) return null;

  const parentComposer = effectiveSetListItemComposer(item, music);
  const parentArranger = effectiveSetListItemArranger(item, music);
  const { builderCredit: parentBuilderCredit, credit: parentCredit } = resolvePresentationCredits(
    parentComposer,
    parentArranger,
  );

  const movements = applyMovementCredits(childMovements, parentCredit, parentBuilderCredit, music);

  return {
    entry: {
      builderCredit: parentBuilderCredit,
      credit: parentCredit,
      kind: "movement-group",
      movements,
      notes: effectiveSetListItemNotes(item, music),
      parentFlatIndex: flatIndex,
      parentItem: item,
      parentPiece: piece,
      programNumber,
    },
    nextIndex: flatIndex + 1 + childMovements.length,
  };
}

function tryCreateDerivedGroup(
  item: SetListItem,
  flatIndex: number,
  piece: OrganizationMusicPiece,
  parentPiece: OrganizationMusicPiece,
  items: readonly SetListItem[],
  musicById: ReadonlyMap<string, OrganizationMusicPiece>,
  music: readonly OrganizationMusicPiece[],
  programNumber: number,
): { readonly entry: PresentationGroupEntry; readonly nextIndex: number } | null {
  const contiguousMovements: PresentationMovementItem[] = [
    {
      flatIndex,
      item,
      notes: effectiveSetListItemNotes(item, music),
      piece,
    },
    ...filterContiguousMovements(items, flatIndex + 1, parentPiece.id, musicById, music),
  ];

  if (contiguousMovements.length < 2) return null;

  const parentComposer = trimmedOrUndefined(parentPiece.composer);
  const parentArranger = trimmedOrUndefined(parentPiece.arranger);
  const { builderCredit: parentBuilderCredit, credit: parentCredit } = resolvePresentationCredits(
    parentComposer,
    parentArranger,
  );

  const movements = applyMovementCredits(
    contiguousMovements,
    parentCredit,
    parentBuilderCredit,
    music,
  );

  return {
    entry: {
      builderCredit: parentBuilderCredit,
      credit: parentCredit,
      kind: "movement-group",
      movements,
      parentPiece,
      programNumber,
    },
    nextIndex: flatIndex + contiguousMovements.length,
  };
}

/** Pure presentation grouping for Set List items based on Music Library relationships. */
export function groupSetListForPresentation(
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
): readonly SetListPresentationEntry[] {
  const musicById = new Map(music.map((p) => [p.id, p]));
  const entries: SetListPresentationEntry[] = [];
  let programNumber = 0;
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    if (!item) {
      i++;
      continue;
    }

    if (item.type === "intermission") {
      entries.push({
        flatIndex: i,
        item,
        kind: "intermission",
        notes: effectiveSetListItemNotes(item, music),
      });
      i++;
      continue;
    }

    const piece = item.pieceId ? musicById.get(item.pieceId) : undefined;

    // Case A: explicit parent piece followed by 1 or more movements
    if (piece) {
      const groupResult = tryCreateParentGroup(
        item,
        i,
        piece,
        items,
        musicById,
        music,
        programNumber + 1,
      );
      if (groupResult) {
        programNumber += 1;
        entries.push(groupResult.entry);
        i = groupResult.nextIndex;
        continue;
      }
    }

    // Case B: child movement
    if (piece?.parentId) {
      const parentPiece = musicById.get(piece.parentId);
      if (parentPiece) {
        const derivedGroupResult = tryCreateDerivedGroup(
          item,
          i,
          piece,
          parentPiece,
          items,
          musicById,
          music,
          programNumber + 1,
        );
        if (derivedGroupResult) {
          programNumber += 1;
          entries.push(derivedGroupResult.entry);
          i = derivedGroupResult.nextIndex;
          continue;
        }

        // Single movement: standalone with parentPiece context
        programNumber += 1;
        const composer = effectiveSetListItemComposer(item, music);
        const arranger = effectiveSetListItemArranger(item, music);
        const { builderCredit, credit } = resolvePresentationCredits(composer, arranger);

        entries.push({
          builderCredit,
          credit,
          flatIndex: i,
          item,
          kind: "standalone",
          notes: effectiveSetListItemNotes(item, music),
          parentPiece,
          piece,
          programNumber,
        });

        i++;
        continue;
      }
    }

    // Case C: Standard standalone item (no parent or missing parent)
    programNumber += 1;
    const composer = effectiveSetListItemComposer(item, music);
    const arranger = effectiveSetListItemArranger(item, music);
    const { builderCredit, credit } = resolvePresentationCredits(composer, arranger);

    entries.push({
      builderCredit,
      credit,
      flatIndex: i,
      item,
      kind: "standalone",
      notes: effectiveSetListItemNotes(item, music),
      piece,
      programNumber,
    });

    i++;
  }

  return entries;
}
