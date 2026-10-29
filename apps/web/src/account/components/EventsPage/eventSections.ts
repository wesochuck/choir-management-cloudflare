import type { OrganizationEventRequest, OrganizationVenue } from "@choir/contracts";
import { zonedLocalDateTimeToUtc } from "@choir/domain";
import type { EventsState } from "./types";

export type EventEditorSection =
  "basics" | "schedule" | "rsvp" | "tickets" | "public" | "promotion";

export const EVENT_EDITOR_SECTIONS: readonly EventEditorSection[] = [
  "basics",
  "schedule",
  "rsvp",
  "tickets",
  "public",
  "promotion",
];

export const EVENT_EDITOR_SECTION_META: Record<
  EventEditorSection,
  { readonly description: string; readonly label: string; readonly shortLabel: string }
> = {
  basics: {
    description: "Title and internal notes",
    label: "Basics",
    shortLabel: "01 Basics",
  },
  schedule: {
    description: "Time and required location",
    label: "Schedule & venue",
    shortLabel: "02 Schedule & venue",
  },
  rsvp: {
    description: "Deadline and follow-up",
    label: "RSVPs & reminders",
    shortLabel: "03 RSVPs & reminders",
  },
  tickets: {
    description: "Prices, capacity, QR",
    label: "Ticket sales",
    shortLabel: "04 Ticket sales",
  },
  public: {
    description: "Description and graphic",
    label: "Public content",
    shortLabel: "05 Public content",
  },
  promotion: {
    description: "Invite past ticket buyers and Contacts",
    label: "Promotion",
    shortLabel: "06 Promotion",
  },
};

export function visibleEditorSections(
  type: OrganizationEventRequest["type"],
): readonly EventEditorSection[] {
  if (type === "Rehearsal") return ["basics", "schedule", "public"];
  if (type === "Other") return ["basics", "schedule", "rsvp"];
  return EVENT_EDITOR_SECTIONS;
}

export function sectionFromInitialSection(
  value: string | null | undefined,
  type: OrganizationEventRequest["type"],
): EventEditorSection | null {
  if (value === "tickets" && type === "Performance") return "tickets";
  if (value === "promotion" && type === "Performance") return "promotion";
  return null;
}

export type SectionErrors = Record<EventEditorSection, readonly string[]>;

function basicsErrors(event: OrganizationEventRequest): string[] {
  const errors: string[] = [];
  const title = event.title.trim();
  if (!title) errors.push("Enter an event title.");
  else if (title.length > 500) errors.push("Title must be 500 characters or fewer.");
  if (event.details.length > 100_000) {
    errors.push("Internal details must be 100,000 characters or fewer.");
  }
  return errors;
}

function startErrors(eventStart: string, state: EventsState): string[] {
  const timezone = state.status === "ready" ? state.timezone : null;
  const startsAt = timezone ? zonedLocalDateTimeToUtc(eventStart, timezone) : null;
  if (!eventStart || !startsAt) return ["Enter a valid start date and time."];
  return [];
}

function venueErrors(event: OrganizationEventRequest, state: EventsState): string[] {
  if (event.venueId === null || event.venueId === "") {
    return ["Select a saved venue before saving this event."];
  }
  if (state.status === "ready") {
    const known = state.venues.some((venue) => venue.id === event.venueId);
    if (!known) return ["The selected venue is no longer available. Choose another venue."];
  }
  return [];
}

function parentErrors(event: OrganizationEventRequest, state: EventsState): string[] {
  if (event.type !== "Rehearsal" && event.parentPerformanceId !== null) {
    return ["A parent performance can only be selected for a rehearsal."];
  }
  if (event.type !== "Rehearsal" || event.parentPerformanceId === null) return [];
  const parent =
    state.status === "ready"
      ? state.events.find((candidate) => candidate.id === event.parentPerformanceId)
      : undefined;
  if (parent?.type !== "Performance") {
    return ["The linked parent performance is no longer available."];
  }
  return [];
}

function scheduleErrors(
  event: OrganizationEventRequest,
  eventStart: string,
  state: EventsState,
): string[] {
  return [
    ...startErrors(eventStart, state),
    ...venueErrors(event, state),
    ...parentErrors(event, state),
  ];
}

function rsvpPerformanceErrors(event: OrganizationEventRequest): string[] {
  const errors: string[] = [];
  if (event.rsvpDeadlineDate === null || event.rsvpDeadlineDate === "") {
    errors.push("A member RSVP deadline is required for a Performance.");
  }
  if (event.rsvpFollowUpMode === "enabled") {
    if (event.rsvpFollowUpLeadHours === null) {
      errors.push("An RSVP follow-up lead time is required when the event override is enabled.");
    } else if (
      !Number.isInteger(event.rsvpFollowUpLeadHours) ||
      event.rsvpFollowUpLeadHours < 1 ||
      event.rsvpFollowUpLeadHours > 720
    ) {
      errors.push("Follow-up lead hours must be a whole number between 1 and 720.");
    }
  } else if (event.rsvpFollowUpLeadHours !== null) {
    errors.push("A custom RSVP follow-up lead time requires an enabled event override.");
  }
  return errors;
}

