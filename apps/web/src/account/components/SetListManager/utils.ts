import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationMusicPiece,
} from "@choir/contracts";
import { formatSetListDuration, moveSetListItem } from "@choir/domain";
import type { SetListItem, SetListPrintRow } from "./types";
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

export function printDateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export function printRowsFor(
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

export function setListDocumentText(
  event: OrganizationEvent,
  items: readonly SetListItem[],
  music: readonly OrganizationMusicPiece[],
): string {
  const rows = printRowsFor(items, music);
  return [
    event.title,
    printDateLabel(event.startsAt),
    "",
    ["Title", "Composer", "Arranger", "Small group / soloists"].join(" ~ "),
    ...rows.map(({ arranger, composer, performers, title }) =>
      [title, composer || "—", arranger || "—", performers || "—"].join(" ~ "),
    ),
  ].join("\n");
}
