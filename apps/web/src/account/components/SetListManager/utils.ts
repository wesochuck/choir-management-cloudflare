import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationMusicPiece,
  OrganizationVenue,
} from "@choir/contracts";
import {
  calculateSetListTiming,
  formatSetListDuration,
  moveSetListItem,
  normalizeSetListDuration,
  parseSetListDuration,
} from "@choir/domain";
import { resolvePreferredPracticeTrack, type PreferredPracticeTrack } from "../MusicCatalog/utils";
import type { PublicPlayerLinkStatus } from "../../../api/player";
import type { SetListItem, SetListPreviewRow, SetListPrintRow } from "./types";
import type { Resources } from "./types";
import {
  effectiveSetListItemArranger,
  effectiveSetListItemComposer,
  effectiveSetListItemNotes,
  formatPerformerCredits,
  groupSetListForPresentation,
  indentedNoteLines,
  setListBuilderCredit,
  setListPrintedCredit,
  type PresentationGroupEntry,
  type PresentationIntermissionEntry,
  type PresentationMovementItem,
  type PresentationStandaloneEntry,
  type SetListPresentationEntry,
} from "./presentation";

export {
  effectiveSetListItemArranger,
  effectiveSetListItemComposer,
  effectiveSetListItemNotes,
  formatPerformerCredits,
  groupSetListForPresentation,
  indentedNoteLines,
  setListBuilderCredit,
  setListPrintedCredit,
  type PresentationGroupEntry,
  type PresentationIntermissionEntry,
  type PresentationMovementItem,
  type PresentationStandaloneEntry,
  type SetListPresentationEntry,
};

export const emptyResources: Resources = {
  events: [],
  music: [],
  profiles: [],
  venues: [],
};

export function eventRequestFrom(
  event: OrganizationEvent,
  setList: SetListItem[],
  approved: boolean,
  defaultTransitionSeconds?: number,
) {
  return {
    advancePriceCents: event.advancePriceCents,
    callTime: event.callTime,
    dayOfPriceCents: event.dayOfPriceCents,
    details: event.details,
    doorsOpenTime: event.doorsOpenTime,
    durationMinutes: event.durationMinutes,
    isTicketingEnabled: event.isTicketingEnabled,
    location: event.location,
    parentPerformanceId: event.parentPerformanceId,
    publicDetails: event.publicDetails,
    publicGraphicFileId: event.publicGraphicFileId,
    publishOnWebsite: event.publishOnWebsite,
    rsvpFollowUpLeadHours: event.rsvpFollowUpLeadHours,
    rsvpFollowUpMode: event.rsvpFollowUpMode,
    rsvpDeadlineDate: event.rsvpDeadlineDate,
    setList,
    setListApproved: approved,
    setListDefaultTransitionSeconds:
      defaultTransitionSeconds ?? event.setListDefaultTransitionSeconds,
    startsAt: event.startsAt,
    ticketCapacity: event.ticketCapacity,
    title: event.title,
    type: event.type,
    venueId: event.venueId,
  } satisfies OrganizationEventRequest;
}

export function itemType(item: SetListItem): "intermission" | "song" {
  return item.type === "intermission" ? "intermission" : "song";
}

export function musicPieceForSetListItem(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): OrganizationMusicPiece | undefined {
  return item.pieceId ? music.find(({ id }) => id === item.pieceId) : undefined;
}

export function musicPiecesForSetListItem(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): OrganizationMusicPiece[] {
  if (!item.pieceId) return [];
  const exact = music.find((piece) => piece.id === item.pieceId);
  const children = music.filter((piece) => piece.parentId === item.pieceId);
  return exact ? [exact, ...children] : children;
}

export interface SetListPreferredPracticeTrack {
  readonly fallback: boolean;
  readonly fileId: string;
  readonly sourcePieceId: string;
  readonly sourcePieceTitle: string;
  readonly trackKey: string;
  readonly trackLabel: string;
}

