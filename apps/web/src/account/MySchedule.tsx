import { OrganizationFeatureIcon } from "./organizationFeatures/OrganizationFeatureIcon";
import type { SingerEvent, SingerEventsResponse } from "@choir/contracts";
import { normalizeSetListDuration } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import { useCallback, useEffect, useState } from "react";

import { AuthApiError, getMySchedule, getMemberPracticeLink, setMyEventRsvp } from "../auth/api";
import { MemberEventCard } from "./MemberEventCard";
import { CalendarSubscription } from "./CalendarSubscription";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type ScheduleState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | ({ readonly status: "ready" } & SingerEventsResponse);

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

function performerCredit(
  item: SingerEvent["setList"][number],
  performerLabelPlural: string,
): string | null {
  const credits = item.performerCredits?.map(({ displayName }) => displayName) ?? [];
  if (!item.isFeaturedNumber && !item.soloSmallGroup) return null;
  if (credits.length === 0) return `Featured ${performerLabelPlural.toLowerCase()} TBA`;
  return `Featured: ${credits.join(", ")}`;
}

function OtherEventProgressLine({
  volunteerCount,
  volunteerGoal,
}: {
  readonly volunteerCount?: number | undefined;
  readonly volunteerGoal?: number | null | undefined;
}) {
  if (!volunteerGoal || volunteerGoal <= 0) return null;
  const count = volunteerCount ?? 0;
  if (count >= volunteerGoal) {
    return (
      <p className="schedule-card__staffing-progress notice notice--success" role="status">
        Minimum reached: {String(count)} {count === 1 ? "helper" : "helpers"} committed
      </p>
    );
  }
  const needed = volunteerGoal - count;
  return (
    <p className="schedule-card__staffing-progress notice notice--info" role="status">
      {String(count)} of {String(volunteerGoal)} helpers committed — {String(needed)} more needed
    </p>
  );
}

function ScheduleVolunteerRsvpButtons({
  busy,
  event,
  onRsvp,
  pendingStatus,
}: {
  readonly busy: boolean;
  readonly event: SingerEvent;
  readonly onRsvp: (event: SingerEvent, rsvp: "No" | "Yes") => void;
  readonly pendingStatus?: "No" | "Yes" | null | undefined;
}) {
  const isHelping = event.resolvedRsvp === "Yes";
  return (
    <div className="schedule-rsvp__buttons">
      {isHelping ? (
        <button
          aria-busy={busy && pendingStatus === "No"}
          className="button button--secondary"
          disabled={busy || !event.rsvpSelfServiceOpen}
          onClick={() => {
            onRsvp(event, "No");
          }}
          type="button"
        >
          {busy && pendingStatus === "No" ? "Saving…" : "Withdraw"}
        </button>
      ) : (
        <button
          aria-busy={busy && pendingStatus === "Yes"}
          className="button button--primary"
          disabled={busy || !event.rsvpSelfServiceOpen}
          onClick={() => {
            onRsvp(event, "Yes");
          }}
          type="button"
        >
          {busy && pendingStatus === "Yes" ? "Saving…" : "I can help"}
        </button>
      )}
    </div>
  );
}

function ScheduleStandardRsvpButtons({
  busy,
  event,
  onDeclineRehearsal,
  onRsvp,
  pendingStatus,
}: {
  readonly busy: boolean;
  readonly event: SingerEvent;
  readonly onDeclineRehearsal: (event: SingerEvent) => void;
  readonly onRsvp: (event: SingerEvent, rsvp: "No" | "Yes") => void;
  readonly pendingStatus?: "No" | "Yes" | null | undefined;
}) {
  const isSelectedYes = event.resolvedRsvp === "Yes";
  const isSelectedNo = event.resolvedRsvp === "No";

  return (
    <div className="schedule-rsvp__buttons">
      <button
        aria-busy={busy && pendingStatus === "Yes"}
        className={isSelectedYes ? "button button--primary" : "button button--secondary"}
        disabled={busy || !event.rsvpSelfServiceOpen}
        onClick={() => {
          onRsvp(event, "Yes");
        }}
        type="button"
      >
        {busy && pendingStatus === "Yes" ? "Saving…" : "Yes"}
      </button>
      <button
        aria-busy={busy && pendingStatus === "No"}
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
        {busy && pendingStatus === "No" ? "Saving…" : "No"}
      </button>
    </div>
  );
}