function rsvpRehearsalErrors(event: OrganizationEventRequest): string[] {
  const errors: string[] = [];
  if (event.rsvpDeadlineDate !== null) {
    errors.push("Rehearsals do not use an RSVP deadline.");
  }
  if (event.rsvpFollowUpMode !== "inherit") {
    errors.push("Rehearsals inherit RSVP follow-up settings from their parent Performance.");
  } else if (event.rsvpFollowUpLeadHours !== null) {
    errors.push("A custom RSVP follow-up lead time requires an enabled event override.");
  }
  return errors;
}

function rsvpOtherErrors(event: OrganizationEventRequest): string[] {
  const errors: string[] = [];
  if (event.otherEventStaffingGoal !== null && event.otherEventStaffingGoal !== undefined) {
    if (event.otherEventRsvpMode === "off") {
      errors.push("A staffing goal requires RSVP to be optional or response requested.");
    } else if (
      !Number.isInteger(event.otherEventStaffingGoal) ||
      event.otherEventStaffingGoal < 1 ||
      event.otherEventStaffingGoal > 10_000
    ) {
      errors.push("Staffing goal must be a positive whole number.");
    }
  }
  if (event.otherEventAudience?.type === "targeted") {
    const hasVoice = (event.otherEventAudience.voiceParts?.length ?? 0) > 0;
    const hasProfile = (event.otherEventAudience.profileIds?.length ?? 0) > 0;
    if (!hasVoice && !hasProfile) {
      errors.push("Select at least one voice part or singer for a targeted audience.");
    }
  }
  return errors;
}

function ticketsErrors(event: OrganizationEventRequest): string[] {
  const errors: string[] = [];
  if (event.type === "Performance" && event.isTicketingEnabled) {
    if (event.ticketCapacity !== null) {
      if (!Number.isInteger(event.ticketCapacity) || event.ticketCapacity < 1) {
        errors.push("Ticket capacity must be a whole number of at least 1.");
      } else if (event.ticketCapacity > 100_000) {
        errors.push("Ticket capacity must be 100,000 or fewer.");
      }
    }
    if (
      !Number.isInteger(event.advancePriceCents) ||
      event.advancePriceCents < 0 ||
      event.advancePriceCents > 10_000_000
    ) {
      errors.push("Advance price is invalid.");
    }
    if (
      !Number.isInteger(event.dayOfPriceCents) ||
      event.dayOfPriceCents < 0 ||
      event.dayOfPriceCents > 10_000_000
    ) {
      errors.push("Day-of price is invalid.");
    }
  }
  if (event.type !== "Performance" && event.isTicketingEnabled) {
    errors.push("Ticket sales are only available for Performances.");
  }
  return errors;
}

function publicErrors(event: OrganizationEventRequest, graphicError: string | null): string[] {
  const errors: string[] = [];
  if (graphicError) errors.push(graphicError);
  if (event.publicDetails.length > 100_000) {
    errors.push("Public details must be 100,000 characters or fewer.");
  }
  return errors;
}

export function computeSectionErrors(options: {
  readonly event: OrganizationEventRequest;
  readonly eventStart: string;
  readonly graphicError: string | null;
  readonly state: EventsState;
}): SectionErrors {
  const { event, eventStart, graphicError, state } = options;
  return {
    basics: basicsErrors(event),
    public: publicErrors(event, graphicError),
    rsvp:
      event.type === "Performance"
        ? rsvpPerformanceErrors(event)
        : event.type === "Other"
          ? rsvpOtherErrors(event)
          : rsvpRehearsalErrors(event),
    schedule: scheduleErrors(event, eventStart, state),
    tickets: ticketsErrors(event),
    promotion: [],
  };
}

export function countSectionErrors(errors: SectionErrors): Record<EventEditorSection, number> {
  return {
    basics: errors.basics.length,
    public: errors.public.length,
    rsvp: errors.rsvp.length,
    schedule: errors.schedule.length,
    tickets: errors.tickets.length,
    promotion: errors.promotion.length,
  };
}

export function totalErrorCount(errors: SectionErrors): number {
  return (
    errors.basics.length +
    errors.schedule.length +
    errors.rsvp.length +
    errors.tickets.length +
    errors.public.length
  );
}

export function isSectionRequired(
  section: EventEditorSection,
  type: OrganizationEventRequest["type"],
): boolean {
  if (section === "basics") return true;
  if (section === "schedule") return true;
  if (section === "rsvp") return type === "Performance";
  return false;
}

export function firstInvalidSection(
  errors: SectionErrors,
  visible: readonly EventEditorSection[],
): EventEditorSection | null {
  for (const section of visible) {
    if (errors[section].length > 0) return section;
  }
  return null;
}

