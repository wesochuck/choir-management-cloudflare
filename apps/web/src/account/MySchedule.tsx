import type { SingerEvent, SingerEventsResponse } from "@choir/contracts";
import { normalizeSetListDuration } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import { useCallback, useEffect, useState } from "react";

import { AuthApiError, getMySchedule, setMyEventRsvp } from "../auth/api";
import { CalendarSubscription } from "./CalendarSubscription";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

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

function performerCredit(
  item: SingerEvent["setList"][number],
  performerLabelPlural: string,
): string | null {
  const credits = item.performerCredits?.map(({ displayName }) => displayName) ?? [];
  if (!item.isFeaturedNumber && !item.soloSmallGroup) return null;
  if (credits.length === 0) return `Featured ${performerLabelPlural.toLowerCase()} TBA`;
  return `Featured: ${credits.join(", ")}`;
}

function ScheduleRsvpHeader({
  resolvedRsvp,
}: {
  readonly resolvedRsvp: SingerEvent["resolvedRsvp"];
}) {
  return (
    <div className="schedule-rsvp__header">
      <span className="schedule-rsvp__title">Your RSVP</span>
      {resolvedRsvp !== "Pending" ? (
        <span
          className={`schedule-card__badge ${
            resolvedRsvp === "Yes"
              ? "schedule-card__badge--performance"
              : "schedule-card__badge--rehearsal"
          }`}
        >
          {resolvedRsvp === "Yes" ? "Attending" : "Declined"}
        </span>
      ) : null}
    </div>
  );
}

function ScheduleRsvpButtons({
  busy,
  event,
  onDeclineRehearsal,
  onRsvp,
}: {
  readonly busy: boolean;
  readonly event: SingerEvent;
  readonly onDeclineRehearsal: (event: SingerEvent) => void;
  readonly onRsvp: (event: SingerEvent, rsvp: "No" | "Yes") => void;
}) {
  const isSelectedYes = event.resolvedRsvp === "Yes";
  const isSelectedNo = event.resolvedRsvp === "No";

  return (
    <div className="schedule-rsvp__buttons">
      <button
        aria-busy={busy}
        className={isSelectedYes ? "button button--primary" : "button button--secondary"}
        disabled={busy || !event.rsvpSelfServiceOpen}
        onClick={() => {
          onRsvp(event, "Yes");
        }}
        type="button"
      >
        {busy && isSelectedYes ? "Updating…" : "Yes"}
      </button>
      <button
        aria-busy={busy}
        className={isSelectedNo ? "button button--danger" : "button button--secondary"}
        disabled={busy || !event.rsvpSelfServiceOpen}
        onClick={() => {
          if (event.type === "Rehearsal") {
            onDeclineRehearsal(event);
          } else {
            onRsvp(event, "No");
          }
        }}
        type="button"
      >
        {busy && isSelectedNo ? "Updating…" : "No"}
      </button>
    </div>
  );
}

function ScheduleRsvpFooter({ event }: { readonly event: SingerEvent }) {
  return (
    <>
      {event.inheritedFromParent ? (
        <small className="field-help">
          This rehearsal follows your RSVP for the linked performance.
        </small>
      ) : null}
      {!event.rsvpSelfServiceOpen ? (
        <small className="field-help">RSVP changes are closed for this event.</small>
      ) : null}
      {event.type === "Rehearsal" && event.directRsvp === "No" && event.rsvpNote ? (
        <small className="field-help schedule-rsvp__note">
          <strong>Decline note:</strong> {event.rsvpNote}
        </small>
      ) : null}
    </>
  );
}

function ScheduleRsvpField({
  busy,
  event,
  onDeclineRehearsal,
  onRsvp,
}: {
  readonly busy: boolean;
  readonly event: SingerEvent;
  readonly onDeclineRehearsal: (event: SingerEvent) => void;
  readonly onRsvp: (event: SingerEvent, rsvp: "No" | "Yes") => void;
}) {
  return (
    <div className="schedule-rsvp">
      <ScheduleRsvpHeader resolvedRsvp={event.resolvedRsvp} />
      <ScheduleRsvpButtons
        busy={busy}
        event={event}
        onDeclineRehearsal={onDeclineRehearsal}
        onRsvp={onRsvp}
      />
      <ScheduleRsvpFooter event={event} />
    </div>
  );
}