function ScheduleRsvpButtons(props: {
  readonly busy: boolean;
  readonly event: SingerEvent;
  readonly onDeclineRehearsal: (event: SingerEvent) => void;
  readonly onRsvp: (event: SingerEvent, rsvp: "No" | "Yes") => void;
  readonly pendingStatus?: "No" | "Yes" | null | undefined;
}) {
  const { event } = props;
  if (event.type === "Other") {
    if (event.otherEventRsvpMode === "off") {
      return null;
    }
    if (event.otherEventRsvpMode === "optional" || !event.isInvited) {
      return <ScheduleVolunteerRsvpButtons {...props} />;
    }
  }

  return <ScheduleStandardRsvpButtons {...props} />;
}

function ScheduleRsvpFooter({ event }: { readonly event: SingerEvent }) {
  if (event.type === "Other" && event.otherEventRsvpMode === "off") {
    return null;
  }
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
    </>
  );
}

function ScheduleEventDeadline({
  event,
  timezone,
}: {
  readonly event: SingerEvent;
  readonly timezone: string;
}) {
  if (event.type !== "Performance") {
    return null;
  }
  const deadlineText = displayRsvpDeadline(event, timezone);
  if (!deadlineText) {
    return null;
  }
  return (
    <p
      className={`schedule-card__deadline ${event.rsvpDeadlinePassed ? "notice notice--warning" : ""}`}
    >
      {deadlineText} {event.rsvpDeadlinePassed ? "Member self-service RSVP is closed." : null}{" "}
      <a href="/admin/roster?section=settings">Roster Settings</a>
    </p>
  );
}