export function firstInvalidFieldId(
  section: EventEditorSection,
  event: OrganizationEventRequest,
): string {
  switch (section) {
    case "basics":
      return !event.title.trim() ? "events-page-title" : "events-page-type";
    case "schedule":
      return firstInvalidScheduleFieldId(event);
    case "rsvp":
      return firstInvalidRsvpFieldId(event);
    case "tickets":
      if (event.isTicketingEnabled) return "events-page-capacity";
      return "events-page-enable-ticketing";
    case "public":
      return "events-page-public-details";
    case "promotion":
      return "event-promotion-heading";
  }
}

function firstInvalidScheduleFieldId(event: OrganizationEventRequest): string {
  // Venue takes precedence when both start and venue are invalid,
  // matching the mockup's missing-venue emphasis.
  return event.venueId === null || event.venueId === "" ? "events-page-venue" : "events-page-start";
}

function firstInvalidRsvpFieldId(event: OrganizationEventRequest): string {
  if (
    event.type === "Performance" &&
    (event.rsvpDeadlineDate === null || event.rsvpDeadlineDate === "")
  ) {
    return "events-page-rsvp-deadline";
  }
  if (event.type === "Other") return "events-page-other-rsvp-mode";
  return event.rsvpFollowUpMode === "enabled"
    ? "events-page-rsvp-follow-up-hours"
    : "events-page-rsvp-follow-up-mode";
}

export function getTbdVenueForEvent(
  venueId: string | null,
  venues: readonly OrganizationVenue[],
): { readonly isTbd: boolean; readonly name: string | null } {
  if (!venueId) return { isTbd: false, name: null };
  const venue = venues.find((candidate) => candidate.id === venueId);
  if (!venue) return { isTbd: false, name: null };
  const normalized = venue.name.trim().toLocaleLowerCase();
  return { isTbd: normalized === "tbd", name: venue.name };
}

export function firstFieldIdForSection(
  section: EventEditorSection,
  event: OrganizationEventRequest,
): string {
  switch (section) {
    case "basics":
      return "events-page-title";
    case "schedule":
      return "events-page-start";
    case "rsvp":
      return event.type === "Performance"
        ? "events-page-rsvp-deadline"
        : "events-page-other-rsvp-mode";
    case "tickets":
      return "events-page-enable-ticketing";
    case "public":
      return "events-page-public-details";
    case "promotion":
      return "event-promotion-heading";
  }
}

export function areRequiredFieldsComplete(
  sectionErrors: SectionErrors,
  visibleSections: readonly EventEditorSection[],
  type: OrganizationEventRequest["type"],
): boolean {
  for (const section of visibleSections) {
    if (isSectionRequired(section, type) && sectionErrors[section].length > 0) {
      return false;
    }
  }
  for (const section of visibleSections) {
    if (sectionErrors[section].length > 0) {
      return false;
    }
  }
  return true;
}

export interface EventPrimaryAction {
  readonly accessibleLabel: string;
  readonly label: string;
  readonly mode: "next" | "save";
  readonly shortLabel: string;
  readonly targetSection?: EventEditorSection;
}

export function resolveEventPrimaryAction(options: {
  readonly activeSection: EventEditorSection;
  readonly busy: boolean;
  readonly editingId: string | null;
  readonly sectionErrors: SectionErrors;
  readonly type: OrganizationEventRequest["type"];
  readonly visibleSections: readonly EventEditorSection[];
}): EventPrimaryAction {
  const { activeSection, busy, editingId, sectionErrors, type, visibleSections } = options;

  if (busy) {
    return {
      accessibleLabel: "Saving…",
      label: "Saving…",
      mode: "save",
      shortLabel: "Saving…",
    };
  }

  if (editingId !== null) {
    return {
      accessibleLabel: "Save event",
      label: "Save event",
      mode: "save",
      shortLabel: "Save",
    };
  }

  const allComplete = areRequiredFieldsComplete(sectionErrors, visibleSections, type);
  if (allComplete) {
    return {
      accessibleLabel: "Create event",
      label: "Create event",
      mode: "save",
      shortLabel: "Create",
    };
  }

  const currentIndex = visibleSections.indexOf(activeSection);
  const nextSection =
    currentIndex >= 0 && currentIndex < visibleSections.length - 1
      ? visibleSections[currentIndex + 1]
      : undefined;

  if (nextSection) {
    const meta = EVENT_EDITOR_SECTION_META[nextSection];
    return {
      accessibleLabel: `Next: ${meta.label}`,
      label: `Next: ${meta.label} →`,
      mode: "next",
      shortLabel: "Next →",
      targetSection: nextSection,
    };
  }

  return {
    accessibleLabel: "Create event",
    label: "Create event",
    mode: "save",
    shortLabel: "Create",
  };
}
