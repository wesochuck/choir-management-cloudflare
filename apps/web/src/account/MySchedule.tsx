import type { SingerEvent, SingerEventsResponse } from "@choir/contracts";
import { normalizeSetListDuration } from "@choir/domain";
import { useEffect, useState } from "react";

import { AuthApiError, getMySchedule, setMyEventRsvp } from "../auth/api";
import { CalendarSubscription } from "./CalendarSubscription";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type ScheduleState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | ({ readonly status: "ready" } & SingerEventsResponse);

const RSVP_OPTIONS = ["Yes", "No"] as const;

function displayDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function displayRsvpDeadline(event: SingerEvent, timezone: string): string | null {
  if (!event.rsvpDeadlineAt || !event.rsvpDeadlineDate) return null;
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(new Date(event.rsvpDeadlineAt));
  return event.rsvpDeadlinePassed
    ? `RSVP deadline passed on ${date}.`
    : `RSVP by ${date} through 11:59 p.m.`;
}

function eventLocation(event: SingerEvent): string {
  if (event.venueName) {
    return event.venueAddress ? `${event.venueName}, ${event.venueAddress}` : event.venueName;
  }
  return event.location;
}

function rsvpNoteRequired(event: SingerEvent): boolean {
  return event.type === "Rehearsal" && event.directRsvp === "No";
}

function performerCredit(
  item: SingerEvent["setList"][number],
  performerLabelPlural: string,
): string | null {
  const credits = item.performerCredits?.map(({ displayName }) => displayName) ?? [];
  if (!item.isFeaturedNumber && !item.soloSmallGroup) return null;
  if (credits.length === 0) return `Featured ${performerLabelPlural.toLowerCase()} TBA`;
  return `Featured: ${credits.join(", ")}`;
}

function ScheduleRsvpField({
  busy,
  event,
  onChangeNote,
  onSave,
  onSelectRsvp,
}: {
  readonly busy: boolean;
  readonly event: SingerEvent;
  readonly onChangeNote: (note: string) => void;
  readonly onSave: () => void;
  readonly onSelectRsvp: (rsvp: "No" | "Yes") => void;
}) {
  return (
    <div className="field schedule-rsvp">
      <fieldset className="schedule-rsvp__choices">
        <legend>Your RSVP</legend>
        <div className="schedule-rsvp__buttons">
          {RSVP_OPTIONS.map((rsvp) => (
            <button
              aria-pressed={event.directRsvp === rsvp}
              className={
                event.directRsvp === rsvp ? "button button--primary" : "button button--secondary"
              }
              disabled={busy || !event.rsvpSelfServiceOpen}
              key={rsvp}
              onClick={() => {
                onSelectRsvp(rsvp);
              }}
              type="button"
            >
              {rsvp}
            </button>
          ))}
        </div>
      </fieldset>
      {event.directRsvp === "Pending" ? (
        <p className="field-help">Choose Yes or No before saving your RSVP.</p>
      ) : null}
      {event.directRsvp === "No" ? (
        <>
          <label htmlFor={`my-rsvp-note-${event.id}`}>
            Decline note{event.type === "Rehearsal" ? " (required)" : ""}
          </label>
          <textarea
            aria-required={event.type === "Rehearsal"}
            disabled={busy || !event.rsvpSelfServiceOpen}
            id={`my-rsvp-note-${event.id}`}
            maxLength={2000}
            onChange={(change) => {
              onChangeNote(change.target.value);
            }}
            required={event.type === "Rehearsal"}
            rows={3}
            value={event.rsvpNote}
          />
        </>
      ) : null}
      <button
        className="button button--secondary"
        disabled={
          busy ||
          !event.rsvpSelfServiceOpen ||
          event.directRsvp === "Pending" ||
          (rsvpNoteRequired(event) && !event.rsvpNote.trim())
        }
        onClick={onSave}
        type="button"
      >
        Save RSVP
      </button>
    </div>
  );
}