export function resolveSetListPreferredPracticeTrack(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): SetListPreferredPracticeTrack | null {
  if (!item.pieceId) return null;

  const exactPiece = music.find((piece) => piece.id === item.pieceId);
  if (exactPiece) {
    const exactTrack = resolvePreferredPracticeTrack(exactPiece);
    if (exactTrack) {
      return {
        fallback: exactTrack.key.trim().toLowerCase() !== "tutti",
        fileId: exactTrack.fileId,
        sourcePieceId: exactPiece.id,
        sourcePieceTitle: exactPiece.title,
        trackKey: exactTrack.key,
        trackLabel: exactTrack.label,
      };
    }
  }

  const childPieces = music.filter((piece) => piece.parentId === item.pieceId);
  const childTracks = childPieces
    .map((child) => ({
      child,
      track: resolvePreferredPracticeTrack(child),
    }))
    .filter(
      (entry): entry is { child: OrganizationMusicPiece; track: PreferredPracticeTrack } =>
        entry.track !== null,
    );

  const firstChildTrack = childTracks[0];
  if (childTracks.length === 1 && firstChildTrack) {
    const { child, track } = firstChildTrack;
    return {
      fallback: true,
      fileId: track.fileId,
      sourcePieceId: child.id,
      sourcePieceTitle: child.title,
      trackKey: track.key,
      trackLabel: track.label,
    };
  }

  return null;
}

export type SetListItemRecordingStatus =
  | { readonly status: "custom" }
  | { readonly status: "missing" }
  | {
      readonly status: "available";
      readonly track: SetListPreferredPracticeTrack;
    }
  | {
      readonly childCount: number;
      readonly status: "multiple";
    };

export function setListItemRecordingStatus(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): SetListItemRecordingStatus {
  if (itemType(item) !== "song") {
    return { status: "custom" };
  }
  if (!item.pieceId) {
    return { status: "missing" };
  }

  const preferredTrack = resolveSetListPreferredPracticeTrack(item, music);
  if (preferredTrack) {
    return {
      status: "available",
      track: preferredTrack,
    };
  }

  const exactPiece = music.find((piece) => piece.id === item.pieceId);
  const exactTrack = exactPiece ? resolvePreferredPracticeTrack(exactPiece) : null;
  if (!exactTrack) {
    const childPieces = music.filter((piece) => piece.parentId === item.pieceId);
    const childTracksCount = childPieces.filter(
      (child) => resolvePreferredPracticeTrack(child) !== null,
    ).length;
    if (childTracksCount > 1) {
      return {
        childCount: childTracksCount,
        status: "multiple",
      };
    }
  }

  return { status: "missing" };
}

export interface SetListRecordingCoverage {
  readonly songCount: number;
  readonly songsMissingRecording: number;
  readonly songsWithRecording: number;
}

export function setListRecordingCoverage(
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
): SetListRecordingCoverage {
  let songCount = 0;
  let songsWithRecording = 0;
  let songsMissingRecording = 0;

  for (const item of items) {
    if (itemType(item) !== "song") continue;
    songCount += 1;
    const recordingStatus = setListItemRecordingStatus(item, music);
    if (recordingStatus.status === "available" || recordingStatus.status === "multiple") {
      songsWithRecording += 1;
    } else {
      songsMissingRecording += 1;
    }
  }

  return {
    songCount,
    songsMissingRecording,
    songsWithRecording,
  };
}

function trimmedOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function setListItemEditError(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): string | undefined {
  const linkedMusicPiece = musicPieceForSetListItem(item, music);
  if (!linkedMusicPiece && !item.title.trim()) return "Enter a title for the set-list item.";
  if (!linkedMusicPiece && item.duration && parseSetListDuration(item.duration) === null) {
    return "Duration must be minutes, minutes:seconds, hours:minutes:seconds, or named units.";
  }
  return undefined;
}

export function setListItemForEdit(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): SetListItem {
  const linkedMusicPiece = musicPieceForSetListItem(item, music);
  return {
    ...item,
    title: linkedMusicPiece?.title ?? item.title.trim(),
    composer:
      itemType(item) === "song"
        ? (trimmedOrUndefined(linkedMusicPiece?.composer) ?? trimmedOrUndefined(item.composer))
        : undefined,
    duration: linkedMusicPiece
      ? (durationFromSeconds(linkedMusicPiece.durationSeconds) ??
        normalizeSetListDuration(item.duration))
      : normalizeSetListDuration(item.duration),
    notes: trimmedOrUndefined(item.notes),
  };
}

