import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationMusicPiece,
} from "@choir/contracts";
import {
  formatSetListDuration,
  moveSetListItem,
  normalizeSetListDuration,
  parseSetListDuration,
} from "@choir/domain";
import type { SetListItem, SetListPreviewRow, SetListPrintRow } from "./types";
import type { Resources } from "./types";

export const emptyResources: Resources = {
  events: [],
  music: [],
  profiles: [],
};

export function eventRequestFrom(
  event: OrganizationEvent,
  setList: SetListItem[],
  approved: boolean,
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
    setList,
    setListApproved: approved,
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
      ? durationFromSeconds(linkedMusicPiece.durationSeconds)
      : normalizeSetListDuration(item.duration),
    notes: trimmedOrUndefined(item.notes),
  };
}

export function durationFromSeconds(seconds: number | null): string | undefined {
  return seconds && seconds > 0 ? formatSetListDuration(seconds) : undefined;
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
    const row = rows[index] ?? { arranger: "", composer: "", performers: "", title: item.title };
    const kind = itemType(item);
    return {
      ...row,
      kind,
      number: kind === "song" ? (songNumber += 1) : null,
    };
  });
}

export function setListDocumentText(
  event: OrganizationEvent,
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
): string {
  const rows = setListPreviewRows(items, music);
  return [
    `Set List: ${event.title}`,
    `Date: ${printDateOnly(event.startsAt)}`,
    `Time: ${printTimeOnly(event.startsAt)}`,
    `Venue: ${event.location || "—"}`,
    "",
    ...rows.flatMap(({ arranger, composer, kind, number, performers, title }) => {
      if (kind === "intermission") return [title];
      const credit = composer || arranger;
      return [
        `${String(number)}. ${title}${credit ? ` ~ ${credit}` : ""}`,
        ...(performers ? [`   Group — ${performers}`] : []),
      ];
    }),
  ].join("\n");
}
