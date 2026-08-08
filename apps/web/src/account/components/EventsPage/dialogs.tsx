import type { OrganizationEvent, OrganizationEventRequest } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { type Dispatch, type SetStateAction, useState } from "react";
import { dayOfPriceStartLabel } from "../../eventPricing";

import {
  readRsvpFollowUpMode,
  optionalInteger,
  eventDialogDescription,
  eventDialogTitle,
  eventSaveLabel,
  currencyCentsFromDraft,
  currencyDraftFromCents,
} from "./utils";

import { EventRsvpDeadlineNotice } from "./shared";

import type { EventsState } from "./types";

// eslint-disable-next-line complexity -- the editor keeps the event form's cross-field controls together.
export function EventEditorDialog({
  busy,
  dialogOpen,
  editingId,
  error,
  event,
  eventStart,
  graphicFile,
  onClose,
  onSubmit,
  setEvent,
  setEventStart,
  setGraphicFile,
  state,
}: {
  readonly busy: boolean;
  readonly dialogOpen: boolean;
  readonly editingId: string | null;
  readonly error: string | null;
  readonly event: OrganizationEventRequest;
  readonly eventStart: string;
  readonly graphicFile: File | null;
  readonly onClose: () => void;
  readonly onSubmit: (event: OrganizationEventRequest) => void;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly setEventStart: (value: string) => void;
  readonly setGraphicFile: (file: File | null) => void;
  readonly state: EventsState;
}) {
  const [advancePriceDraft, setAdvancePriceDraft] = useState(
    currencyDraftFromCents(event.advancePriceCents),
  );
  const [dayOfPriceDraft, setDayOfPriceDraft] = useState(
    currencyDraftFromCents(event.dayOfPriceCents),
  );
  const [initialDraft] = useState(() => ({
    advancePriceDraft: currencyDraftFromCents(event.advancePriceCents),
    dayOfPriceDraft: currencyDraftFromCents(event.dayOfPriceCents),
    event,
    eventStart,
  }));
  const dirty =
    JSON.stringify(event) !== JSON.stringify(initialDraft.event) ||
    eventStart !== initialDraft.eventStart ||
    advancePriceDraft !== initialDraft.advancePriceDraft ||
    dayOfPriceDraft !== initialDraft.dayOfPriceDraft ||
    graphicFile !== null;
  const followUpEnabled =
    event.rsvpFollowUpMode === "enabled" ||
    (event.rsvpFollowUpMode === "inherit" && state.status === "ready" && state.rsvpFollowUpEnabled);
  const followUpLeadHours =
    event.rsvpFollowUpMode === "enabled"
      ? (event.rsvpFollowUpLeadHours ?? 48)
      : state.status === "ready"
        ? state.rsvpFollowUpLeadHours
        : null;

  return (
    <Dialog
      description={eventDialogDescription(state)}
      dirty={dirty}
      onClose={onClose}
      open={dialogOpen}
      title={eventDialogTitle(editingId, event.title)}
    >
      <form
        className="form-stack"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          const normalizedEvent = {
            ...event,
            advancePriceCents: currencyCentsFromDraft(advancePriceDraft),
            dayOfPriceCents: currencyCentsFromDraft(dayOfPriceDraft),
          };
          setEvent(normalizedEvent);
          onSubmit(normalizedEvent);
        }}
      >
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-grid">
          <div className="field form-grid__wide">
            <label htmlFor="events-page-title">Title</label>
            <input
              autoFocus
              id="events-page-title"
              maxLength={500}
              onChange={(change) => {
                setEvent((current) => ({ ...current, title: change.target.value }));
              }}
              required
              value={event.title}
            />
          </div>
          <div className="field">
            <label htmlFor="events-page-type">Type</label>
            <select
              id="events-page-type"
              onChange={(change) => {
                const type: OrganizationEventRequest["type"] =
                  change.target.value === "Performance" ? "Performance" : "Rehearsal";
                setEvent((current) => ({
                  ...current,
                  parentPerformanceId: type === "Rehearsal" ? current.parentPerformanceId : null,
                  type,
                }));
              }}
              value={event.type}
            >
              <option value="Rehearsal">Rehearsal</option>
              <option value="Performance">Performance</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="events-page-start">Start</label>
            <input
              id="events-page-start"
              onChange={(change) => {
                setEventStart(change.target.value);
              }}
              required
              type="datetime-local"
              value={eventStart}
            />
          </div>
          <EventRsvpDeadlineNotice eventStart={eventStart} eventType={event.type} state={state} />
          {event.type === "Performance" ? (
            <fieldset className="form-grid__wide">
              <legend>Automated pending RSVP email</legend>
              <p className="field-help">
                This email is not launched by saving the event. When enabled, the background
                scheduler automatically queues one message{" "}
                {followUpLeadHours
                  ? `${String(followUpLeadHours)} hours`
                  : "at the configured lead time"}{" "}
                before the RSVP deadline, only for active Performers still marked Pending. No
                separate draft or send button is required.
              </p>
              <label className="field" htmlFor="events-page-rsvp-follow-up-mode">
                Event setting
                <select
                  id="events-page-rsvp-follow-up-mode"
                  onChange={(change) => {
                    const mode = readRsvpFollowUpMode(change.target.value);
                    setEvent((current) => ({
                      ...current,
                      rsvpFollowUpLeadHours:
                        mode === "enabled" ? (current.rsvpFollowUpLeadHours ?? 48) : null,
                      rsvpFollowUpMode: mode,
                    }));
                  }}
                  value={event.rsvpFollowUpMode}
                >
                  <option value="inherit">
                    Use Organization default (
                    {state.status === "ready" && state.rsvpFollowUpEnabled ? "enabled" : "disabled"}
                    )
                  </option>
                  <option value="enabled">Enable for this Performance</option>
                  <option value="disabled">Disable for this Performance</option>
                </select>
              </label>
              {event.rsvpFollowUpMode === "enabled" ? (
                <label className="field" htmlFor="events-page-rsvp-follow-up-hours">
                  Hours before deadline
                  <input
                    id="events-page-rsvp-follow-up-hours"
                    min={1}
                    max={720}
                    onChange={(change) => {
                      setEvent((current) => ({
                        ...current,
                        rsvpFollowUpLeadHours: Math.max(
                          1,
                          Math.min(720, Number(change.target.value) || 1),
                        ),
                      }));
                    }}
                    type="number"
                    value={event.rsvpFollowUpLeadHours ?? 48}
                  />
                </label>
              ) : null}
              <p className={followUpEnabled ? "notice notice--info" : "notice notice--warning"}>
                <strong>
                  {followUpEnabled ? "Automatic delivery:" : "Automatic delivery is off:"}
                </strong>{" "}
                {followUpEnabled
                  ? "After the next scheduler pass, this send will appear in Communications → Upcoming sends."
                  : "Enable this Performance or the Organization default to schedule the follow-up."}
              </p>
              <div className="button-row">
                <a
                  className="button button--secondary button--small"
                  href="/admin/communications?tab=templates"
                >
                  Edit RSVP email template
                </a>
                {followUpEnabled ? (
                  <a
                    className="button button--secondary button--small"
                    href="/admin/communications?tab=upcoming"
                  >
                    View upcoming sends
                  </a>
                ) : null}
              </div>
            </fieldset>
          ) : null}
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
          <div className="field">
            <label htmlFor="events-page-venue">Saved venue</label>
            <select
              id="events-page-venue"
              onChange={(change) => {
                setEvent((current) => ({ ...current, venueId: change.target.value || null }));
              }}
              value={event.venueId ?? ""}
            >
              <option value="">No saved venue</option>
              {state.status === "ready"
                ? state.venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))
                : null}
            </select>
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
                {state.status === "ready"
                  ? state.events
                      .filter((candidate) => candidate.type === "Performance")
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title}
                        </option>
                      ))
                  : null}
              </select>
            </div>
          ) : null}
          <div className="field form-grid__wide">
            <label htmlFor="events-page-details">Internal details</label>
            <textarea
              id="events-page-details"
              maxLength={100000}
              onChange={(change) => {
                setEvent((current) => ({ ...current, details: change.target.value }));
              }}
              rows={3}
              value={event.details}
            />
          </div>
          <div className="field form-grid__wide">
            <label htmlFor="events-page-public-details">Public details</label>
            <textarea
              id="events-page-public-details"
              maxLength={100000}
              onChange={(change) => {
                setEvent((current) => ({ ...current, publicDetails: change.target.value }));
              }}
              rows={3}
              value={event.publicDetails}
            />
          </div>
          <div className="field form-grid__wide">
            <label htmlFor="events-page-graphic">Public graphic</label>
            <input
              accept="image/*"
              id="events-page-graphic"
              onChange={(change) => {
                setGraphicFile(change.target.files?.[0] ?? null);
              }}
              type="file"
            />
          </div>
        </div>
        <label className="checkbox-row">
          <input
            checked={event.publishOnWebsite}
            onChange={(change) => {
              setEvent((current) => ({ ...current, publishOnWebsite: change.target.checked }));
            }}
            type="checkbox"
          />
          Publish on public website
        </label>
        {event.type === "Performance" ? (
          <label className="checkbox-row">
            <input
              checked={event.isTicketingEnabled}
              onChange={(change) => {
                setEvent((current) => ({ ...current, isTicketingEnabled: change.target.checked }));
              }}
              type="checkbox"
            />
            Enable ticket sales
          </label>
        ) : null}
        {event.type === "Performance" && event.isTicketingEnabled ? (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="events-page-capacity">Ticket capacity</label>
              <input
                id="events-page-capacity"
                min={1}
                onChange={(change) => {
                  setEvent((current) => ({
                    ...current,
                    ticketCapacity: optionalInteger(change.target.value),
                  }));
                }}
                type="number"
                value={event.ticketCapacity ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="events-page-advance-price">Advance price (USD)</label>
              <input
                id="events-page-advance-price"
                inputMode="decimal"
                onChange={(change) => {
                  setAdvancePriceDraft(change.target.value);
                }}
                onBlur={() => {
                  const cents = currencyCentsFromDraft(advancePriceDraft);
                  setAdvancePriceDraft(currencyDraftFromCents(cents));
                  setEvent((current) => ({ ...current, advancePriceCents: cents }));
                }}
                step="0.01"
                type="text"
                value={advancePriceDraft}
              />
            </div>
            <div className="field">
              <label htmlFor="events-page-day-price">Day-of price (USD)</label>
              <input
                id="events-page-day-price"
                inputMode="decimal"
                onChange={(change) => {
                  setDayOfPriceDraft(change.target.value);
                }}
                onBlur={() => {
                  const cents = currencyCentsFromDraft(dayOfPriceDraft);
                  setDayOfPriceDraft(currencyDraftFromCents(cents));
                  setEvent((current) => ({ ...current, dayOfPriceCents: cents }));
                }}
                step="0.01"
                type="text"
                value={dayOfPriceDraft}
              />
            </div>
            {state.status === "ready" ? (
              <p className="ticketing-price-note" role="status">
                {dayOfPriceStartLabel(eventStart, state.timezone) ??
                  "Choose an event start to confirm when day-of pricing begins."}
              </p>
            ) : null}
          </div>
        ) : null}
        {dirty ? (
          <div className="event-editor-save-bar" role="region" aria-label="Unsaved event changes">
            <span className="event-editor-save-bar__message">Unsaved changes</span>
            <div className="dialog__actions">
              <button className="button button--secondary" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="button button--primary" disabled={busy} type="submit">
                {eventSaveLabel(busy, editingId)}
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

export function ArchiveEventDialog({
  archiveCandidate,
  busy,
  error,
  onArchive,
  onClose,
}: {
  readonly archiveCandidate: OrganizationEvent | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onArchive: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      description="Archived events are removed from active management views."
      onClose={onClose}
      open={archiveCandidate !== null}
      title="Archive event?"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <p>{archiveCandidate ? `Archive ${archiveCandidate.title}?` : "Archive this event?"}</p>
      <div className="dialog__actions">
        <button className="button button--secondary" onClick={onClose} type="button">
          Cancel
        </button>
        <button className="button button--danger" disabled={busy} onClick={onArchive} type="button">
          {busy ? "Archiving…" : "Archive event"}
        </button>
      </div>
    </Dialog>
  );
}

export function CancelEventDialog({
  busy,
  cancelCandidate,
  error,
  onCancel,
  onClose,
}: {
  readonly busy: boolean;
  readonly cancelCandidate: OrganizationEvent | null;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      description="Canceled events stay visible for history but no longer accept RSVPs or drive roster automation."
      onClose={onClose}
      open={cancelCandidate !== null}
      title="Cancel event?"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        {cancelCandidate
          ? `Cancel ${cancelCandidate.title}? Linked rehearsals will also be canceled.`
          : "Cancel this event?"}
      </p>
      <div className="dialog__actions">
        <button className="button button--secondary" onClick={onClose} type="button">
          Keep event
        </button>
        <button className="button button--danger" disabled={busy} onClick={onCancel} type="button">
          {busy ? "Canceling…" : "Cancel event"}
        </button>
      </div>
    </Dialog>
  );
}
