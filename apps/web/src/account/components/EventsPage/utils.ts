import type { OrganizationEvent, OrganizationEventRequest } from "@choir/contracts";
import { utcToZonedLocalDateTime, zonedLocalDateTimeToUtc } from "@choir/domain";
import type { EventsState } from "./types";

export const emptyEvent: OrganizationEventRequest = {
  advancePriceCents: 0,
  callTime: "",
  dayOfPriceCents: 0,
  details: "",
  doorsOpenTime: "",
  durationMinutes: null,
  isTicketingEnabled: false,
  location: "",
  parentPerformanceId: null,
  publicDetails: "",
  publicGraphicFileId: null,
  publishOnWebsite: false,
  rsvpFollowUpLeadHours: null,
  rsvpFollowUpMode: "inherit",
  setList: [],
  setListApproved: false,
  startsAt: new Date(0).toISOString(),
  ticketCapacity: null,
  title: "",
  type: "Rehearsal",
  venueId: null,
};

export const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function readRsvpFollowUpMode(value: string): OrganizationEventRequest["rsvpFollowUpMode"] {
  if (value === "enabled" || value === "disabled") return value;
  return "inherit";
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
    parentPerformanceId: event.type === "Rehearsal" ? event.parentPerformanceId : null,
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

export function displayEventDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function displayRsvpDeadline(event: OrganizationEvent, timezone: string): string | null {
  if (!event.rsvpDeadlineAt || !event.rsvpDeadlineDate) return null;
  return displayRsvpDeadlineAt(event.rsvpDeadlineAt, event.rsvpDeadlinePassed, timezone);
}

export function displayRsvpDeadlineAt(value: string, passed: boolean, timezone: string): string {
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(new Date(value));
  return passed ? `RSVP deadline passed · ${date}` : `RSVP by ${date}`;
}

export function optionalInteger(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function currencyDraftFromCents(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

export function currencyCentsFromDraft(value: string): number {
  const trimmed = value.trim();
  if (!/^\d*(?:\.\d*)?$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
}

export function eventDialogDescription(state: EventsState): string {
  return state.status === "ready"
    ? `Times are entered in ${state.timezone}.`
    : "Create or update an Organization event.";
}

export function eventDialogTitle(editingId: string | null, title: string): string {
  if (editingId) return "Edit event";
  return title.endsWith(" copy") ? "Clone event" : "Create event";
}

export function shouldShowPageError(
  error: string | null,
  dialogOpen: boolean,
  archiveCandidate: OrganizationEvent | null,
  cancelCandidate: OrganizationEvent | null,
): boolean {
  return error !== null && !dialogOpen && archiveCandidate === null && cancelCandidate === null;
}

export function eventSaveLabel(busy: boolean, editingId: string | null): string {
  if (busy) return "Saving…";
  return editingId ? "Save event" : "Create event";
}

export function rehearsalDatesBeforePerformance(
  performance: OrganizationEvent,
  count: number,
  dayOfWeek: number,
  time: string,
  timezone: string,
): readonly string[] | null {
  const localPerformanceStart = utcToZonedLocalDateTime(performance.startsAt, timezone);
  if (!localPerformanceStart) return null;
  const performanceDate = localPerformanceStart.slice(0, 10);
  const cursor = new Date(`${performanceDate}T12:00:00Z`);
  if (!Number.isFinite(cursor.getTime())) return null;
  while (cursor.getUTCDay() !== dayOfWeek) cursor.setUTCDate(cursor.getUTCDate() - 1);
  if (cursor.getTime() >= new Date(`${performanceDate}T00:00:00Z`).getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = cursor.toISOString().slice(0, 10);
    const startsAt = zonedLocalDateTimeToUtc(`${date}T${time}`, timezone);
    if (!startsAt) return null;
    dates.push(startsAt);
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return dates.reverse();
}
