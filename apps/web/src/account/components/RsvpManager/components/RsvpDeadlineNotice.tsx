import type { OrganizationEvent } from "@choir/contracts";

export function RsvpDeadlineNotice({ event }: { readonly event: OrganizationEvent | null }) {
  if (event?.type !== "Performance" || !event.rsvpDeadlineDate) return null;
  return (
    <p
      className={`rsvp-manager__deadline-notice ${
        event.rsvpDeadlinePassed ? "notice notice--warning" : "notice notice--info"
      }`}
    >
      {event.rsvpDeadlinePassed
        ? `Member self-service RSVP is closed. The deadline was ${event.rsvpDeadlineDate}. Administrators can still override responses.`
        : `Member RSVP deadline: ${event.rsvpDeadlineDate} through 11:59 p.m.`}
    </p>
  );
}
