import type { SingerEvent } from "@choir/contracts";
import type { ReactNode } from "react";
import { AppLink } from "./components/AuthenticatedShell/navigation";
import { formatCallTime, formatEventDateTile } from "./dashboardFormatters";

/** Shared presentation only; each workspace retains its own RSVP and practice actions. */
export function MemberEventCard({
  event,
  timezone,
  status,
  footer,
  children,
  navigate,
  className = "",
}: {
  readonly event: SingerEvent;
  readonly timezone: string;
  readonly status: ReactNode;
  readonly footer: ReactNode;
  readonly children?: ReactNode;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly className?: string;
}) {
  const date = formatEventDateTile(event.startsAt, timezone);
  const seatingVisible =
    event.type === "Performance" &&
    event.seating.status !== "not_published" &&
    event.seating.status !== "declined";
  return (
    <fieldset aria-label={event.title} className={`member-event-card ${className}`}>
      <time
        className="member-event-card__date"
        dateTime={event.startsAt}
        aria-label={date.fullLabel}
      >
        <span>
          {date.month} {date.year}
        </span>
        <strong>{date.day}</strong>
        <span>{date.weekday}</span>
      </time>
      <div className="member-event-card__body">
        <div className="member-event-card__heading">
          <h3>{event.title}</h3>
          <span className="member-event-card__type">{event.type}</span>
        </div>
        <EventTiming event={event} timezone={timezone} />
        <div className="member-event-card__venue">
          <strong>{event.venueName || event.location || "Location to be announced"}</strong>
          {event.venueAddress ? <span>{event.venueAddress}</span> : null}
        </div>
      </div>
      <div className="member-event-card__status">
        {status}
        {seatingVisible ? (
          <AppLink
            href={`/seating/${event.id}`}
            onNavigate={
              navigate ??
              ((href) => {
                window.location.assign(href);
              })
            }
          >
            {event.seating.status === "available" ? "View assigned seat" : "Seat not assigned"}
          </AppLink>
        ) : null}
      </div>
      {event.details || children ? (
        <div className="member-event-card__extra">
          {event.details ? (
            <div className="member-event-card__notes">
              <strong>Notes &amp; attire:</strong> {event.details}
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
      <div className="member-event-card__footer">{footer}</div>
    </fieldset>
  );
}

function EventTiming({
  event,
  timezone,
}: {
  readonly event: SingerEvent;
  readonly timezone: string;
}) {
  const arrival = formatCallTime(event.callTime);
  const starts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(event.startsAt));
  const minutes = event.durationMinutes;
  const duration =
    minutes && minutes % 60 === 0
      ? `${String(minutes / 60)} ${minutes === 60 ? "hour" : "hours"}`
      : minutes
        ? `${String(minutes)} minutes`
        : null;
  return (
    <div className="member-event-card__timing">
      {arrival ? <strong className="member-event-card__arrival">Arrive {arrival}</strong> : null}
      <strong>Starts {starts}</strong>
      {duration ? <span>{duration}</span> : null}
    </div>
  );
}
