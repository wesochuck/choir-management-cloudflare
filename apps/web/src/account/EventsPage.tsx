import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationVenue,
} from "@choir/contracts";
import { utcToZonedLocalDateTime, zonedLocalDateTimeToUtc } from "@choir/domain";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import {
  AuthApiError,
  archiveOrganizationEvent,
  createOrganizationEvent,
  deletePrivateOrganizationFile,
  getOrganizationCalendarSettings,
  listOrganizationEvents,
  listOrganizationVenues,
  updateOrganizationEvent,
  uploadPrivateOrganizationFile,
} from "../auth/api";

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
  setList: [],
  setListApproved: false,
  startsAt: new Date(0).toISOString(),
  ticketCapacity: null,
  title: "",
  type: "Rehearsal",
  venueId: null,
};

type EventsState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly events: readonly OrganizationEvent[];
      readonly status: "ready";
      readonly timezone: string;
      readonly venues: readonly OrganizationVenue[];
    };

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
    parentPerformanceId: event.parentPerformanceId,
    publicDetails: event.publicDetails,
    publicGraphicFileId: event.publicGraphicFileId,
    publishOnWebsite: event.publishOnWebsite,
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

function eventSaveLabel(busy: boolean, editingId: string | null): string {
  if (busy) return "Saving…";
  return editingId ? "Save event" : "Create event";
}

function EventList({
  events,
  filteredEvents,
  onArchive,
  onClone,
  onEdit,
  timezone,
  venues,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly filteredEvents: readonly OrganizationEvent[];
  readonly onArchive: (event: OrganizationEvent) => void;
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
            </div>
          ),
        },
        {
          header: "Date",
          id: "date",
          render: (candidate) => displayEventDate(candidate.startsAt, timezone),
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
      rows={filteredEvents.length > 0 ? filteredEvents : events.length > 0 ? [] : events}
    />
  );
}

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
                setEvent((current) => ({
                  ...current,
                  type: change.target.value === "Performance" ? "Performance" : "Rehearsal",
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
              <label htmlFor="events-page-advance-price">Advance price (cents)</label>
              <input
                id="events-page-advance-price"
                min={0}
                onChange={(change) => {
                  setEvent((current) => ({
                    ...current,
                    advancePriceCents: optionalInteger(change.target.value) ?? 0,
                  }));
                }}
                type="number"
                value={event.advancePriceCents}
              />
            </div>
            <div className="field">
              <label htmlFor="events-page-day-price">Day-of price (cents)</label>
              <input
                id="events-page-day-price"
                min={0}
                onChange={(change) => {
                  setEvent((current) => ({
                    ...current,
                    dayOfPriceCents: optionalInteger(change.target.value) ?? 0,
                  }));
                }}
                type="number"
                value={event.dayOfPriceCents}
              />
            </div>
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

export function EventsPage({ enabled }: { readonly enabled: boolean }) {
  const [archiveCandidate, setArchiveCandidate] = useState<OrganizationEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<OrganizationEventRequest>(emptyEvent);
  const [eventStart, setEventStart] = useState("");
  const [graphicFile, setGraphicFile] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<EventsState>({ status: "loading" });
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationVenues(controller.signal),
      getOrganizationCalendarSettings(controller.signal),
    ])
      .then(([events, venues, settings]) => {
        setState({ events, status: "ready", timezone: settings.timezone, venues });
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
    return normalized
      ? state.events.filter((candidate) =>
          [candidate.title, candidate.type, candidate.location]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalized),
        )
      : state.events;
  }, [query, state]);

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

  if (!enabled) {
    return <p className="notice notice--warning">Verify Organization MFA to manage events.</p>;
  }

  const readyState = state.status === "ready" ? state : null;
  return (
    <>
      <div className="page-toolbar">
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
        <button className="button button--primary" onClick={openCreate} type="button">
          Create event
        </button>
      </div>
      {error && !dialogOpen && !archiveCandidate ? (
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
    </>
  );
}