export function durationFromSeconds(seconds: number | null): string | undefined {
  return seconds && seconds > 0 ? formatSetListDuration(seconds) : undefined;
}

/** Duration formatted for display/summary: item's own normalized duration wins,
 * otherwise fall back to duration of the linked music piece if present. */
export function effectiveSetListItemDuration(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): string | undefined {
  const itemDuration = normalizeSetListDuration(item.duration);
  if (itemDuration) return itemDuration;
  const linkedPiece = musicPieceForSetListItem(item, music);
  return linkedPiece ? durationFromSeconds(linkedPiece.durationSeconds) : undefined;
}

/** Effective duration in seconds for an item, parsing its effective duration string. */
export function effectiveSetListItemDurationSeconds(
  item: SetListItem,
  music: readonly OrganizationMusicPiece[],
): number {
  const duration = effectiveSetListItemDuration(item, music);
  return duration ? (parseSetListDuration(duration) ?? 0) : 0;
}

export function normalizeItems(items: readonly SetListItem[]): SetListItem[] {
  return items.map((item) => ({ ...item, id: item.id ?? crypto.randomUUID() }));
}

export function setListHasLearningTrack(
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
): boolean {
  return items.some(
    (item) =>
      item.pieceId !== undefined &&
      music.some(
        (piece) =>
          (piece.id === item.pieceId || piece.parentId === item.pieceId) &&
          Object.keys(piece.trackFileIds).length > 0,
      ),
  );
}

export function moveItemToIndex(
  items: readonly SetListItem[],
  fromIndex: number,
  toIndex: number,
): SetListItem[] {
  let next = [...items];
  const direction: 1 | -1 = fromIndex < toIndex ? 1 : -1;
  for (let index = fromIndex; index !== toIndex; index += direction) {
    next = [...moveSetListItem(next, index, direction)];
  }
  return next;
}

export function displayEvent(event: OrganizationEvent): string {
  return `${event.title} — ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(event.startsAt))}`;
}

export function printDateOnly(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function printTimeOnly(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatPracticePlayerExpiration(
  status: PublicPlayerLinkStatus | null,
  locale?: string,
): string {
  if (!status || status.status === "none" || !status.expiresAt) {
    return "A Practice Player link has not been created yet.";
  }
  const timestamp = status.expiresAt < 10_000_000_000 ? status.expiresAt * 1000 : status.expiresAt;
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));

  if (status.status === "expired") {
    return `Practice Player link expired ${formatted}.`;
  }
  return `Practice Player link expires ${formatted}.`;
}

function printRowsFor(
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
): SetListPrintRow[] {
  const musicById = new Map(music.map((piece) => [piece.id, piece]));
  return items.map((item) => {
    const piece = item.pieceId ? musicById.get(item.pieceId) : undefined;
    const isFeaturedNumber = item.isFeaturedNumber ?? item.soloSmallGroup ?? false;
    return {
      arranger: piece?.arranger ?? "",
      composer: item.composer?.trim() ? item.composer : (piece?.composer ?? ""),
      notes: effectiveSetListItemNotes(item, music),
      performers: isFeaturedNumber
        ? (item.performerCredits ?? []).map(({ displayName }) => displayName).join(", ")
        : "",
      title: item.title,
    };
  });
}

export function setListPreviewRows(
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
): SetListPreviewRow[] {
  const rows = printRowsFor(items, music);
  let songNumber = 0;
  return items.map((item, index) => {
    const row = rows[index] ?? {
      arranger: "",
      composer: "",
      notes: effectiveSetListItemNotes(item, music),
      performers: "",
      title: item.title,
    };
    const kind = itemType(item);
    return {
      ...row,
      kind,
      number: kind === "song" ? (songNumber += 1) : null,
    };
  });
}