export function MySchedule({ enabled }: { readonly enabled: boolean }) {
  const { performerLabelPlural } = useOrganizationTerminology();
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [state, setState] = useState<ScheduleState>({ status: "loading" });
  const [showPastEvents, setShowPastEvents] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getMySchedule(controller.signal, showPastEvents)
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
  }, [enabled, showPastEvents]);

  function togglePastEvents(includePast: boolean): void {
    setShowPastEvents(includePast);
    setState({ status: "loading" });
  }

  async function changeRsvp(eventId: string, rsvp: "No" | "Pending" | "Yes", rsvpNote: string) {
    setBusyEventId(eventId);
    setFeedback(null);
    try {
      const saved = await setMyEventRsvp(eventId, rsvp, rsvpNote);
      try {
        const refreshed = await getMySchedule(undefined, showPastEvents);
        setState({ ...refreshed, status: "ready" });
      } catch {
        setState((current) =>
          current.status === "ready"
            ? {
                ...current,
                events: current.events.map((event) =>
                  event.id === eventId
                    ? {
                        ...event,
                        directRsvp: saved.rsvp,
                        inheritedFromParent: false,
                        resolvedRsvp: saved.rsvp,
                        rsvpNote: saved.rsvpNote,
                      }
                    : event,
                ),
              }
            : current,
        );
      }
      setFeedback("Your RSVP was updated.");
    } catch (error: unknown) {
      setFeedback(
        error instanceof AuthApiError ? error.message : "Your RSVP could not be updated.",
      );
    } finally {
      setBusyEventId(null);
    }
  }

  function updateDraftRsvp(eventId: string, rsvp: "No" | "Yes"): void {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            events: current.events.map((candidate) =>
              candidate.id === eventId
                ? {
                    ...candidate,
                    directRsvp: rsvp,
                    inheritedFromParent: false,
                    resolvedRsvp: rsvp,
                    rsvpNote: rsvp === "No" ? candidate.rsvpNote : "",
                  }
                : candidate,
            ),
          }
        : current,
    );
  }

  function updateDraftRsvpNote(eventId: string, rsvpNote: string): void {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            events: current.events.map((candidate) =>
              candidate.id === eventId ? { ...candidate, rsvpNote } : candidate,
            ),
          }
        : current,
    );
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
      <div className="my-schedule__controls">
        <label className="checkbox-row" htmlFor="my-schedule-show-past">
          <input
            checked={showPastEvents}
            disabled={!enabled}
            id="my-schedule-show-past"
            onChange={(event) => {
              togglePastEvents(event.target.checked);
            }}
            type="checkbox"
          />
          Show past events
        </label>
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
          <p className="empty-state">
            {showPastEvents ? "No upcoming or recent events are available." : "No upcoming events."}
          </p>
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
                    {event.type === "Performance" && displayRsvpDeadline(event, state.timezone) ? (
                      <p
                        className={
                          event.rsvpDeadlinePassed
                            ? "notice notice--warning"
                            : "notice notice--info"
                        }
                      >
                        {displayRsvpDeadline(event, state.timezone)}{" "}
                        {event.rsvpDeadlinePassed ? "Member self-service RSVP is closed." : null}{" "}
                        <a href="/admin/roster?section=settings">Roster Settings</a>
                      </p>
                    ) : null}
                    {event.inheritedFromParent ? (
                      <p>Currently inherited from the parent performance: {event.resolvedRsvp}</p>
                    ) : null}
                    {event.setList.length > 0 ? (
                      <div className="schedule-set-list">
                        <h4>Approved set list</h4>
                        <ol>
                          {event.setList.map((item, index) => {
                            const credit = performerCredit(item, performerLabelPlural);
                            const duration = normalizeSetListDuration(item.duration);
                            return (
                              <li key={item.id ?? `${item.title}-${String(index)}`}>
                                <strong>{item.title}</strong>
                                {item.composer ? ` — ${item.composer}` : ""}
                                {duration ? ` (${duration})` : ""}
                                {credit ? <span>{credit}</span> : null}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ) : null}
                  </div>
                  <ScheduleRsvpField
                    busy={busyEventId !== null}
                    event={event}
                    onChangeNote={(rsvpNote) => {
                      updateDraftRsvpNote(event.id, rsvpNote);
                    }}
                    onSave={() => {
                      void changeRsvp(event.id, event.directRsvp, event.rsvpNote);
                    }}
                    onSelectRsvp={(rsvp) => {
                      updateDraftRsvp(event.id, rsvp);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      <CalendarSubscription enabled={enabled} />
    </section>
  );
}
