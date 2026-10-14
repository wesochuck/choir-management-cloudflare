import type { OrganizationEventRequest, OrganizationVenue } from "@choir/contracts";
import { TabsContent } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";

import { optionalInteger } from "../utils";
import type { EventsState } from "../types";
import type { SectionErrors } from "../eventSections";

function VenueTbdHelper({
  busy,
  existingTbd,
  handleEnsureTbd,
  hasVenue,
  tbdBusy,
  tbdError,
  tbdInfo,
}: {
  readonly busy: boolean;
  readonly existingTbd: OrganizationVenue | null;
  readonly handleEnsureTbd: () => Promise<void>;
  readonly hasVenue: boolean;
  readonly tbdBusy: boolean;
  readonly tbdError: string | null;
  readonly tbdInfo: { readonly isTbd: boolean };
}) {
  if (hasVenue) {
    if (tbdInfo.isTbd) {
      return (
        <p className="notice notice--info" id="venue-tbd-notice" role="status">
          <strong>Venue to be confirmed:</strong> replace TBD on this event when its location is
          known. This reminder does not block saving.
        </p>
      );
    }
    return null;
  }

  return (
    <>
      <div className="event-editor-tbd" id="venue-tbd-helper">
        <div className="event-editor-tbd__text">
          <strong>Location not yet confirmed?</strong>
          <p>
            Select an existing TBD venue, or create a shared TBD venue with no address. Later,
            change this event&apos;s venue; do not rename the shared TBD record.
          </p>
        </div>
        <button
          className="button button--secondary"
          disabled={tbdBusy || busy}
          onClick={() => {
            void handleEnsureTbd();
          }}
          type="button"
        >
          {tbdBusy ? "Working…" : "Create or select TBD"}
        </button>
      </div>
      {existingTbd ? (
        <p className="field-help">
          Prefer to pick manually? Choose “{existingTbd.name}” in the venue list.
        </p>
      ) : null}
      {tbdError ? (
        <p className="notice notice--error" role="alert">
          {tbdError}
        </p>
      ) : null}
    </>
  );
}

