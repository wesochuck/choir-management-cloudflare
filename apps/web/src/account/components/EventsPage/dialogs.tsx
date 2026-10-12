import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationVenue,
} from "@choir/contracts";
import {
  NumberInput,
  Dialog,
  DialogClose,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@choir/ui";
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { zonedLocalDateTimeToUtc } from "@choir/domain";
import { dayOfPriceStartLabel } from "../../eventPricing";
import { QRCodeShareCard } from "../../QRCodeShareCard";
import { createOrganizationVenue, listOrganizationVenues } from "../../../auth/api";

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
import {
  computeSectionErrors,
  countSectionErrors,
  firstInvalidFieldId,
  firstInvalidSection,
  getTbdVenueForEvent,
  isSectionRequired,
  totalErrorCount,
  visibleEditorSections,
  EVENT_EDITOR_SECTION_META,
  type EventEditorSection,
} from "./eventSections";
import { ensureTbdVenue, findTbdVenue } from "./tbdVenue";

function sectionBadgeLabel(errorCount: number, required: boolean): string {
  if (errorCount > 0) return `${String(errorCount)} to fix`;
  if (required) return "Required";
  return "Optional";
}

function isEventEditorSection(value: string): value is EventEditorSection {
  return (
    value === "basics" ||
    value === "schedule" ||
    value === "rsvp" ||
    value === "tickets" ||
    value === "public"
  );
}

// eslint-disable-next-line complexity -- the editor keeps the event form's cross-field controls together.
export function EventEditorDialog({
  busy,
  dialogOpen,
  editingId,
  error,
  event,
  eventStart,
  graphicFile,
  initialSection = null,
  onClose,
  onSubmit,
  onVenueCreated,
  returnTo = null,
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
  readonly initialSection?: string | null | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (event: OrganizationEventRequest) => void;
  readonly onVenueCreated?: ((venue: OrganizationVenue) => void) | undefined;
  readonly returnTo?: string | null | undefined;
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
  const [graphicDragging, setGraphicDragging] = useState(false);
  const [graphicError, setGraphicError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [activeSection, setActiveSection] = useState<EventEditorSection>(() => {
    if (initialSection === "tickets" && event.type === "Performance") return "tickets";
    return "basics";
  });
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [tbdBusy, setTbdBusy] = useState(false);
  const [tbdError, setTbdError] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

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

  const [nowMs] = useState(() => Date.now());
  const startsAtUtc =
    state.status === "ready" && eventStart
      ? zonedLocalDateTimeToUtc(eventStart, state.timezone)
      : null;
  const isPastEvent = Boolean(startsAtUtc && new Date(startsAtUtc).getTime() <= nowMs);

  const visibleSections = useMemo(() => visibleEditorSections(event.type), [event.type]);

  const sectionErrors = useMemo(
    () => computeSectionErrors({ event, eventStart, graphicError, state }),
    [event, eventStart, graphicError, state],
  );
  const sectionCounts = useMemo(() => countSectionErrors(sectionErrors), [sectionErrors]);
  const totalErrors = useMemo(() => totalErrorCount(sectionErrors), [sectionErrors]);

  const venues = useMemo(() => (state.status === "ready" ? state.venues : []), [state]);
  const tbdInfo = useMemo(
    () => getTbdVenueForEvent(event.venueId, venues),
    [event.venueId, venues],
  );
  const existingTbd = useMemo(() => findTbdVenue(venues), [venues]);

  // Ticketing deep-link: the initial section state already selects Ticket Sales;
  // this effect only moves focus to the first ticketing control.
  useEffect(() => {
    if (!dialogOpen || initialSection !== "tickets") return;
    if (event.type !== "Performance") return;
    if (activeSection !== "tickets") return;
    const focusTimer = window.setTimeout(() => {
      const targetElement =
        document.getElementById("events-page-capacity") ??
        document.getElementById("events-page-enable-ticketing");
      if (targetElement instanceof HTMLElement && typeof targetElement.focus === "function") {
        targetElement.focus({ preventScroll: true });
      }
    }, 60);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [activeSection, dialogOpen, event.type, initialSection]);

  function focusInvalidControl(section: EventEditorSection): void {
    const fieldId = firstInvalidFieldId(section, event);
    const target = document.getElementById(fieldId);
    if (target instanceof HTMLElement && typeof target.focus === "function") {
      const prefersReducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.focus({ preventScroll: true });
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
    } else if (errorSummaryRef.current) {
      errorSummaryRef.current.focus();
    }
    const announcement = document.getElementById("event-editor-error-summary");
    if (announcement) {
      announcement.scrollIntoView({ block: "nearest" });
    }
  }

  function handleValidatedSubmit(): void {
    const normalizedEvent = {
      ...event,
      advancePriceCents: currencyCentsFromDraft(advancePriceDraft),
      dayOfPriceCents: currencyCentsFromDraft(dayOfPriceDraft),
    };
    setEvent(normalizedEvent);
    const errors = computeSectionErrors({
      event: normalizedEvent,
      eventStart,
      graphicError,
      state,
    });
    const visible = visibleEditorSections(normalizedEvent.type);
    const firstInvalid = firstInvalidSection(errors, visible);
    if (firstInvalid) {
      setAttemptedSave(true);
      setActiveSection(firstInvalid);
      window.setTimeout(() => {
        focusInvalidControl(firstInvalid);
      }, 30);
      return;
    }
    setAttemptedSave(false);
    onSubmit(normalizedEvent);
  }

  async function handleEnsureTbd(): Promise<void> {
    if (tbdBusy || busy) return;
    setTbdBusy(true);
    setTbdError(null);
    try {
      const venue = await ensureTbdVenue({
        createVenue: (name, address) => createOrganizationVenue(name, address),
        listVenues: () => listOrganizationVenues(),
        venues,
      });
      setEvent((current) => ({ ...current, venueId: venue.id }));
      if (onVenueCreated) onVenueCreated(venue);
    } catch {
      setTbdError(
        "The shared TBD venue could not be created. Check your connection and try again.",
      );
    } finally {
      setTbdBusy(false);
    }
  }

  const allowedGraphicTypes = ["image/jpeg", "image/png", "image/webp"];
  const maxGraphicBytes = 5 * 1024 * 1024;

  function handleGraphicFile(nextFile: File | null): void {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (!nextFile) {
      setPreviewUrl(null);
      setGraphicFile(null);
      return;
    }
    if (!allowedGraphicTypes.includes(nextFile.type)) {
      setPreviewUrl(null);
      setGraphicError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (nextFile.size > maxGraphicBytes) {
      setPreviewUrl(null);
      setGraphicError("Graphic file size must not exceed 5MB.");
      return;
    }
    const nextPreview = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setGraphicError(null);
    setGraphicFile(nextFile);
  }

  function handleRemoveGraphicFile(): void {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setGraphicError(null);
    setGraphicFile(null);
  }

  function handleGraphicDrop(dropEvent: DragEvent<HTMLLabelElement>): void {
    dropEvent.preventDefault();
    setGraphicDragging(false);
    handleGraphicFile(dropEvent.dataTransfer.files[0] ?? null);
  }

  const activeGraphicPreviewUrl =
    previewUrl ??
    (event.publicGraphicFileId
      ? `/api/organization/files/${encodeURIComponent(event.publicGraphicFileId)}`
      : null);

  function handleTypeChange(nextType: OrganizationEventRequest["type"]): void {
    setEvent((current) => {
      if (nextType === "Rehearsal") {
        return {
          ...current,
          isTicketingEnabled: false,
          rsvpDeadlineDate: null,
          rsvpFollowUpLeadHours: null,
          rsvpFollowUpMode: "inherit" as const,
          type: nextType,
        };
      }
      return {
        ...current,
        parentPerformanceId: null,
        type: nextType,
      };
    });
    if (nextType === "Rehearsal" && (activeSection === "rsvp" || activeSection === "tickets")) {
      setActiveSection("schedule");
    }
  }

  const showErrorBadges = attemptedSave || dirty;
  const footerStatus = busy
    ? "Saving…"
    : totalErrors > 0 && showErrorBadges
      ? `${String(totalErrors)} required field${totalErrors === 1 ? "" : "s"} need${totalErrors === 1 ? "s" : ""} attention`
      : dirty
        ? "Unsaved changes"
        : "No unsaved changes";

  const saveDisabled = busy || (!dirty && editingId !== null);
  const showBackToTicketing =
    !dirty &&
    returnTo &&
    (returnTo.startsWith("/admin/tickets") || returnTo.startsWith("/admin/ticketing"));

  const timezoneLabel = state.status === "ready" ? state.timezone : null;

  return (
    <Dialog
      className="dialog--event-editor"
      description={eventDialogDescription(state)}
      dirty={dirty}
      onClose={onClose}
      open={dialogOpen}
      title={eventDialogTitle(editingId, event.title)}
    >
      <Tabs
        className="event-editor-tabs-root"
        onValueChange={(value) => {
          if (isEventEditorSection(value)) setActiveSection(value);
        }}
        orientation="vertical"
        value={activeSection}
      >
        <div className="event-editor-layout">
          <div className="event-editor-header">
            <div className="event-editor-header__identity">
              <div className="event-editor-header__details">
                <h2 className="event-editor-header__title">
                  {event.title.trim() ? event.title : editingId ? "Edit event" : "Create event"} ·{" "}
                  {event.type}
                </h2>
                <p className="event-editor-header__subtext">
                  {eventStart ? eventStart.replace("T", " · ") : "No start time yet"}
                  {timezoneLabel ? ` · ${timezoneLabel}` : ""}
                </p>
              </div>
            </div>
            <div className="event-editor-header__status">
              {dirty ? (
                <span className="status-pill status-pill--warning">Unsaved changes</span>
              ) : (
                <span className="status-pill status-pill--neutral">No unsaved changes</span>
              )}
            </div>
          </div>

          <div className="event-editor-body">
            <div className="event-editor__mobile-nav">
              <label
                className="event-editor__mobile-nav-label"
                htmlFor="event-editor-section-select"
              >
                Event section
              </label>
              <select
                aria-label="Event section"
                className="event-editor__mobile-nav-select"
                id="event-editor-section-select"
                onChange={(change) => {
                  if (isEventEditorSection(change.target.value)) {
                    setActiveSection(change.target.value);
                  }
                }}
                value={activeSection}
              >
                {visibleSections.map((section) => (
                  <option key={section} value={section}>
                    {EVENT_EDITOR_SECTION_META[section].shortLabel}
                    {sectionCounts[section] > 0 && showErrorBadges
                      ? ` · ${String(sectionCounts[section])} to fix`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <aside aria-label="Event section navigation" className="event-editor__rail">
              <div className="event-editor__rail-header">Event sections</div>
              <TabsList aria-label="Event sections" className="event-editor__rail-tablist">
                {visibleSections.map((section, index) => {
                  const meta = EVENT_EDITOR_SECTION_META[section];
                  const required = isSectionRequired(section, event.type);
                  const count = sectionCounts[section];
                  const badge = sectionBadgeLabel(showErrorBadges ? count : 0, required);
                  const isActive = activeSection === section;
                  return (
                    <TabsTrigger
                      aria-controls={`event-editor-${section}-panel`}
                      className={`event-editor__rail-trigger ${isActive ? "is-active" : ""} ${
                        count > 0 && showErrorBadges ? "has-errors" : ""
                      }`}
                      id={`event-editor-${section}-tab`}
                      key={section}
                      value={section}
                    >
                      <span aria-hidden="true" className="event-editor__rail-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="event-editor__rail-text">
                        <span className="event-editor__rail-label">{meta.label}</span>
                        <span className="event-editor__rail-desc">{meta.description}</span>
                      </span>
                      <span
                        className={`event-editor__badge ${
                          count > 0 && showErrorBadges
                            ? "event-editor__badge--error"
                            : required
                              ? "event-editor__badge--required"
                              : "event-editor__badge--optional"
                        }`}
                      >
                        {badge}
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <div className="event-editor__rail-callout">
                <strong>Required before save</strong>
                <p>Warnings never block saving. A TBD venue satisfies the venue requirement.</p>
              </div>
            </aside>

            <form
              className="event-editor-main"
              noValidate
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                handleValidatedSubmit();
              }}
            >
              <div className="event-editor-content">
                {error ? (
                  <p className="notice notice--error" id="event-editor-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {attemptedSave && totalErrors > 0 ? (
                  <div
                    className="notice notice--error"
                    id="event-editor-error-summary"
                    ref={errorSummaryRef}
                    role="alert"
                    tabIndex={-1}
                  >
                    <strong>
                      {String(totalErrors)} required field{totalErrors === 1 ? "" : "s"} need
                      {totalErrors === 1 ? "s" : ""} attention.
                    </strong>{" "}
                    Save will take you to the first missing field.
                    <ul>
                      {visibleSections.map((section) =>
                        sectionErrors[section].length > 0 ? (
                          <li key={section}>
                            {EVENT_EDITOR_SECTION_META[section].label}: {sectionErrors[section][0]}
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </div>
                ) : null}

                <TabsContent
                  aria-labelledby="event-editor-basics-tab"
                  className="event-editor-panel"
                  id="event-editor-basics-panel"
                  value="basics"
                >
                  <div className="event-editor-panel__header">
                    <h3 className="event-editor-panel__title">Basics</h3>
                    <p className="event-editor-panel__description">
                      Title, type, and internal notes. Required sections must be complete before
                      saving.
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="events-page-title">Title *</label>
                    <input
                      aria-describedby={error ? "event-editor-error" : undefined}
                      aria-invalid={sectionErrors.basics.length > 0}
                      id="events-page-title"
                      maxLength={500}
                      onChange={(change) => {
                        setEvent((current) => ({ ...current, title: change.target.value }));
                      }}
                      required
                      value={event.title}
                    />
                    {sectionErrors.basics.some((message) => message.includes("title")) &&
                    showErrorBadges ? (
                      <p className="notice notice--error" role="alert">
                        {sectionErrors.basics.find((message) => message.includes("title"))}
                      </p>
                    ) : null}
                  </div>
                  <div className="field">
                    <label htmlFor="events-page-type">Type *</label>
                    <select
                      id="events-page-type"
                      onChange={(change) => {
                        const type: OrganizationEventRequest["type"] =
                          change.target.value === "Performance" ? "Performance" : "Rehearsal";
                        handleTypeChange(type);
                      }}
                      value={event.type}
                    >
                      <option value="Rehearsal">Rehearsal</option>
                      <option value="Performance">Performance</option>
                    </select>
                  </div>
                  <div className="field">
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
                </TabsContent>

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
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="events-page-start">Start date &amp; time *</label>
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
                  </div>
                  <div className="field">
                    <label htmlFor="events-page-venue">Venue *</label>
                    <select
                      aria-describedby={
                        !event.venueId
                          ? "venue-tbd-helper"
                          : tbdInfo.isTbd
                            ? "venue-tbd-notice"
                            : undefined
                      }
                      aria-invalid={sectionErrors.schedule.length > 0}
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
                  </div>
                  {!event.venueId ? (
                    <div className="event-editor-tbd" id="venue-tbd-helper">
                      <div className="event-editor-tbd__text">
                        <strong>Location not yet confirmed?</strong>
                        <p>
                          Select an existing TBD venue, or create a shared TBD venue with no
                          address. Later, change this event&apos;s venue; do not rename the shared
                          TBD record.
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
                  ) : null}
                  {sectionErrors.schedule.length > 0 && showErrorBadges ? (
                    <p className="notice notice--error" role="alert">
                      {sectionErrors.schedule[0]}
                    </p>
                  ) : null}
                  {tbdInfo.isTbd ? (
                    <p className="notice notice--info" id="venue-tbd-notice" role="status">
                      <strong>Venue to be confirmed:</strong> replace TBD on this event when its
                      location is known. This reminder does not block saving.
                    </p>
                  ) : null}
                  {!event.venueId && existingTbd ? (
                    <p className="field-help">
                      Prefer to pick manually? Choose “{existingTbd.name}” in the venue list.
                    </p>
                  ) : null}
                  {tbdError ? (
                    <p className="notice notice--error" role="alert">
                      {tbdError}
                    </p>
                  ) : null}
                </TabsContent>

                {event.type === "Performance" ? (
                  <TabsContent
                    aria-labelledby="event-editor-rsvp-tab"
                    className="event-editor-panel"
                    id="event-editor-rsvp-panel"
                    value="rsvp"
                  >
                    <div className="event-editor-panel__header">
                      <div className="event-editor-panel__title-row">
                        <h3 className="event-editor-panel__title">RSVPs &amp; reminders</h3>
                        <span className="event-editor__badge event-editor__badge--required">
                          Required section
                        </span>
                      </div>
                      <p className="event-editor-panel__description">
                        Deadline and automated follow-up for Performances.
                      </p>
                    </div>
                    <div className="field">
                      <label htmlFor="events-page-rsvp-deadline">Member RSVP deadline *</label>
                      <input
                        id="events-page-rsvp-deadline"
                        onChange={(change) => {
                          setEvent((current) => ({
                            ...current,
                            rsvpDeadlineDate: change.target.value || null,
                          }));
                        }}
                        required
                        type="date"
                        value={event.rsvpDeadlineDate ?? ""}
                      />
                    </div>
                    <EventRsvpDeadlineNotice
                      deadlineDate={event.rsvpDeadlineDate}
                      eventType={event.type}
                      state={state}
                    />
                    {sectionErrors.rsvp.length > 0 && showErrorBadges ? (
                      <p className="notice notice--error" role="alert">
                        {sectionErrors.rsvp[0]}
                      </p>
                    ) : null}
                    <fieldset>
                      <legend>Automated pending RSVP email</legend>
                      <p className="field-help">
                        This email is not launched by saving the event. When enabled, the background
                        scheduler automatically queues one message{" "}
                        {followUpLeadHours
                          ? `${String(followUpLeadHours)} hours`
                          : "at the configured lead time"}{" "}
                        before the RSVP deadline, only for active Performers still marked Pending.
                        No separate draft or send button is required.
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
                            {state.status === "ready" && state.rsvpFollowUpEnabled
                              ? "enabled"
                              : "disabled"}
                            )
                          </option>
                          <option value="enabled">Enable for this Performance</option>
                          <option value="disabled">Disable for this Performance</option>
                        </select>
                      </label>
                      {event.rsvpFollowUpMode === "enabled" ? (
                        <label className="field" htmlFor="events-page-rsvp-follow-up-hours">
                          Hours before deadline *
                          <NumberInput
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
                            value={event.rsvpFollowUpLeadHours ?? 48}
                          />
                        </label>
                      ) : null}
                      <p
                        className={
                          followUpEnabled ? "notice notice--info" : "notice notice--warning"
                        }
                      >
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
                  </TabsContent>
                ) : null}

                {event.type === "Performance" ? (
                  <TabsContent
                    aria-labelledby="event-editor-tickets-tab"
                    className="event-editor-panel"
                    id="event-editor-tickets-panel"
                    value="tickets"
                  >
                    <div className="event-editor-panel__header">
                      <div className="event-editor-panel__title-row">
                        <h3
                          className="event-editor-panel__title"
                          id="events-section-tickets-heading"
                        >
                          Ticket sales
                        </h3>
                        <span className="event-editor__badge event-editor__badge--optional">
                          Optional
                        </span>
                      </div>
                      <p className="event-editor-panel__description">
                        Prices, capacity, and QR sharing for Performances.
                      </p>
                    </div>
                    <section
                      aria-labelledby="events-section-tickets-heading"
                      className="event-editor-section event-editor-section--tickets"
                      data-section="tickets"
                      id="event-editor-section-tickets"
                      tabIndex={-1}
                    >
                      <label className="checkbox-row">
                        <input
                          checked={event.isTicketingEnabled}
                          id="events-page-enable-ticketing"
                          onChange={(change) => {
                            setEvent((current) => ({
                              ...current,
                              isTicketingEnabled: change.target.checked,
                            }));
                          }}
                          type="checkbox"
                        />
                        Enable ticket sales
                      </label>
                      {event.isTicketingEnabled ? (
                        <div className="form-grid">
                          {isPastEvent ? (
                            <p className="notice notice--warning form-grid__wide" role="alert">
                              <strong>Ticket sales inactive:</strong> This performance date has
                              already passed. Ticket sales will remain closed to the public until
                              the event date is set to a future date and time.
                            </p>
                          ) : null}
                          {!event.publishOnWebsite ? (
                            <p className="notice notice--info form-grid__wide" role="status">
                              <strong>Unpublished on public website:</strong> &quot;Publish on
                              public website&quot; is unchecked. This event will not appear on the
                              public concert schedule. Buyers will only be able to access tickets
                              via direct link or QR code once ticket sales are open.
                            </p>
                          ) : null}
                          {tbdInfo.isTbd ? (
                            <p className="notice notice--info form-grid__wide" role="status">
                              <strong>TBD venue:</strong> ticket buyers will see “TBD” without a
                              physical address or map pin until the actual venue is assigned.
                            </p>
                          ) : null}
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
                          {sectionErrors.tickets.length > 0 && showErrorBadges ? (
                            <p className="notice notice--error form-grid__wide" role="alert">
                              {sectionErrors.tickets[0]}
                            </p>
                          ) : null}
                          <fieldset className="event-ticketing-links">
                            <legend>Ticket page and QR code</legend>
                            <p className="field-help">
                              Share the ticket page with your audience or download its QR code for
                              printed programs and signs.
                            </p>
                            {editingId ? (
                              <>
                                <QRCodeShareCard
                                  description={`Tickets for ${event.title}.`}
                                  path={`/tickets/${editingId}`}
                                  title={`${event.title} tickets`}
                                />
                                {isPastEvent ? (
                                  <p className="notice notice--warning" role="alert">
                                    Ticket sales are currently closed for this link because the
                                    event date has passed. Set a future date above to reopen sales.
                                  </p>
                                ) : null}
                              </>
                            ) : (
                              <p className="ticketing-price-note" role="status">
                                Save this Performance to generate its ticket page and QR code.
                              </p>
                            )}
                          </fieldset>
                        </div>
                      ) : null}
                    </section>
                  </TabsContent>
                ) : null}

                <TabsContent
                  aria-labelledby="event-editor-public-tab"
                  className="event-editor-panel"
                  id="event-editor-public-panel"
                  value="public"
                >
                  <div className="event-editor-panel__header">
                    <div className="event-editor-panel__title-row">
                      <h3 className="event-editor-panel__title">Public content</h3>
                      <span className="event-editor__badge event-editor__badge--optional">
                        Optional
                      </span>
                    </div>
                    <p className="event-editor-panel__description">
                      Public description, graphic, and website visibility.
                    </p>
                  </div>
                  <div className="field">
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
                  <div className="field">
                    <label
                      className={`event-graphic-dropzone${graphicDragging ? " is-dragging" : ""}`}
                      onDragEnter={(dragEvent) => {
                        dragEvent.preventDefault();
                        setGraphicDragging(true);
                      }}
                      onDragLeave={() => {
                        setGraphicDragging(false);
                      }}
                      onDragOver={(dragEvent) => {
                        dragEvent.preventDefault();
                        dragEvent.dataTransfer.dropEffect = "copy";
                        setGraphicDragging(true);
                      }}
                      onDrop={handleGraphicDrop}
                    >
                      <span className="event-graphic-dropzone__title">Public graphic</span>
                      {activeGraphicPreviewUrl ? (
                        <div className="event-graphic-dropzone__preview">
                          <img
                            alt="Public graphic preview"
                            className="event-graphic-dropzone__image"
                            src={activeGraphicPreviewUrl}
                          />
                        </div>
                      ) : null}
                      <span className="event-graphic-dropzone__label">
                        {graphicFile ? (
                          <>
                            Selected: <strong>{graphicFile.name}</strong>
                          </>
                        ) : (
                          <>
                            Drag and drop an image here, or{" "}
                            <span className="event-graphic-dropzone__browse">browse</span>
                          </>
                        )}
                      </span>
                      <span className="field-help">
                        {event.publicGraphicFileId && !graphicFile
                          ? "An image is already saved. Choose another image to replace it."
                          : "PNG, JPG, or WebP images are supported."}
                      </span>
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        aria-describedby={graphicError ? "event-graphic-error" : undefined}
                        aria-invalid={Boolean(graphicError)}
                        className="sr-only"
                        id="events-page-graphic"
                        onChange={(change) => {
                          handleGraphicFile(change.target.files?.[0] ?? null);
                          change.target.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    {graphicError ? (
                      <p className="notice notice--error" id="event-graphic-error" role="alert">
                        {graphicError}
                      </p>
                    ) : null}
                    {graphicFile ? (
                      <button
                        className="text-button"
                        onClick={handleRemoveGraphicFile}
                        type="button"
                      >
                        Remove selected image
                      </button>
                    ) : event.publicGraphicFileId ? (
                      <button
                        className="text-button"
                        onClick={() => {
                          setGraphicError(null);
                          setEvent((current) => ({ ...current, publicGraphicFileId: null }));
                        }}
                        type="button"
                      >
                        Remove saved image
                      </button>
                    ) : null}
                  </div>
                  <label className="checkbox-row" htmlFor="events-page-publish">
                    <input
                      checked={event.publishOnWebsite}
                      id="events-page-publish"
                      onChange={(change) => {
                        setEvent((current) => ({
                          ...current,
                          publishOnWebsite: change.target.checked,
                        }));
                      }}
                      type="checkbox"
                    />
                    Publish on public website
                  </label>
                  {event.publishOnWebsite && tbdInfo.isTbd ? (
                    <p className="notice notice--info" role="status">
                      <strong>Publishing with TBD venue:</strong> the public page will show “TBD”
                      without an address or map pin until the actual venue is assigned.
                    </p>
                  ) : null}
                  {!event.publishOnWebsite ? (
                    <p className="notice notice--info" role="status">
                      This event will not appear on the public concert schedule until publishing is
                      enabled.
                    </p>
                  ) : null}
                </TabsContent>
              </div>

              <div className="event-editor-footer" role="region" aria-label="Event editor save bar">
                <span className="event-editor-footer__status" role="status">
                  {footerStatus}
                </span>
                <div className="event-editor-footer__actions">
                  {showBackToTicketing ? (
                    <button className="button button--secondary" onClick={onClose} type="button">
                      Back to Ticketing
                    </button>
                  ) : (
                    <>
                      <DialogClose asChild>
                        <button className="button button--secondary" type="button">
                          Cancel
                        </button>
                      </DialogClose>
                      <button
                        className="button button--primary"
                        disabled={saveDisabled}
                        type="submit"
                      >
                        {eventSaveLabel(busy, editingId)}
                      </button>
                    </>
                  )}
                  {dirty && showBackToTicketing ? (
                    <button
                      className="button button--primary"
                      disabled={saveDisabled}
                      type="submit"
                    >
                      {eventSaveLabel(busy, editingId)}
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          </div>
        </div>
      </Tabs>
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
        <p className="notice notice--error" id="archive-event-error" role="alert">
          {error}
        </p>
      ) : null}
      <p>{archiveCandidate ? `Archive ${archiveCandidate.title}?` : "Archive this event?"}</p>
      <div className="dialog__actions">
        <DialogClose asChild>
          <button className="button button--secondary" disabled={busy} type="button">
            Cancel
          </button>
        </DialogClose>
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
        <p className="notice notice--error" id="cancel-event-error" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        {cancelCandidate
          ? `Cancel ${cancelCandidate.title}? Linked rehearsals will also be canceled.`
          : "Cancel this event?"}
      </p>
      <div className="dialog__actions">
        <DialogClose asChild>
          <button className="button button--secondary" disabled={busy} type="button">
            Keep event
          </button>
        </DialogClose>
        <button className="button button--danger" disabled={busy} onClick={onCancel} type="button">
          {busy ? "Canceling…" : "Cancel event"}
        </button>
      </div>
    </Dialog>
  );
}
