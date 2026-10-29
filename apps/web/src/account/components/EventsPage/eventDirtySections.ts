import type { OrganizationEventRequest } from "@choir/contracts";
import type { EventEditorSection } from "./eventSections";

// Keep attribution exhaustive as the event contract grows.
const FIELD_SECTIONS = {
  title: "basics",
  type: "basics",
  details: "basics",
  setList: "basics",
  setListApproved: "basics",
  setListDefaultTransitionSeconds: "basics",
  startsAt: "schedule",
  callTime: "schedule",
  doorsOpenTime: "schedule",
  durationMinutes: "schedule",
  location: "schedule",
  venueId: "schedule",
  parentPerformanceId: "schedule",
  rsvpDeadlineDate: "rsvp",
  rsvpFollowUpMode: "rsvp",
  rsvpFollowUpLeadHours: "rsvp",
  otherEventAudience: "rsvp",
  otherEventRsvpMode: "rsvp",
  otherEventStaffingGoal: "rsvp",
  advancePriceCents: "tickets",
  dayOfPriceCents: "tickets",
  isTicketingEnabled: "tickets",
  ticketCapacity: "tickets",
  publicDetails: "public",
  publicGraphicFileId: "public",
  publishOnWebsite: "public",
} satisfies Record<keyof OrganizationEventRequest, EventEditorSection>;

function isEventField(field: string): field is keyof OrganizationEventRequest {
  return Object.hasOwn(FIELD_SECTIONS, field);
}

export function eventDirtySections(
  current: OrganizationEventRequest,
  baseline: OrganizationEventRequest,
): Record<EventEditorSection, boolean> {
  const result: Record<EventEditorSection, boolean> = {
    basics: false,
    schedule: false,
    rsvp: false,
    tickets: false,
    public: false,
    promotion: false,
  };
  for (const field of Object.keys(FIELD_SECTIONS)) {
    if (isEventField(field) && JSON.stringify(current[field]) !== JSON.stringify(baseline[field]))
      result[FIELD_SECTIONS[field]] = true;
  }
  return result;
}
