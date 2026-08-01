import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationVenue,
} from "@choir/contracts";
import {
  calculateRsvpDeadline,
  isRsvpDeadlinePassed,
  utcToZonedLocalDateTime,
  zonedLocalDateTimeToUtc,
} from "@choir/domain";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import {
  AuthApiError,
  archiveOrganizationEvent,
  cancelOrganizationEvent,
  createOrganizationEvent,
  deletePrivateOrganizationFile,
  getOrganizationCalendarSettings,
  getOrganizationRosterConfiguration,
  listOrganizationEvents,
  listOrganizationVenues,
  updateOrganizationEvent,
  uploadPrivateOrganizationFile,
} from "../auth/api";
import { dayOfPriceStartLabel } from "./eventPricing";

const emptyEvent: OrganizationEventRequest = {
  advancePriceCents: 0,
  callTime: "",
  dayOfPriceCents: 0,
  details: "",
  doorsOpenTime: "",
  durationMinutes: null,
  isTicketingEnabled: false,
  location: "",
  parentPerformanceId: null,
  publicDetails: "",
  publicGraphicFileId: null,
  publishOnWebsite: false,
  rsvpFollowUpLeadHours: null,
  rsvpFollowUpMode: "inherit",
  setList: [],
  setListApproved: false,
  startsAt: new Date(0).toISOString(),
  ticketCapacity: null,
  title: "",
  type: "Rehearsal",
  venueId: null,
};

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type EventsState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly events: readonly OrganizationEvent[];
      readonly rsvpFollowUpEnabled: boolean;
      readonly rsvpFollowUpLeadHours: number;
      readonly status: "ready";
      readonly rsvpExpiryEnabled: boolean;
      readonly rsvpExpiryLeadDays: number;
      readonly timezone: string;
      readonly venues: readonly OrganizationVenue[];
    };

type EventTab = "all" | "performances" | "rehearsals";

function readRsvpFollowUpMode(value: string): OrganizationEventRequest["rsvpFollowUpMode"] {
  if (value === "enabled" || value === "disabled") return value;
  return "inherit";
}

function eventRequestFrom(event: OrganizationEvent): OrganizationEventRequest {
  return {
    advancePriceCents: event.advancePriceCents,
    callTime: event.callTime,
    dayOfPriceCents: event.dayOfPriceCents,
    details: event.details,
    doorsOpenTime: event.doorsOpenTime,
    durationMinutes: event.durationMinutes,
    isTicketingEnabled: event.isTicketingEnabled,
    location: event.location,
    parentPerformanceId: event.type === "Rehearsal" ? event.parentPerformanceId : null,
    publicDetails: event.publicDetails,
    publicGraphicFileId: event.publicGraphicFileId,
    publishOnWebsite: event.publishOnWebsite,
    rsvpFollowUpLeadHours: event.rsvpFollowUpLeadHours,
    rsvpFollowUpMode: event.rsvpFollowUpMode,
    setList: event.setList,
    setListApproved: event.setListApproved,
    startsAt: event.startsAt,
    ticketCapacity: event.ticketCapacity,
    title: event.title,
    type: event.type,
    venueId: event.venueId,
  };
}

function displayEventDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function displayRsvpDeadline(event: OrganizationEvent, timezone: string): string | null {
  if (!event.rsvpDeadlineAt || !event.rsvpDeadlineDate) return null;
  return displayRsvpDeadlineAt(event.rsvpDeadlineAt, event.rsvpDeadlinePassed, timezone);
}

function displayRsvpDeadlineAt(value: string, passed: boolean, timezone: string): string {
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(new Date(value));
  return passed ? `RSVP deadline passed · ${date}` : `RSVP by ${date}`;
}