function ScheduleEventSetList({
  event,
  performerLabelPlural,
}: {
  readonly event: SingerEvent;
  readonly performerLabelPlural: string;
}) {
  if (event.setList.length === 0) {
    return null;
  }
  const hasScores = event.setList.some((item) => Boolean(item.pieceId && item.scoreAvailable));
  return (
    <details className="schedule-set-list">
      <summary className="schedule-set-list__legend">
        View set list ({event.setList.length} items)
      </summary>
      {hasScores ? (
        <div className="schedule-set-list__actions">
          <a
            className="button button--secondary button--small"
            download
            href={`/api/singer/events/${encodeURIComponent(event.id)}/scores/bundle`}
          >
            Download score bundle (ZIP)
          </a>
        </div>
      ) : null}
      <ol>
        {event.setList.map((item, index) => {
          const credit = performerCredit(item, performerLabelPlural);
          const duration = normalizeSetListDuration(item.duration);
          return (
            <li key={item.id ?? `${item.title}-${String(index)}`}>
              <div className="schedule-set-list__item-header">
                <strong>{item.title}</strong>
                {item.composer ? ` — ${item.composer}` : ""}
                {duration ? ` (${duration})` : ""}
                {item.pieceId && item.scoreAvailable ? (
                  <a
                    className="button button--secondary button--small schedule-set-list__score-link"
                    href={`/api/singer/pieces/${encodeURIComponent(item.pieceId)}/score`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Score (PDF)
                  </a>
                ) : null}
              </div>
              {credit ? <span>{credit}</span> : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ScheduleCardBadges({
  event,
  isOtherOff,
  isVolunteerMode,
}: {
  readonly event: SingerEvent;
  readonly isOtherOff: boolean;
  readonly isVolunteerMode: boolean;
}) {
  if (isOtherOff) return null;
  if (isVolunteerMode) {
    if (event.resolvedRsvp === "Yes") {
      return (
        <span className="rsvp-status-badge schedule-card__badge rsvp-status-badge--Yes">
          Committed
        </span>
      );
    }
    return null;
  }
  return (
    <span
      className={`rsvp-status-badge schedule-card__badge rsvp-status-badge--${event.resolvedRsvp}`}
    >
      {event.resolvedRsvp === "Yes"
        ? "Attending"
        : event.resolvedRsvp === "No"
          ? "Declined"
          : "Pending"}
    </span>
  );
}

function SchedulePracticeButton({ event }: { readonly event: SingerEvent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (event.practice.status !== "available" || !event.practice.sourceEventId) return null;
  async function open() {
    const sourceId = event.practice.sourceEventId;
    if (!sourceId) return;
    setBusy(true);
    setError(false);
    try {
      const href = await getMemberPracticeLink(sourceId);
      window.location.assign(href);
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="button button--secondary member-event-card__practice"
        aria-label="Open practice player"
        aria-busy={busy}
        disabled={busy}
        onClick={() => void open()}
      >
        <OrganizationFeatureIcon iconId="headphones" className="member-event-card__action-icon" />
        {busy ? "Opening…" : "Practice"}
      </button>
      {error ? <span role="alert">The practice player could not be opened.</span> : null}
    </>
  );
}

function ScheduleEventCard({
  busy,
  event,
  navigate,
  onDeclineRehearsal,
  onRsvp,
  pendingStatus,
  performerLabelPlural,
  timezone,
}: {
  readonly busy: boolean;
  readonly event: SingerEvent;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly onDeclineRehearsal: (event: SingerEvent) => void;
  readonly onRsvp: (event: SingerEvent, rsvp: "No" | "Yes") => void;
  readonly pendingStatus?: "No" | "Yes" | null | undefined;
  readonly performerLabelPlural: string;
  readonly timezone: string;
}) {
  const isOther = event.type === "Other";
  const isOtherOff = isOther && event.otherEventRsvpMode === "off";
  const isVolunteerMode =
    isOther &&
    (event.otherEventRsvpMode === "optional" ||
      (event.otherEventRsvpMode === "response_requested" && !event.isInvited));

  return (
    <li className="schedule-card-item" key={event.id}>
      <MemberEventCard
        event={event}
        timezone={timezone}
        navigate={navigate}
        className="schedule-rsvp"
        status={
          <div className="schedule-card__legend-badges">
            {event.inheritedFromParent ? (
              <span className="schedule-card__badge schedule-card__badge--inherited">
                Inherited: {event.resolvedRsvp}
              </span>
            ) : null}
            <ScheduleCardBadges
              event={event}
              isOtherOff={isOtherOff}
              isVolunteerMode={isVolunteerMode}
            />
          </div>
        }
        footer={
          <>
            <div className="member-event-card__footer-info">
              <ScheduleEventDeadline event={event} timezone={timezone} />
              {event.type === "Rehearsal" && event.directRsvp === "No" && event.rsvpNote ? (
                <p className="schedule-rsvp__note">
                  <strong>Decline note:</strong> {event.rsvpNote}
                </p>
              ) : null}
              <ScheduleRsvpFooter event={event} />
            </div>
            <div className="member-event-card__buttons">
              <SchedulePracticeButton event={event} />
              <ScheduleRsvpButtons
                busy={busy}
                event={event}
                onDeclineRehearsal={onDeclineRehearsal}
                onRsvp={onRsvp}
                pendingStatus={pendingStatus}
              />
            </div>
          </>
        }
      >
        {isOther ? (
          <OtherEventProgressLine
            volunteerCount={event.volunteerCount}
            volunteerGoal={event.volunteerGoal}
          />
        ) : null}

        <ScheduleEventSetList event={event} performerLabelPlural={performerLabelPlural} />
      </MemberEventCard>
    </li>
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

function ScheduleStatusNotice({
  accessStatus,
  enabled,
  mfaRequired,
  scheduleState,
}: {
  readonly accessStatus: "error" | "loading" | "none" | "platform-scoped" | "ready";
  readonly enabled: boolean;
  readonly mfaRequired: boolean;
  readonly scheduleState: ScheduleState;
}) {
  if (mfaRequired) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to view your schedule." />;
  }
  if (accessStatus === "loading") {
    return <p>Loading your schedule…</p>;
  }
  if (accessStatus === "none") {
    return (
      <p className="empty-state">
        Link this Membership to an Organization Profile to manage personal RSVPs.
      </p>
    );
  }
  if (accessStatus === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Your schedule could not be loaded.
      </p>
    );
  }
  if (accessStatus === "ready" && enabled) {
    if (scheduleState.status === "loading") {
      return <p>Loading your schedule…</p>;
    }
    if (scheduleState.status === "missing") {
      return (
        <p className="empty-state">
          Link this Membership to an Organization Profile to manage personal RSVPs.
        </p>
      );
    }
    if (scheduleState.status === "error") {
      return (
        <p className="notice notice--error" role="alert">
          Your schedule could not be loaded.
        </p>
      );
    }
  }
  return null;
}

export function MySchedule({
  accessStatus = "ready",
  enabled,
  mfaRequired = false,
  navigate,
}: {
  readonly accessStatus?: "error" | "loading" | "none" | "platform-scoped" | "ready" | undefined;
  readonly enabled: boolean;
  readonly mfaRequired?: boolean | undefined;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  const { performerLabelPlural } = useOrganizationTerminology();
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [pendingRsvp, setPendingRsvp] = useState<{
    eventId: string;
    status: "No" | "Yes";
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
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
    if (rsvp === "Yes" || rsvp === "No") {
      setPendingRsvp({ eventId, status: rsvp });
    }
    setBusyEventId(eventId);
    setFeedback(null);
    try {
      await setMyEventRsvp(eventId, rsvp, rsvpNote);
      await loadSchedule(showPastEvents);
      setFeedback({ type: "success", message: "Your RSVP was updated." });
      return true;
    } catch (error: unknown) {
      setFeedback({
        type: "error",
        message: error instanceof AuthApiError ? error.message : "Your RSVP could not be updated.",
      });
      return false;
    } finally {
      setBusyEventId(null);
      setPendingRsvp(null);
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
    <section className="account-section account-section--my-schedule" aria-label="My schedule">
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
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {pendingRsvp ? "Saving your RSVP…" : ""}
      </div>
      <ScheduleStatusNotice
        accessStatus={accessStatus}
        enabled={enabled}
        mfaRequired={mfaRequired}
        scheduleState={state}
      />
      {feedback ? (
        <p
          className={
            feedback.type === "success" ? "notice notice--success" : "notice notice--error"
          }
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
      {enabled && state.status === "ready" ? (
        state.events.length === 0 ? (
          <p className="empty-state">
            {showPastEvents ? "No upcoming or recent events are available." : "No upcoming events."}
          </p>
        ) : (
          <ul className="schedule-list">
            {state.events.map((event) => (
              <ScheduleEventCard
                busy={busyEventId === event.id}
                event={event}
                key={event.id}
                navigate={navigate}
                onDeclineRehearsal={(targetEvent) => {
                  setDeclineEvent(targetEvent);
                  setDeclineNote(targetEvent.rsvpNote || "");
                  setActionError(null);
                }}
                onRsvp={(targetEvent, rsvp) => {
                  void changeRsvp(targetEvent.id, rsvp, "");
                }}
                pendingStatus={pendingRsvp?.eventId === event.id ? pendingRsvp.status : null}
                performerLabelPlural={performerLabelPlural}
                timezone={state.timezone}
              />
            ))}
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