function DeclineRehearsalDialog({
  actionError,
  busy,
  declineEvent,
  declineNote,
  onChangeDeclineNote,
  onClose,
  onDecline,
}: {
  readonly actionError: string | null;
  readonly busy: boolean;
  readonly declineEvent: SingerEvent | null;
  readonly declineNote: string;
  readonly onChangeDeclineNote: (note: string) => void;
  readonly onClose: () => void;
  readonly onDecline: () => void;
}) {
  return (
    <Dialog
      description="Please add a note so the Organization knows why you cannot attend."
      onClose={onClose}
      open={declineEvent !== null}
      title="Decline rehearsal"
    >
      <form
        className="form-stack"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          onDecline();
        }}
      >
        {actionError ? (
          <p className="notice notice--error" role="alert">
            {actionError}
          </p>
        ) : null}
        {busy ? (
          <p className="notice notice--info" role="status">
            Saving your RSVP…
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="decline-rehearsal-note">Note</label>
          <textarea
            aria-describedby="decline-rehearsal-note-help"
            aria-required="true"
            id="decline-rehearsal-note"
            maxLength={2_000}
            onChange={(event) => {
              onChangeDeclineNote(event.target.value);
            }}
            required
            value={declineNote}
          />
          <small className="field-help" id="decline-rehearsal-note-help">
            Required for rehearsals. {String(declineNote.length)} of 2,000 characters.
          </small>
        </div>
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--danger"
            disabled={!declineNote.trim() || busy}
            type="submit"
          >
            {busy ? "Saving…" : "Decline rehearsal"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MySchedule({ enabled }: { readonly enabled: boolean }) {
  const { performerLabelPlural } = useOrganizationTerminology();
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declineEvent, setDeclineEvent] = useState<SingerEvent | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [state, setState] = useState<ScheduleState>({ status: "loading" });
  const [showPastEvents, setShowPastEvents] = useState(false);

  const loadSchedule = useCallback(
    async (past = showPastEvents): Promise<void> => {
      if (!enabled) return;
      try {
        const schedule = await getMySchedule(undefined, past);
        setState({ ...schedule, status: "ready" });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: error instanceof AuthApiError && error.status === 404 ? "missing" : "error",
        });
      }
    },
    [enabled, showPastEvents],
  );

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

  async function changeRsvp(
    eventId: string,
    rsvp: "No" | "Pending" | "Yes",
    rsvpNote: string,
  ): Promise<boolean> {
    setBusyEventId(eventId);
    setFeedback(null);
    try {
      await setMyEventRsvp(eventId, rsvp, rsvpNote);
      await loadSchedule(showPastEvents);
      setFeedback("Your RSVP was updated.");
      return true;
    } catch (error: unknown) {
      setFeedback(
        error instanceof AuthApiError ? error.message : "Your RSVP could not be updated.",
      );
      return false;
    } finally {
      setBusyEventId(null);
    }
  }

  async function handleDeclineRehearsal(): Promise<void> {
    if (!declineEvent || !declineNote.trim()) return;
    setActionError(null);
    const success = await changeRsvp(declineEvent.id, "No", declineNote);
    if (success) {
      setDeclineEvent(null);
      setDeclineNote("");
    } else {
      setActionError("Your RSVP could not be updated. Please try again.");
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
        <OrganizationMfaPrompt message="Verify Organization MFA to view your schedule." />
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
          <ul className="schedule-list">
            {state.events.map((event) => {
              const location = eventLocation(event);
              return (
                <li className="schedule-card" key={event.id}>
                  <div className="schedule-card__main">
                    <div className="schedule-card__header">
                      <h3 className="schedule-card__title">{event.title}</h3>
                      <span
                        className={`schedule-card__badge ${
                          event.type === "Performance"
                            ? "schedule-card__badge--performance"
                            : "schedule-card__badge--rehearsal"
                        }`}
                      >
                        {event.type}
                      </span>
                      {event.inheritedFromParent ? (
                        <span className="schedule-card__badge schedule-card__badge--inherited">
                          Inherited from Performance: {event.resolvedRsvp}
                        </span>
                      ) : null}
                    </div>

                    <div className="schedule-card__meta-grid">
                      <div className="schedule-card__meta-item">
                        <span className="schedule-card__meta-label">Date &amp; Time</span>
                        <span className="schedule-card__meta-value">
                          {displayDate(event.startsAt, state.timezone)} ({state.timezone})
                        </span>
                      </div>
                      {location ? (
                        <div className="schedule-card__meta-item">
                          <span className="schedule-card__meta-label">Location</span>
                          <span className="schedule-card__meta-value">{location}</span>
                        </div>
                      ) : null}
                      {event.callTime ? (
                        <div className="schedule-card__meta-item">
                          <span className="schedule-card__meta-label">Call Time</span>
                          <span className="schedule-card__meta-value">{event.callTime}</span>
                        </div>
                      ) : null}
                      {event.durationMinutes ? (
                        <div className="schedule-card__meta-item">
                          <span className="schedule-card__meta-label">Duration</span>
                          <span className="schedule-card__meta-value">
                            {event.durationMinutes} minutes
                          </span>
                        </div>
                      ) : null}
                      {event.details ? (
                        <div className="schedule-card__meta-item schedule-card__meta-item--full">
                          <span className="schedule-card__meta-label">Notes</span>
                          <span className="schedule-card__meta-value schedule-card__meta-value--multiline">
                            {event.details}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {event.type === "Performance" && displayRsvpDeadline(event, state.timezone) ? (
                      <p
                        className={`schedule-card__deadline ${
                          event.rsvpDeadlinePassed
                            ? "notice notice--warning"
                            : "notice notice--info"
                        }`}
                      >
                        {displayRsvpDeadline(event, state.timezone)}{" "}
                        {event.rsvpDeadlinePassed ? "Member self-service RSVP is closed." : null}{" "}
                        <a href="/admin/roster?section=settings">Roster Settings</a>
                      </p>
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
                    busy={busyEventId === event.id}
                    event={event}
                    onDeclineRehearsal={(targetEvent) => {
                      setDeclineEvent(targetEvent);
                      setDeclineNote(targetEvent.rsvpNote || "");
                      setActionError(null);
                    }}
                    onRsvp={(targetEvent, rsvp) => {
                      void changeRsvp(targetEvent.id, rsvp, "");
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      <CalendarSubscription enabled={enabled} />
      <DeclineRehearsalDialog
        actionError={actionError}
        busy={busyEventId === declineEvent?.id}
        declineEvent={declineEvent}
        declineNote={declineNote}
        onChangeDeclineNote={setDeclineNote}
        onClose={() => {
          setDeclineEvent(null);
          setActionError(null);
        }}
        onDecline={() => {
          void handleDeclineRehearsal();
        }}
      />
    </section>
  );
}