function ScheduleTimingFields({
  event,
  eventStart,
  performanceCandidates,
  setEvent,
  setEventStart,
  showErrorBadges,
  startError,
}: {
  readonly event: OrganizationEventRequest;
  readonly eventStart: string;
  readonly performanceCandidates: readonly { readonly id: string; readonly title: string }[];
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly setEventStart: (value: string) => void;
  readonly showErrorBadges: boolean;
  readonly startError: string | undefined;
}) {
  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor="events-page-start">Start date &amp; time *</label>
        <input
          aria-describedby={startError && showErrorBadges ? "events-page-start-error" : undefined}
          aria-invalid={Boolean(startError && showErrorBadges)}
          id="events-page-start"
          onChange={(change) => {
            setEventStart(change.target.value);
          }}
          required
          type="datetime-local"
          value={eventStart}
        />
        {startError && showErrorBadges ? (
          <p className="notice notice--error" id="events-page-start-error" role="alert">
            {startError}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="events-page-call">Call time</label>
        <input
          id="events-page-call"
          onChange={(change) => {
            setEvent((current) => ({ ...current, callTime: change.target.value }));
          }}
          type="time"
          value={event.callTime}
        />
      </div>
      <div className="field">
        <label htmlFor="events-page-duration">Duration (minutes)</label>
        <input
          id="events-page-duration"
          min={1}
          onChange={(change) => {
            setEvent((current) => ({
              ...current,
              durationMinutes: optionalInteger(change.target.value),
            }));
          }}
          type="number"
          value={event.durationMinutes ?? ""}
        />
      </div>
      {event.type === "Rehearsal" ? (
        <div className="field">
          <label htmlFor="events-page-parent">Parent performance</label>
          <select
            id="events-page-parent"
            onChange={(change) => {
              setEvent((current) => ({
                ...current,
                parentPerformanceId: change.target.value || null,
              }));
            }}
            value={event.parentPerformanceId ?? ""}
          >
            <option value="">None</option>
            {performanceCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

export function ScheduleSection({
  busy,
  event,
  eventStart,
  existingTbd,
  handleEnsureTbd,
  sectionErrors,
  setEvent,
  setEventStart,
  setTbdError,
  showErrorBadges,
  state,
  tbdBusy,
  tbdError,
  tbdInfo,
  timezoneLabel,
}: {
  readonly busy: boolean;
  readonly event: OrganizationEventRequest;
  readonly eventStart: string;
  readonly existingTbd: OrganizationVenue | null;
  readonly handleEnsureTbd: () => Promise<void>;
  readonly sectionErrors: SectionErrors;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly setEventStart: (value: string) => void;
  readonly setTbdError: (error: string | null) => void;
  readonly showErrorBadges: boolean;
  readonly state: EventsState;
  readonly tbdBusy: boolean;
  readonly tbdError: string | null;
  readonly tbdInfo: { readonly isTbd: boolean };
  readonly timezoneLabel: string | null;
}) {
  const performanceCandidates =
    event.type === "Rehearsal" && state.status === "ready"
      ? state.events.filter((candidate) => candidate.type === "Performance")
      : [];

  const startError = sectionErrors.schedule.find((err) =>
    err.toLowerCase().includes("start date and time"),
  );
  const venueError = sectionErrors.schedule.find(
    (err) => err.toLowerCase().includes("venue") || err.toLowerCase().includes("location"),
  );
  const otherError = sectionErrors.schedule.find((err) => err !== startError && err !== venueError);

  return (
    <TabsContent
      aria-labelledby="event-editor-schedule-tab"
      className="event-editor-panel"
      id="event-editor-schedule-panel"
      value="schedule"
    >
      <div className="event-editor-panel__header">
        <div className="event-editor-panel__title-row">
          <h3 className="event-editor-panel__title">Schedule &amp; venue</h3>
          <span className="event-editor__badge event-editor__badge--required">
            Required section
          </span>
        </div>
        <p className="event-editor-panel__description">
          Configure the event&apos;s timing and location.
          {timezoneLabel ? ` Times use ${timezoneLabel}.` : ""}
        </p>
      </div>
      <ScheduleTimingFields
        event={event}
        eventStart={eventStart}
        performanceCandidates={performanceCandidates}
        setEvent={setEvent}
        setEventStart={setEventStart}
        showErrorBadges={showErrorBadges}
        startError={startError}
      />
      <div className="field">
        <label htmlFor="events-page-venue">Venue *</label>
        <select
          aria-describedby={
            venueError && showErrorBadges
              ? "events-page-venue-error"
              : !event.venueId
                ? "venue-tbd-helper"
                : tbdInfo.isTbd
                  ? "venue-tbd-notice"
                  : undefined
          }
          aria-invalid={Boolean(venueError && showErrorBadges)}
          id="events-page-venue"
          onChange={(change) => {
            setEvent((current) => ({
              ...current,
              venueId: change.target.value || null,
            }));
            setTbdError(null);
          }}
          required
          value={event.venueId ?? ""}
        >
          <option disabled value="">
            Select a venue…
          </option>
          {state.status === "ready"
            ? state.venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))
            : null}
        </select>
        {venueError && showErrorBadges ? (
          <p className="notice notice--error" id="events-page-venue-error" role="alert">
            {venueError}
          </p>
        ) : null}
      </div>
      <VenueTbdHelper
        busy={busy}
        existingTbd={existingTbd}
        handleEnsureTbd={handleEnsureTbd}
        hasVenue={Boolean(event.venueId)}
        tbdBusy={tbdBusy}
        tbdError={tbdError}
        tbdInfo={tbdInfo}
      />
      {otherError && showErrorBadges ? (
        <p className="notice notice--error" role="alert">
          {otherError}
        </p>
      ) : null}
    </TabsContent>
  );
}
