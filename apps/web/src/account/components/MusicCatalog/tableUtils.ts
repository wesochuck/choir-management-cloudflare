import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
} from "@choir/contracts";

import { maximumAudioBytes } from "./utils";

export function trackKeys(
  piece: OrganizationMusicPiece,
  configuration: OrganizationRosterConfiguration,
  addedVoicePartLabels: readonly string[] = [],
): string[] {
  const keys = new Set([
    "tutti",
    ...configuration.sections.map(({ code }) => code),
    ...Object.keys(piece.trackFileIds),
    ...addedVoicePartLabels,
  ]);
  const sectionOrder = new Map(configuration.sections.map(({ code }, index) => [code, index]));
  const voicePartOrder = new Map(
    configuration.voiceParts.map(({ label }, index) => [label, index]),
  );
  const voicePartByLabel = new Map(
    configuration.voiceParts.map((voicePart) => [voicePart.label, voicePart]),
  );
  const voicePartStride = configuration.voiceParts.length + 2;

  return [...keys].toSorted((left, right) => {
    if (left === "tutti") return -1;
    if (right === "tutti") return 1;
    const leftSectionIndex = sectionOrder.get(left);
    const rightSectionIndex = sectionOrder.get(right);
    if (leftSectionIndex !== undefined && rightSectionIndex !== undefined) {
      return leftSectionIndex - rightSectionIndex;
    }
    if (leftSectionIndex !== undefined) return -1;
    if (rightSectionIndex !== undefined) return 1;
    const leftVoicePart = voicePartByLabel.get(left);
    const rightVoicePart = voicePartByLabel.get(right);
    if (leftVoicePart && rightVoicePart) {
      const sectionDifference =
        (sectionOrder.get(leftVoicePart.sectionCode) ?? Number.MAX_SAFE_INTEGER) -
        (sectionOrder.get(rightVoicePart.sectionCode) ?? Number.MAX_SAFE_INTEGER);
      return (
        sectionDifference * voicePartStride +
        (voicePartOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (voicePartOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (leftVoicePart) return -1;
    if (rightVoicePart) return 1;
    return left.localeCompare(right);
  });
}

export function trackDescription(
  key: string,
  configuration: OrganizationRosterConfiguration,
): string {
  if (key === "tutti") return "Full mix";
  return (
    configuration.sections.find(({ code }) => code === key)?.name ??
    configuration.voiceParts.find(({ label }) => label === key)?.fullName ??
    "Custom learning track"
  );
}

export function validateAudioFile(file: File): string | null {
  if (!file.type.startsWith("audio/")) {
    return "Learning tracks must be valid audio files.";
  }
  if (file.size <= 0 || file.size > maximumAudioBytes) {
    return "Learning tracks must be larger than 0 bytes and no more than 20 MB.";
  }
  return null;
}

export function eventRequestFrom(event: OrganizationEvent): OrganizationEventRequest {
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
    setList: event.setList,
    setListApproved: event.setListApproved,
    startsAt: event.startsAt,
    ticketCapacity: event.ticketCapacity,
    title: event.title,
    type: event.type,
    venueId: event.venueId,
  };
}

export function performanceDateLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function pieceIdsForPerformance(
  piece: OrganizationMusicPiece,
  allPieces: readonly OrganizationMusicPiece[],
): ReadonlySet<string> {
  const ids = new Set<string>([piece.id]);
  if (piece.parentId) {
    ids.add(piece.parentId);
  } else {
    allPieces.forEach((candidate) => {
      if (candidate.parentId === piece.id) ids.add(candidate.id);
    });
  }
  return ids;
}

export function performanceContainsPiece(
  event: OrganizationEvent,
  pieceIds: ReadonlySet<string>,
): boolean {
  return event.setList.some((item) => item.pieceId !== undefined && pieceIds.has(item.pieceId));
}

export function performanceSetListItem(
  piece: OrganizationMusicPiece,
): NonNullable<OrganizationEvent["setList"]>[number] {
  return {
    composer: piece.composer || undefined,
    id: crypto.randomUUID(),
    pieceId: piece.id,
    title: piece.title,
    type: "song",
  };
}
