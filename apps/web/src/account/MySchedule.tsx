import type { SingerEvent, SingerEventsResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import { AuthApiError, getMySchedule, setMyEventRsvp } from "../auth/api";

type ScheduleState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | ({ readonly status: "ready" } & SingerEventsResponse);

function displayDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function eventLocation(event: SingerEvent): string {
  if (event.venueName) {
    return event.venueAddress ? `${event.venueName}, ${event.venueAddress}` : event.venueName;
  }
  return event.location;
}

export function MySchedule({ enabled }: { readonly enabled: boolean }) {
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [state, setState] = useState<ScheduleState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getMySchedule(controller.signal)
      .then((schedule) => {
        setState({ ...schedule, status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: error instanceof AuthApiError && error.status === 404 ? "missing" : "error",
        });
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function changeRsvp(eventId: string, rsvp: "No" | "Pending" | "Yes") {
    setBusyEventId(eventId);
    setFeedback(null);
    try {
      await setMyEventRsvp(eventId, rsvp);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              events: current.events.map((event) =>
                event.id === eventId
                  ? { ...event, directRsvp: rsvp, inheritedFromParent: false, resolvedRsvp: rsvp }
                  : event,
              ),
            }
          : current,
      );
      setFeedback("Your RSVP was updated.");
    } catch (error: unknown) {
      setFeedback(
        error instanceof AuthApiError ? error.message : "Your RSVP could not be updated.",
      );
    } finally {
      setBusyEventId(null);
    }
  }

  return (
    <section
      className="account-section account-section--my-schedule"
      aria-labelledby="my-schedule-title"
    >
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Your events</p>
        <h2 id="my-schedule-title">My schedule</h2>
      </div>
      {!enabled ? (
        <p className="notice notice--warning">Verify Organization MFA to view your schedule.</p>
      ) : null}
      {enabled && state.status === "loading" ? <p>Loading your schedule…</p> : null}
      {enabled && state.status === "missing" ? (
        <p className="empty-state">
          Link this Membership to an Organization Profile to manage personal RSVPs.
        </p>
      ) : null}
      {enabled && state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Your schedule could not be loaded.
        </p>
      ) : null}
      {feedback ? (
        <p
          className={
            feedback.includes("updated") ? "notice notice--success" : "notice notice--error"
          }
          role="status"
        >
          {feedback}
        </p>
      ) : null}
      {enabled && state.status === "ready" ? (
        state.events.length === 0 ? (
          <p className="empty-state">No upcoming or recent events are available.</p>
        ) : (
          <ul className="account-list schedule-list">
            {state.events.map((event) => {
              const location = eventLocation(event);
              return (
                <li key={event.id}>
                  <div>
                    <h3>{event.title}</h3>
                    <p>
                      {event.type} · {displayDate(event.startsAt, state.timezone)} ({state.timezone}
                      )
                    </p>
                    {location ? <p>{location}</p> : null}
                    {event.inheritedFromParent ? (
                      <p>Currently inherited from the parent performance: {event.resolvedRsvp}</p>
                    ) : null}
                  </div>
                  <div className="field schedule-rsvp">
                    <label htmlFor={`my-rsvp-${event.id}`}>Your RSVP</label>
                    <select
                      disabled={busyEventId !== null}
                      id={`my-rsvp-${event.id}`}
                      onChange={(change) => {
                        const value = change.target.value;
                        const rsvp = value === "Yes" || value === "No" ? value : "Pending";
                        void changeRsvp(event.id, rsvp);
                      }}
                      value={event.directRsvp}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