export function resolveEventVenueName(
  event: (OrganizationEvent & { venueName?: string | null }) | null | undefined,
  venues?: readonly OrganizationVenue[] | string,
): string | undefined {
  if (!event) return undefined;
  if (typeof venues === "string") {
    const trimmed = venues.trim();
    if (trimmed) return trimmed;
  }
  if (event.venueId && venues && typeof venues !== "string") {
    const venue = venues.find((candidate) => candidate.id === event.venueId);
    if (venue?.name) {
      const trimmed = venue.name.trim();
      if (trimmed) return trimmed;
    }
  }
  if (event.venueName && typeof event.venueName === "string") {
    const trimmed = event.venueName.trim();
    if (trimmed) return trimmed;
  }
  const location = event.location.trim();
  return location ? location : undefined;
}

function formatIntermissionLines(
  entry: PresentationIntermissionEntry,
  showNotes: boolean,
): string[] {
  return [entry.item.title, ...(showNotes && entry.notes ? indentedNoteLines(entry.notes) : [])];
}

function formatStandaloneLines(entry: PresentationStandaloneEntry, showNotes: boolean): string[] {
  const performers = formatPerformerCredits(entry.item);
  const lines: string[] = [
    `${String(entry.programNumber)}. ${entry.item.title}${entry.credit ? ` ~ ${entry.credit}` : ""}`,
  ];
  if (entry.parentPiece) {
    lines.push(`   from ${entry.parentPiece.title}`);
  }
  if (performers) {
    lines.push(`   Group — ${performers}`);
  }
  if (showNotes && entry.notes) {
    lines.push(...indentedNoteLines(entry.notes));
  }
  return lines;
}

function formatGroupLines(entry: PresentationGroupEntry, showNotes: boolean): string[] {
  const parentTitle = entry.parentItem?.title ?? entry.parentPiece.title;
  const parentPerformers = entry.parentItem ? formatPerformerCredits(entry.parentItem) : "";
  const lines: string[] = [
    `${String(entry.programNumber)}. ${parentTitle}${entry.credit ? ` ~ ${entry.credit}` : ""}`,
  ];
  if (parentPerformers) {
    lines.push(`   Group — ${parentPerformers}`);
  }
  if (showNotes && entry.notes) {
    lines.push(...indentedNoteLines(entry.notes));
  }

  for (const movement of entry.movements) {
    const mPerformers = formatPerformerCredits(movement.item);
    lines.push(`   ${movement.item.title}${movement.credit ? ` ~ ${movement.credit}` : ""}`);
    if (mPerformers) {
      lines.push(`      Group — ${mPerformers}`);
    }
    if (showNotes && movement.notes) {
      lines.push(...indentedNoteLines(movement.notes, "      "));
    }
  }

  return lines;
}

function formatPresentationEntryLines(
  entry: SetListPresentationEntry,
  showNotes: boolean,
): string[] {
  if (entry.kind === "intermission") {
    return formatIntermissionLines(entry, showNotes);
  }
  if (entry.kind === "standalone") {
    return formatStandaloneLines(entry, showNotes);
  }
  return formatGroupLines(entry, showNotes);
}

export function setListDocumentText(
  event: OrganizationEvent,
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
  showNotes = false,
  defaultTransitionSeconds?: number,
  venues?: readonly OrganizationVenue[] | string,
): string {
  const transitionSeconds = defaultTransitionSeconds ?? event.setListDefaultTransitionSeconds;
  const timing = calculateSetListTiming(items, transitionSeconds, (item) =>
    effectiveSetListItemDurationSeconds(item, music),
  );
  const entries = groupSetListForPresentation(items, music);
  const venue = resolveEventVenueName(event, venues);
  return [
    `Set List: ${event.title}`,
    `Date: ${printDateOnly(event.startsAt)}`,
    `Time: ${printTimeOnly(event.startsAt)}`,
    `Venue: ${venue ?? "—"}`,
    `Estimated runtime: ${formatSetListDuration(timing.estimatedRuntime)}`,
    ...(transitionSeconds > 0
      ? [`Default between-song time: ${formatSetListDuration(transitionSeconds)}`]
      : []),
    "",
    ...entries.flatMap((entry) => formatPresentationEntryLines(entry, showNotes)),
  ].join("\n");
}
