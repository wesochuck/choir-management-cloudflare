import type { OrganizationEvent, OrganizationEventRequest } from "@choir/contracts";
import { utcToZonedLocalDateTime, zonedLocalDateTimeToUtc } from "@choir/domain";
import { useEffect, useMemo, useState } from "react";
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
} from "../../../auth/api";
import { OrganizationMfaPrompt } from "../../OrganizationMfaPrompt";

import {
  emptyEvent,
  eventRequestFrom,
  shouldShowPageError,
  rehearsalDatesBeforePerformance,
} from "./utils";

import { EventList } from "./shared";

import type { EventsState, EventTab } from "./types";

import { EventEditorDialog, ArchiveEventDialog, CancelEventDialog } from "./dialogs";

import { BulkRehearsalDialog } from "./bulkRehearsals";

export function EventsPage({ enabled }: { readonly enabled: boolean }) {
  const [archiveCandidate, setArchiveCandidate] = useState<OrganizationEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkRehearsalOpen, setBulkRehearsalOpen] = useState(false);
  const [cancelCandidate, setCancelCandidate] = useState<OrganizationEvent | null>(null);
  const [bulkRehearsalCount, setBulkRehearsalCount] = useState("8");
  const [bulkRehearsalDay, setBulkRehearsalDay] = useState("");
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
    setBulkRehearsalDay("");
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

  async function saveEvent(eventDraft: OrganizationEventRequest = event) {
    if (state.status !== "ready") return;
    const startsAt = zonedLocalDateTimeToUtc(eventStart, state.timezone);
    if (!startsAt) {
      setError("Enter a valid date and time.");
      return;
    }
    setBusy(true);
    setError(null);
    let uploadedGraphicId: string | null = null;
    const previousGraphicId = eventDraft.publicGraphicFileId;
    try {
      if (graphicFile) uploadedGraphicId = (await uploadPrivateOrganizationFile(graphicFile)).id;
      const request: OrganizationEventRequest = {
        ...eventDraft,
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
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      setError("Choose a day of the week.");
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
      const created = await Promise.all(
        startsAt.map((start) =>
          createOrganizationEvent({
            ...emptyEvent,
            parentPerformanceId: target.id,
            startsAt: start,
            title: `${target.title} rehearsal`,
            type: "Rehearsal",
            venueId: bulkRehearsalVenueId || null,
          }),
        ),
      );
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
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage events." />;
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
            aria-controls={`events-${value}-panel`}
            aria-selected={eventTab === value}
            className={eventTab === value ? "is-active" : undefined}
            id={`events-${value}-tab`}
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
      <div
        aria-labelledby={`events-${eventTab}-tab`}
        id={`events-${eventTab}-panel`}
        role="tabpanel"
      >
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
      </div>
      <EventEditorDialog
        busy={busy}
        dialogOpen={dialogOpen}
        editingId={editingId}
        error={error}
        event={event}
        eventStart={eventStart}
        graphicFile={graphicFile}
        key={`${dialogOpen ? "open" : "closed"}:${editingId ?? "new"}`}
        onClose={closeDialog}
        onSubmit={(eventDraft) => {
          void saveEvent(eventDraft);
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