function EventRsvpDeadlineNotice({
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
            ? `${displayRsvpDeadlineAt(draftDeadline.deadlineAt, true, state.timezone)}. Pending RSVPs will close. Change the date or adjust this in Roster Settings.`
            : `${displayRsvpDeadlineAt(draftDeadline.deadlineAt, false, state.timezone)} through 11:59 p.m. Link: Roster Settings.`
          : "Choose a valid start date to calculate the RSVP deadline."
        : "RSVP Expiry is off. You can change it in Roster Settings."}
      {state.rsvpExpiryEnabled ? <a href="/admin/settings"> Open Roster Settings</a> : null}
    </p>
  );
}

function optionalInteger(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventDialogDescription(state: EventsState): string {
  return state.status === "ready"
    ? `Times are entered in ${state.timezone}.`
    : "Create or update an Organization event.";
}

function eventDialogTitle(editingId: string | null, title: string): string {
  if (editingId) return "Edit event";
  return title.endsWith(" copy") ? "Clone event" : "Create event";
}

function shouldShowPageError(
  error: string | null,
  dialogOpen: boolean,
  archiveCandidate: OrganizationEvent | null,
  cancelCandidate: OrganizationEvent | null,
): boolean {
  return error !== null && !dialogOpen && archiveCandidate === null && cancelCandidate === null;
}

function eventSaveLabel(busy: boolean, editingId: string | null): string {
  if (busy) return "Saving…";
  return editingId ? "Save event" : "Create event";
}

function rehearsalDatesBeforePerformance(
  performance: OrganizationEvent,
  count: number,
  dayOfWeek: number,
  time: string,
  timezone: string,
): readonly string[] | null {
  const localPerformanceStart = utcToZonedLocalDateTime(performance.startsAt, timezone);
  if (!localPerformanceStart) return null;
  const performanceDate = localPerformanceStart.slice(0, 10);
  const cursor = new Date(`${performanceDate}T12:00:00Z`);
  if (!Number.isFinite(cursor.getTime())) return null;
  while (cursor.getUTCDay() !== dayOfWeek) cursor.setUTCDate(cursor.getUTCDate() - 1);
  if (cursor.getTime() >= new Date(`${performanceDate}T00:00:00Z`).getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = cursor.toISOString().slice(0, 10);
    const startsAt = zonedLocalDateTimeToUtc(`${date}T${time}`, timezone);
    if (!startsAt) return null;
    dates.push(startsAt);
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return dates.reverse();
}

function EventList({
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
                href={`/admin/events/${encodeURIComponent(candidate.id)}/roster`}
              >
                Roster
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
              <button
                className="text-button"
                onClick={() => {
                  onClone(candidate);
                }}
                type="button"
              >
                Clone
              </button>
              <button
                className="text-button text-button--danger"
                disabled={candidate.isCanceled}
                onClick={() => {
                  onCancel(candidate);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="text-button text-button--danger"
                onClick={() => {
                  onArchive(candidate);
                }}
                type="button"
              >
                Archive
              </button>
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

// eslint-disable-next-line complexity -- this dialog coordinates the complete event form and its scheduled RSVP override.
function EventEditorDialog({
  busy,
  dialogOpen,
  editingId,
  error,
  event,
  eventStart,
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
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly setEventStart: (value: string) => void;
  readonly setGraphicFile: (file: File | null) => void;
  readonly state: EventsState;
}) {
  return (
    <Dialog
      description={eventDialogDescription(state)}
      onClose={onClose}
      open={dialogOpen}
      title={eventDialogTitle(editingId, event.title)}
    >
      <form
        className="form-stack"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          onSubmit();
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
              <legend>Pending RSVP follow-up</legend>
              <p className="field-help">
                One email is sent only to active Performers still marked Pending. The Organization
                default is{" "}
                {state.status === "ready"
                  ? `${String(state.rsvpFollowUpLeadHours)} hours`
                  : "configured in Roster Settings"}{" "}
                before the RSVP deadline.
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
              <p className="field-help">
                Edit the email wording in Communications → Templates → Event RSVP Follow-up.
              </p>
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
                min={0}
                onChange={(change) => {
                  setEvent((current) => ({
                    ...current,
                    advancePriceCents: Math.round(Number(change.target.value) * 100),
                  }));
                }}
                step="0.01"
                type="number"
                value={(event.advancePriceCents / 100).toFixed(2)}
              />
            </div>
            <div className="field">
              <label htmlFor="events-page-day-price">Day-of price (USD)</label>
              <input
                id="events-page-day-price"
                min={0}
                onChange={(change) => {
                  setEvent((current) => ({
                    ...current,
                    dayOfPriceCents: Math.round(Number(change.target.value) * 100),
                  }));
                }}
                step="0.01"
                type="number"
                value={(event.dayOfPriceCents / 100).toFixed(2)}
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
        <div className="dialog__actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button--primary" disabled={busy} type="submit">
            {eventSaveLabel(busy, editingId)}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ArchiveEventDialog({
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

function CancelEventDialog({
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

function BulkRehearsalDialog({
  busy,
  count,
  dayOfWeek,
  error,
  onClose,
  onSubmit,
  open,
  performanceId,
  performances,
  rehearsalTime,
  setCount,
  setDayOfWeek,
  setPerformanceId,
  setRehearsalTime,
  setVenueId,
  venueId,
  venues,
}: {
  readonly busy: boolean;
  readonly count: string;
  readonly dayOfWeek: string;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly open: boolean;
  readonly performanceId: string;
  readonly performances: readonly OrganizationEvent[];
  readonly rehearsalTime: string;
  readonly setCount: (value: string) => void;
  readonly setDayOfWeek: (value: string) => void;
  readonly setPerformanceId: (value: string) => void;
  readonly setRehearsalTime: (value: string) => void;
  readonly setVenueId: (value: string) => void;
  readonly venueId: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  return (
    <Dialog
      description="Quickly generate a series of weekly rehearsals leading up to a performance."
      onClose={onClose}
      open={open}
      title="Bulk add rehearsals"
    >
      <form
        className="form-stack bulk-rehearsal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Target performance
          <select
            required
            value={performanceId}
            onChange={(event) => {
              setPerformanceId(event.target.value);
            }}
          >
            <option value="">Select performance…</option>
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.title} · {new Date(performance.startsAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Rehearsal venue
          <select
            value={venueId}
            onChange={(event) => {
              setVenueId(event.target.value);
            }}
          >
            <option value="">No saved venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <div className="bulk-rehearsal-form__split">
          <label className="field">
            Count
            <input
              min={1}
              max={52}
              required
              type="number"
              value={count}
              onChange={(event) => {
                setCount(event.target.value);
              }}
            />
          </label>
          <label className="field">
            Time
            <input
              required
              type="time"
              value={rehearsalTime}
              onChange={(event) => {
                setRehearsalTime(event.target.value);
              }}
            />
          </label>
        </div>
        <label className="field">
          Day of week
          <select
            required
            value={dayOfWeek}
            onChange={(event) => {
              setDayOfWeek(event.target.value);
            }}
          >
            {DAYS_OF_WEEK.map((day, index) => (
              <option key={day} value={String(index)}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog__actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Generating…" : "Generate rehearsals"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function EventsPage({ enabled }: { readonly enabled: boolean }) {
  const [archiveCandidate, setArchiveCandidate] = useState<OrganizationEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkRehearsalOpen, setBulkRehearsalOpen] = useState(false);
  const [cancelCandidate, setCancelCandidate] = useState<OrganizationEvent | null>(null);
  const [bulkRehearsalCount, setBulkRehearsalCount] = useState("8");
  const [bulkRehearsalDay, setBulkRehearsalDay] = useState("2");
  const [bulkRehearsalPerformanceId, setBulkRehearsalPerformanceId] = useState("");
  const [bulkRehearsalTime, setBulkRehearsalTime] = useState("19:00");
  const [bulkRehearsalVenueId, setBulkRehearsalVenueId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<OrganizationEventRequest>(emptyEvent);
  const [eventStart, setEventStart] = useState("");
  const [graphicFile, setGraphicFile] = useState<File | null>(null);
  const [eventTab, setEventTab] = useState<EventTab>("all");
  const [currentTime] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [state, setState] = useState<EventsState>({ status: "loading" });
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationVenues(controller.signal),
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
    ])
      .then(([events, venues, settings, rosterConfiguration]) => {
        setState({
          events,
          rsvpFollowUpEnabled: rosterConfiguration.rsvpFollowUpEnabled,
          rsvpFollowUpLeadHours: rosterConfiguration.rsvpFollowUpLeadHours,
          rsvpExpiryEnabled: rosterConfiguration.rsvpExpiryEnabled,
          rsvpExpiryLeadDays: rosterConfiguration.rsvpExpiryLeadDays,
          status: "ready",
          timezone: settings.timezone,
          venues,
        });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const filteredEvents = useMemo(() => {
    if (state.status !== "ready") return [];
    const normalized = query.trim().toLocaleLowerCase();
    return state.events.filter((candidate) => {
      const matchesTab =
        eventTab === "all" ||
        (eventTab === "performances" && candidate.type === "Performance") ||
        (eventTab === "rehearsals" && candidate.type === "Rehearsal");
      const matchesPast = showPastEvents || new Date(candidate.startsAt).getTime() >= currentTime;
      const matchesQuery =
        !normalized ||
        [candidate.title, candidate.type, candidate.location]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized);
      return matchesTab && matchesPast && matchesQuery;
    });
  }, [currentTime, eventTab, query, showPastEvents, state]);

  function closeDialog() {
    if (busy) return;
    setDialogOpen(false);
    setEditingId(null);
    setEvent(emptyEvent);
    setEventStart("");
    setGraphicFile(null);
    setError(null);
  }

  function openCreate() {
    setEditingId(null);
    setEvent(emptyEvent);
    setEventStart("");
    setGraphicFile(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  function openBulkRehearsals() {
    if (state.status !== "ready") return;
    const performances = state.events.filter((candidate) => candidate.type === "Performance");
    const target = performances[0];
    setBulkRehearsalPerformanceId(target?.id ?? "");
    setBulkRehearsalVenueId(state.venues[0]?.id ?? "");
    if (target) {
      const localStart = utcToZonedLocalDateTime(target.startsAt, state.timezone);
      if (localStart) {
        const date = new Date(`${localStart.slice(0, 10)}T12:00:00Z`);
        if (Number.isFinite(date.getTime())) setBulkRehearsalDay(String(date.getUTCDay()));
      }
    }
    setBulkRehearsalCount("8");
    setBulkRehearsalTime("19:00");
    setError(null);
    setSuccess(null);
    setBulkRehearsalOpen(true);
  }

  function openEdit(candidate: OrganizationEvent) {
    if (state.status !== "ready") return;
    setEditingId(candidate.id);
    setEvent(eventRequestFrom(candidate));
    setEventStart(utcToZonedLocalDateTime(candidate.startsAt, state.timezone) ?? "");
    setGraphicFile(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  function openClone(candidate: OrganizationEvent) {
    if (state.status !== "ready") return;
    setEditingId(null);
    setEvent({
      ...eventRequestFrom(candidate),
      isTicketingEnabled: false,
      parentPerformanceId: null,
      publicGraphicFileId: null,
      publishOnWebsite: false,
      setList: [],
      setListApproved: false,
      title: `${candidate.title} copy`,
    });
    setEventStart(utcToZonedLocalDateTime(candidate.startsAt, state.timezone) ?? "");
    setGraphicFile(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  async function saveEvent() {
    if (state.status !== "ready") return;
    const startsAt = zonedLocalDateTimeToUtc(eventStart, state.timezone);
    if (!startsAt) {
      setError("Enter a valid date and time.");
      return;
    }
    setBusy(true);
    setError(null);
    let uploadedGraphicId: string | null = null;
    const previousGraphicId = event.publicGraphicFileId;
    try {
      if (graphicFile) uploadedGraphicId = (await uploadPrivateOrganizationFile(graphicFile)).id;
      const request: OrganizationEventRequest = {
        ...event,
        publicGraphicFileId: uploadedGraphicId ?? event.publicGraphicFileId,
        startsAt,
      };
      const saved = editingId
        ? await updateOrganizationEvent(editingId, request)
        : await createOrganizationEvent(request);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              events: (editingId
                ? current.events.map((candidate) => (candidate.id === saved.id ? saved : candidate))
                : [...current.events, saved]
              ).toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
            }
          : current,
      );
      if (previousGraphicId && previousGraphicId !== saved.publicGraphicFileId) {
        await deletePrivateOrganizationFile(previousGraphicId).catch(() => undefined);
      }
      setSuccess(editingId ? "Event updated." : "Event created.");
      setDialogOpen(false);
      setEditingId(null);
      setEvent(emptyEvent);
      setEventStart("");
      setGraphicFile(null);
    } catch (saveError: unknown) {
      if (uploadedGraphicId)
        await deletePrivateOrganizationFile(uploadedGraphicId).catch(() => undefined);
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : `The event could not be ${editingId ? "updated" : "created"}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function archiveEvent() {
    if (!archiveCandidate) return;
    setBusy(true);
    setError(null);
    try {
      await archiveOrganizationEvent(archiveCandidate.id);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              events: current.events.filter((candidate) => candidate.id !== archiveCandidate.id),
            }
          : current,
      );
      setArchiveCandidate(null);
      setSuccess("Event archived.");
    } catch (archiveError: unknown) {
      setError(
        archiveError instanceof AuthApiError
          ? archiveError.message
          : "The event could not be archived.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelEvent() {
    if (!cancelCandidate) return;
    setBusy(true);
    setError(null);
    try {
      await cancelOrganizationEvent(cancelCandidate.id);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              events: current.events.map((candidate) =>
                candidate.id === cancelCandidate.id ||
                candidate.parentPerformanceId === cancelCandidate.id
                  ? { ...candidate, isCanceled: true }
                  : candidate,
              ),
            }
          : current,
      );
      setCancelCandidate(null);
      setSuccess("Event canceled.");
    } catch (cancelError: unknown) {
      setError(
        cancelError instanceof AuthApiError
          ? cancelError.message
          : "The event could not be canceled.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function bulkAddRehearsals() {
    if (state.status !== "ready") return;
    const target = state.events.find(({ id }) => id === bulkRehearsalPerformanceId);
    const count = Number.parseInt(bulkRehearsalCount, 10);
    const dayOfWeek = Number.parseInt(bulkRehearsalDay, 10);
    if (target?.type !== "Performance") {
      setError("Choose a target Performance.");
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 52) {
      setError("Choose between 1 and 52 rehearsals.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(bulkRehearsalTime)) {
      setError("Enter a valid rehearsal time.");
      return;
    }
    const startsAt = rehearsalDatesBeforePerformance(
      target,
      count,
      dayOfWeek,
      bulkRehearsalTime,
      state.timezone,
    );
    if (!startsAt) {
      setError("The rehearsal dates could not be created in the Organization timezone.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created: OrganizationEvent[] = [];
      for (const start of startsAt) {
        created.push(
          await createOrganizationEvent({
            ...emptyEvent,
            parentPerformanceId: target.id,
            startsAt: start,
            title: `${target.title} rehearsal`,
            type: "Rehearsal",
            venueId: bulkRehearsalVenueId || null,
          }),
        );
      }
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              events: [...current.events, ...created].toSorted((left, right) =>
                left.startsAt.localeCompare(right.startsAt),
              ),
            }
          : current,
      );
      setBulkRehearsalOpen(false);
      setSuccess(`${String(created.length)} rehearsals created leading up to ${target.title}.`);
    } catch (bulkError: unknown) {
      setError(
        bulkError instanceof AuthApiError
          ? bulkError.message
          : "The rehearsal series could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <p className="notice notice--warning">Verify Organization MFA to manage events.</p>;
  }

  const readyState = state.status === "ready" ? state : null;
  return (
    <>
      <p className="section-description event-manager-description">
        Create and manage rehearsals, performances, and call times. Track attendance and edit
        seating charts.
      </p>
      <nav aria-label="Event sections" className="ticketing-tabs event-manager-tabs" role="tablist">
        {(
          [
            ["all", "All Events"],
            ["performances", "Performances"],
            ["rehearsals", "Rehearsals"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={eventTab === value}
            className={eventTab === value ? "is-active" : undefined}
            key={value}
            onClick={() => {
              setEventTab(value);
            }}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="page-toolbar event-manager-toolbar">
        <label className="checkbox-label event-manager-toolbar__past">
          <input
            checked={showPastEvents}
            onChange={(change) => {
              setShowPastEvents(change.target.checked);
            }}
            type="checkbox"
          />
          Show past events
        </label>
        <div className="page-toolbar__actions">
          <button
            className="button button--secondary"
            disabled={
              state.status !== "ready" ||
              !state.events.some((candidate) => candidate.type === "Performance")
            }
            onClick={openBulkRehearsals}
            type="button"
          >
            Bulk add rehearsals
          </button>
          <button className="button button--primary" onClick={openCreate} type="button">
            Single event
          </button>
        </div>
      </div>
      <div className="page-toolbar event-manager-search">
        <label className="search-field">
          <span className="sr-only">Search events</span>
          <input
            onChange={(change) => {
              setQuery(change.target.value);
            }}
            placeholder="Search events"
            type="search"
            value={query}
          />
        </label>
      </div>
      {shouldShowPageError(error, dialogOpen, archiveCandidate, cancelCandidate) ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {state.status === "loading" ? <p role="status">Loading events…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Events could not be loaded.
        </p>
      ) : null}
      {readyState ? (
        <EventList
          events={readyState.events}
          filteredEvents={filteredEvents}
          onArchive={(candidate) => {
            setError(null);
            setSuccess(null);
            setArchiveCandidate(candidate);
          }}
          onCancel={(candidate) => {
            setError(null);
            setSuccess(null);
            setCancelCandidate(candidate);
          }}
          onClone={openClone}
          onEdit={openEdit}
          timezone={readyState.timezone}
          venues={readyState.venues}
        />
      ) : null}
      <EventEditorDialog
        busy={busy}
        dialogOpen={dialogOpen}
        editingId={editingId}
        error={error}
        event={event}
        eventStart={eventStart}
        onClose={closeDialog}
        onSubmit={() => {
          void saveEvent();
        }}
        setEvent={setEvent}
        setEventStart={setEventStart}
        setGraphicFile={setGraphicFile}
        state={state}
      />
      <ArchiveEventDialog
        archiveCandidate={archiveCandidate}
        busy={busy}
        error={error}
        onArchive={() => {
          void archiveEvent();
        }}
        onClose={() => {
          if (!busy) setArchiveCandidate(null);
        }}
      />
      <CancelEventDialog
        busy={busy}
        cancelCandidate={cancelCandidate}
        error={error}
        onCancel={() => {
          void cancelEvent();
        }}
        onClose={() => {
          if (!busy) setCancelCandidate(null);
        }}
      />
      <BulkRehearsalDialog
        busy={busy}
        count={bulkRehearsalCount}
        dayOfWeek={bulkRehearsalDay}
        error={error}
        onClose={() => {
          if (!busy) setBulkRehearsalOpen(false);
        }}
        onSubmit={() => {
          void bulkAddRehearsals();
        }}
        open={bulkRehearsalOpen}
        performanceId={bulkRehearsalPerformanceId}
        performances={
          readyState?.events.filter((candidate) => candidate.type === "Performance") ?? []
        }
        rehearsalTime={bulkRehearsalTime}
        setCount={setBulkRehearsalCount}
        setDayOfWeek={setBulkRehearsalDay}
        setPerformanceId={setBulkRehearsalPerformanceId}
        setRehearsalTime={setBulkRehearsalTime}
        setVenueId={setBulkRehearsalVenueId}
        venueId={bulkRehearsalVenueId}
        venues={readyState?.venues ?? []}
      />
    </>
  );
}
