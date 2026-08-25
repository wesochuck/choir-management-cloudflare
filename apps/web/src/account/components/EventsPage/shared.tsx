import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationVenue,
} from "@choir/contracts";
import { isRsvpDeadlinePassed, rsvpDeadlineFromDate } from "@choir/domain";
import { DataTable, DropdownMenu } from "@choir/ui";
import { displayEventDate, displayRsvpDeadline, displayRsvpDeadlineAt } from "./utils";
import type { EventsState } from "./types";

export function EventRsvpDeadlineNotice({
  deadlineDate,
  eventType,
  state,
}: {
  readonly deadlineDate: string | null;
  readonly eventType: OrganizationEventRequest["type"];
  readonly state: EventsState;
}) {
  if (eventType !== "Performance" || state.status !== "ready") return null;
  if (!deadlineDate) {
    return (
      <p className="notice notice--warning form-grid__wide">
        Choose the member RSVP deadline. Responses stay open through 11:59 p.m. Organization time on
        that date.
      </p>
    );
  }
  const draftDeadline = rsvpDeadlineFromDate(deadlineDate, state.timezone);
  if (!draftDeadline) return null;
  const draftDeadlinePassed = isRsvpDeadlinePassed(draftDeadline, new Date());
  return (
    <p
      className={
        draftDeadlinePassed
          ? "notice notice--warning form-grid__wide"
          : "notice notice--info form-grid__wide"
      }
    >
      {draftDeadlinePassed
        ? `${displayRsvpDeadlineAt(draftDeadline.deadlineAt, true, state.timezone)}. Member self-service RSVP is closed from the start; administrators can still record responses.`
        : `${displayRsvpDeadlineAt(draftDeadline.deadlineAt, false, state.timezone)} through 11:59 p.m.`}{" "}
      Members can respond until this deadline.
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
