import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationVenue,
} from "@choir/contracts";
import { DataTable, DropdownMenu } from "@choir/ui";
import {
  calculateRsvpDeadline,
  isRsvpDeadlinePassed,
  zonedLocalDateTimeToUtc,
} from "@choir/domain";
import { displayEventDate, displayRsvpDeadline, displayRsvpDeadlineAt } from "./utils";
import type { EventsState } from "./types";

export function EventRsvpDeadlineNotice({
  eventStart,
  eventType,
  state,
}: {
  readonly eventStart: string;
  readonly eventType: OrganizationEventRequest["type"];
  readonly state: EventsState;
}) {
  if (eventType !== "Performance" || state.status !== "ready") return null;
  const draftStartsAt = zonedLocalDateTimeToUtc(eventStart, state.timezone);
  const draftDeadline =
    state.rsvpExpiryEnabled && draftStartsAt
      ? calculateRsvpDeadline(
          { startsAt: draftStartsAt, type: "Performance" },
          state.rsvpExpiryLeadDays,
          state.timezone,
        )
      : null;
  const draftDeadlinePassed = draftDeadline
    ? isRsvpDeadlinePassed(draftDeadline, new Date())
    : false;
  return (
    <p
      className={
        draftDeadlinePassed
          ? "notice notice--warning form-grid__wide"
          : "notice notice--info form-grid__wide"
      }
    >
      {state.rsvpExpiryEnabled
        ? draftDeadline
          ? draftDeadlinePassed
            ? `${displayRsvpDeadlineAt(draftDeadline.deadlineAt, true, state.timezone)}. Pending member RSVPs are closed. This date was calculated from the event start using the organization's RSVP expiry setting.`
            : `${displayRsvpDeadlineAt(draftDeadline.deadlineAt, false, state.timezone)} through 11:59 p.m. This date is calculated from the event start using the organization's RSVP expiry setting.`
          : "Enter a valid start date to calculate the member RSVP deadline."
        : "Automatic RSVP expiry is off, so pending member RSVPs do not close automatically."}{" "}
      <a href="/admin/roster?section=settings">
        {state.rsvpExpiryEnabled
          ? "Change RSVP expiry in Roster Settings"
          : "Configure RSVP expiry in Roster Settings"}
      </a>
    </p>
  );
}

export function EventList({
  events,
  filteredEvents,
  onArchive,
  onCancel,
  onClone,
  onEdit,
  timezone,
  venues,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly filteredEvents: readonly OrganizationEvent[];
  readonly onArchive: (event: OrganizationEvent) => void;
  readonly onCancel: (event: OrganizationEvent) => void;
  readonly onClone: (event: OrganizationEvent) => void;
  readonly onEdit: (event: OrganizationEvent) => void;
  readonly timezone: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  return (
    <DataTable
      columns={[
        {
          header: "Event",
          id: "event",
          render: (candidate) => (
            <div>
              <strong>{candidate.title}</strong>
              <small className="table-secondary">{candidate.type}</small>
              {candidate.isCanceled ? <span className="status-pill">Canceled</span> : null}
            </div>
          ),
        },
        {
          header: "Date",
          id: "date",
          render: (candidate) => (
            <div>
              {displayEventDate(candidate.startsAt, timezone)}
              {candidate.type === "Performance" && displayRsvpDeadline(candidate, timezone) ? (
                <small className="table-secondary">
                  {displayRsvpDeadline(candidate, timezone)}
                </small>
              ) : null}
            </div>
          ),
        },
        {
          header: "Venue",
          id: "venue",
          render: (candidate) => {
            const venueName = venues.find((venue) => venue.id === candidate.venueId)?.name;
            return venueName ?? candidate.location;
          },
        },
        {
          header: "Visibility",
          id: "visibility",
          render: (candidate) => (
            <span className="status-pill">
              {candidate.publishOnWebsite ? "Published" : "Internal"}
            </span>
          ),
        },
        {
          header: "Actions",
          id: "actions",
          mobileLabel: "Manage",
          render: (candidate) => (
            <div className="table-actions">
              <a
                className="text-button"
                href={`/admin/rsvp?eventId=${encodeURIComponent(candidate.id)}`}
              >
                RSVP
              </a>
              <button
                className="text-button"
                onClick={() => {
                  onEdit(candidate);
                }}
                type="button"
              >
                Edit
              </button>
              <DropdownMenu
                accessibleLabel={`More actions for ${candidate.title}`}
                items={[
                  {
                    label: "Clone",
                    onSelect: () => {
                      onClone(candidate);
                    },
                  },
                  {
                    disabled: candidate.isCanceled,
                    label: "Cancel",
                    onSelect: () => {
                      onCancel(candidate);
                    },
                  },
                  {
                    label: "Archive",
                    onSelect: () => {
                      onArchive(candidate);
                    },
                  },
                ]}
                trigger={
                  <button className="text-button table-actions__overflow" type="button">
                    <span aria-hidden="true">⋮</span>
                  </button>
                }
              />
            </div>
          ),
        },
      ]}
      emptyMessage="No events match your search."
      keySelector={(candidate) => candidate.id}
      onRowClick={onEdit}
      rowLabel={(candidate) => `Edit event ${candidate.title}`}
      rows={filteredEvents.length > 0 ? filteredEvents : events.length > 0 ? [] : events}
    />
  );
}
