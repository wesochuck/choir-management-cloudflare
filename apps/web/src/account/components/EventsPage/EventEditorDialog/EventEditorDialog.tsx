import type { OrganizationEventRequest, OrganizationVenue } from "@choir/contracts";
import { Dialog, DialogClose, Tabs, TabsList, TabsTrigger, useConfirmation } from "@choir/ui";
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
import { createOrganizationVenue, listOrganizationVenues } from "../../../../auth/api";

import {
  eventDialogDescription,
  eventDialogTitle,
  currencyCentsFromDraft,
  currencyDraftFromCents,
} from "../utils";

import type { EventsState } from "../types";
import {
  computeSectionErrors,
  countSectionErrors,
  firstFieldIdForSection,
  firstInvalidFieldId,
  firstInvalidSection,
  getTbdVenueForEvent,
  isSectionRequired,
  resolveEventPrimaryAction,
  totalErrorCount,
  visibleEditorSections,
  EVENT_EDITOR_SECTION_META,
  type EventEditorSection,
} from "../eventSections";
import { ensureTbdVenue, findTbdVenue } from "../tbdVenue";

import { EditorUnsavedIndicator } from "../../EditorUnsavedIndicator";
import { eventDirtySections } from "../eventDirtySections";

import { BasicsSection } from "./BasicsSection";
import { EventEditorHeader } from "./EventEditorHeader";
import { PublicSection } from "./PublicSection";
import { RsvpSection } from "./RsvpSection";
import { ScheduleSection } from "./ScheduleSection";
import { TicketingSection } from "./TicketingSection";

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
  canManageSetLists = true,
  dialogOpen,
  editingId,
  error,
  event,
  eventStart,
  graphicFile,
  initialSection = null,
  navigate,
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
  readonly canManageSetLists?: boolean | undefined;
  readonly dialogOpen: boolean;
  readonly editingId: string | null;
  readonly error: string | null;
  readonly event: OrganizationEventRequest;
  readonly eventStart: string;
  readonly graphicFile: File | null;
  readonly initialSection?: string | null | undefined;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (event: OrganizationEventRequest) => void;
  readonly onVenueCreated?: ((venue: OrganizationVenue) => void) | undefined;
  readonly returnTo?: string | null | undefined;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly setEventStart: (value: string) => void;
  readonly setGraphicFile: (file: File | null) => void;
  readonly state: EventsState;
}) {
  const { confirm, confirmationDialog } = useConfirmation();

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
  const [attemptedAdvance, setAttemptedAdvance] = useState(false);
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

  const dirtySections = eventDirtySections(event, initialDraft.event);
  dirtySections.schedule ||= eventStart !== initialDraft.eventStart;
  dirtySections.tickets ||=
    advancePriceDraft !== initialDraft.advancePriceDraft ||
    dayOfPriceDraft !== initialDraft.dayOfPriceDraft;
  dirtySections.public ||= graphicFile !== null;

  async function handleOpenSetList(): Promise<void> {
    if (!editingId) return;
    if (dirty) {
      const shouldDiscard = await confirm({
        confirmLabel: "Discard changes",
        description: "Your unsaved changes will be lost if you leave this event.",
        destructive: true,
        title: "Discard unsaved changes?",
      });
      if (!shouldDiscard) return;
    }
    const targetUrl = `/admin/setlists?eventId=${encodeURIComponent(editingId)}`;
    if (navigate) {
      navigate(targetUrl);
    } else {
      window.location.assign(targetUrl);
    }
  }

  async function handleOpenRsvpDetails(destination?: string): Promise<void> {
    if (!editingId) return;
    if (dirty) {
      const shouldDiscard = await confirm({
        confirmLabel: "Discard changes",
        description: "Your unsaved changes will be lost if you leave this event.",
        destructive: true,
        title: "Discard unsaved changes?",
      });
      if (!shouldDiscard) return;
    }
    const targetUrl = destination ?? `/admin/rsvp?eventId=${encodeURIComponent(editingId)}`;
    if (navigate) {
      navigate(targetUrl);
    } else {
      window.location.assign(targetUrl);
    }
  }
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

  function handleNextSection(targetSection: EventEditorSection): void {
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
    if (errors[activeSection].length > 0) {
      setAttemptedAdvance(true);
      focusInvalidControl(activeSection);
      return;
    }
    setAttemptedAdvance(false);
    setActiveSection(targetSection);
    window.setTimeout(() => {
      const fieldId = firstFieldIdForSection(targetSection, normalizedEvent);
      const target = document.getElementById(fieldId);
      if (target instanceof HTMLElement && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
    }, 30);
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
    setAttemptedAdvance(false);
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
      if (nextType === "Other") {
        return {
          ...current,
          isTicketingEnabled: false,
          parentPerformanceId: null,
          publicGraphicFileId: null,
          publishOnWebsite: false,
          rsvpDeadlineDate: null,
          setList: [],
          setListApproved: false,
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
    } else if (
      nextType === "Other" &&
      (activeSection === "tickets" || activeSection === "public")
    ) {
      setActiveSection("rsvp");
    }
  }

  const primaryAction = useMemo(
    () =>
      resolveEventPrimaryAction({
        activeSection,
        busy,
        editingId,
        sectionErrors,
        type: event.type,
        visibleSections,
      }),
    [activeSection, busy, editingId, event.type, sectionErrors, visibleSections],
  );

  const showErrorBadges = attemptedSave || attemptedAdvance || dirty;
  const footerStatus = busy
    ? "Saving…"
    : totalErrors > 0 && showErrorBadges
      ? `${String(totalErrors)} required field${totalErrors === 1 ? "" : "s"} need${totalErrors === 1 ? "s" : ""} attention`
      : dirty
        ? "Unsaved changes"
        : "No unsaved changes";

  const saveDisabled = busy || (primaryAction.mode === "save" && !dirty && editingId !== null);
  const showBackToTicketing =
    !dirty &&
    returnTo &&
    (returnTo.startsWith("/admin/tickets") || returnTo.startsWith("/admin/ticketing"));

  const timezoneLabel = state.status === "ready" ? state.timezone : null;

  return (
    <>
      <Dialog
        className="dialog--event-editor"
        description={eventDialogDescription(state)}
        dirty={dirty}
        header={
          <EventEditorHeader
            busy={busy}
            canManageSetLists={canManageSetLists}
            dirty={dirty}
            editingId={editingId}
            eventStart={eventStart}
            eventTitle={event.title}
            eventType={event.type}
            onOpenSetList={() => {
              void handleOpenSetList();
            }}
            timezoneLabel={timezoneLabel}
          />
        }
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
                      {dirtySections[section] ? " — Unsaved changes" : ""}
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
                        aria-describedby={
                          dirtySections[section] ? `event-editor-${section}-unsaved` : undefined
                        }
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
                          {dirtySections[section] ? (
                            <EditorUnsavedIndicator id={`event-editor-${section}-unsaved`} />
                          ) : null}
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
                  if (primaryAction.mode === "next" && primaryAction.targetSection) {
                    handleNextSection(primaryAction.targetSection);
                  } else {
                    handleValidatedSubmit();
                  }
                }}
              >
                <div className="event-editor-content">
                  {error ? (
                    <p
                      className="notice notice--error"
                      id="event-editor-error"
                      role="alert"
                      tabIndex={-1}
                    >
                      {error}
                    </p>
                  ) : null}

                  {totalErrors > 0 && attemptedSave ? (
                    <div
                      aria-live="polite"
                      className="notice notice--error event-editor-error-summary"
                      id="event-editor-error-summary"
                      ref={errorSummaryRef}
                      role="alert"
                      tabIndex={-1}
                    >
                      <strong>
                        Please resolve {String(totalErrors)} error{totalErrors === 1 ? "" : "s"}{" "}
                        before saving:
                      </strong>
                      <ul>
                        {visibleSections.map((section) =>
                          sectionErrors[section].length > 0 ? (
                            <li key={section}>
                              {EVENT_EDITOR_SECTION_META[section].label}:{" "}
                              {sectionErrors[section][0]}
                            </li>
                          ) : null,
                        )}
                      </ul>
                    </div>
                  ) : null}

                  <BasicsSection
                    error={error}
                    event={event}
                    handleTypeChange={handleTypeChange}
                    sectionErrors={sectionErrors}
                    setEvent={setEvent}
                    showErrorBadges={showErrorBadges}
                  />

                  <ScheduleSection
                    busy={busy}
                    event={event}
                    eventStart={eventStart}
                    existingTbd={existingTbd ?? null}
                    handleEnsureTbd={handleEnsureTbd}
                    sectionErrors={sectionErrors}
                    setEvent={setEvent}
                    setEventStart={setEventStart}
                    setTbdError={setTbdError}
                    showErrorBadges={showErrorBadges}
                    state={state}
                    tbdBusy={tbdBusy}
                    tbdError={tbdError}
                    tbdInfo={tbdInfo}
                    timezoneLabel={timezoneLabel}
                  />

                  {visibleSections.includes("rsvp") ? (
                    <RsvpSection
                      editingId={editingId}
                      event={event}
                      followUpEnabled={followUpEnabled}
                      followUpLeadHours={followUpLeadHours}
                      onNavigate={(href) => {
                        void handleOpenRsvpDetails(href);
                      }}
                      onOpenRsvpDetails={() => {
                        void handleOpenRsvpDetails();
                      }}
                      sectionErrors={sectionErrors}
                      setEvent={setEvent}
                      showErrorBadges={showErrorBadges}
                      state={state}
                    />
                  ) : null}

                  {visibleSections.includes("tickets") ? (
                    <TicketingSection
                      advancePriceDraft={advancePriceDraft}
                      dayOfPriceDraft={dayOfPriceDraft}
                      editingId={editingId}
                      event={event}
                      eventStart={eventStart}
                      isPastEvent={isPastEvent}
                      sectionErrors={sectionErrors}
                      setAdvancePriceDraft={setAdvancePriceDraft}
                      setDayOfPriceDraft={setDayOfPriceDraft}
                      setEvent={setEvent}
                      showErrorBadges={showErrorBadges}
                      state={state}
                      tbdInfo={tbdInfo}
                    />
                  ) : null}

                  {visibleSections.includes("public") ? (
                    <PublicSection
                      activeGraphicPreviewUrl={activeGraphicPreviewUrl}
                      event={event}
                      graphicDragging={graphicDragging}
                      graphicError={graphicError}
                      graphicFile={graphicFile}
                      handleGraphicDrop={handleGraphicDrop}
                      handleGraphicFile={handleGraphicFile}
                      handleRemoveGraphicFile={handleRemoveGraphicFile}
                      setEvent={setEvent}
                      setGraphicDragging={setGraphicDragging}
                      setGraphicError={setGraphicError}
                      tbdInfo={tbdInfo}
                    />
                  ) : null}
                </div>

                <div
                  className="event-editor-footer"
                  role="region"
                  aria-label="Event editor save bar"
                >
                  <span className="event-editor-footer__status" role="status">
                    <span
                      aria-hidden="true"
                      className={`event-editor-footer__dot ${dirty ? "event-editor-footer__dot--dirty" : "event-editor-footer__dot--pristine"}`}
                    />
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
                          aria-label={primaryAction.accessibleLabel}
                          className="button button--primary"
                          disabled={saveDisabled}
                          type="submit"
                        >
                          <span className="event-editor-primary-action__text--full">
                            {primaryAction.label}
                          </span>
                          <span className="event-editor-primary-action__text--short">
                            {primaryAction.shortLabel}
                          </span>
                        </button>
                      </>
                    )}
                    {dirty && showBackToTicketing ? (
                      <button
                        aria-label={primaryAction.accessibleLabel}
                        className="button button--primary"
                        disabled={saveDisabled}
                        type="submit"
                      >
                        <span className="event-editor-primary-action__text--full">
                          {primaryAction.label}
                        </span>
                        <span className="event-editor-primary-action__text--short">
                          {primaryAction.shortLabel}
                        </span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </Tabs>
      </Dialog>
      {confirmationDialog}
    </>
  );
}
