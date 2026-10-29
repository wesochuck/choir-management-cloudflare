import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
} from "@choir/contracts";
import { Dialog, DialogClose, Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { AttendanceAutomationSettings } from "./AttendanceAutomationSettings";
import {
  type AttendanceFilter,
  type AttendanceGroup,
  useAttendanceFiltering,
  useAttendanceMutations,
  useAttendanceQueries,
} from "./components/AttendanceManager/hooks";
import {
  type AttendanceUndoEntry,
  undoActionLabel,
  undoMessageText,
} from "./components/AttendanceManager/undoHistory";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

function attendanceLabel(status: OrganizationAttendanceStatus): string {
  if (status === "Present") return "Present";
  if (status === "Absent") return "Absent";
  return "Tap to check in";
}

function displayEventDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSyncTime(value: Date | null): string {
  if (!value) return "Waiting for updates";
  return `Updated ${value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

interface AttendanceGroupProps {
  readonly bulkBusy: boolean;
  readonly group: AttendanceGroup;
  readonly onChange: (profileId: string) => void;
  readonly partLabel: string;
  readonly savingIds: ReadonlySet<string>;
}

function AttendanceGroupComponent({
  bulkBusy,
  group,
  onChange,
  partLabel,
  savingIds,
}: AttendanceGroupProps) {
  const { name, rows } = group;
  return (
    <div className="attendance-group" key={group.key}>
      <h3>{name}</h3>
      {rows.map((row) => {
        const isSaving = savingIds.has(row.profileId) || bulkBusy;
        return (
          <div
            className={`attendance-row attendance-row--${row.attendance.toLowerCase()}`}
            key={row.profileId}
          >
            <button
              aria-label={`${row.displayName}: ${attendanceLabel(row.attendance)}. Tap to change.`}
              className="attendance-row__toggle"
              data-profile-id={row.profileId}
              disabled={isSaving}
              onClick={() => {
                onChange(row.profileId);
              }}
              type="button"
            >
              <span className="attendance-row__indicator" aria-hidden="true">
                {row.attendance === "Present" ? "✓" : row.attendance === "Absent" ? "×" : ""}
              </span>
              <span className="attendance-row__identity">
                <strong>{row.displayName}</strong>
                <span>
                  {row.voicePart || `${partLabel} not set`}
                  <span className="attendance-row__inline-status">
                    {" "}
                    · {attendanceLabel(row.attendance)}
                  </span>
                </span>
              </span>
              <span className="attendance-row__compact-status">{row.attendance}</span>
              {row.rsvp !== "Yes" ? (
                <span
                  className={`attendance-row__rsvp attendance-row__rsvp--${row.rsvp.toLowerCase()}`}
                >
                  {row.rsvp === "No" ? "Declined" : "Not currently RSVP'd"}
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface UnexpectedAttendanceDialogProps {
  readonly busy: boolean;
  readonly candidate: OrganizationAttendanceRow | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

function UnexpectedAttendanceDialog({
  busy,
  candidate,
  onClose,
  onConfirm,
}: UnexpectedAttendanceDialogProps) {
  return (
    <Dialog
      description="Confirm the attendance and RSVP update before continuing."
      onClose={onClose}
      open={candidate !== null}
      title="Mark unexpected attendee present?"
    >
      <div className="form-stack">
        <p className="notice notice--warning" role="alert">
          {candidate?.displayName ?? "This attendee"} is not currently RSVP&apos;d. Marking them
          Present will RSVP them Yes for this event and, for a linked Rehearsal, its linked
          Performance.
        </p>
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            aria-busy={busy}
            className="button button--primary"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Saving…" : "Mark present and RSVP"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface AttendanceUndoBarProps {
  readonly entry: AttendanceUndoEntry | null;
  readonly isBusy: boolean;
  readonly isPerformerSaving: boolean;
  readonly onUndo: () => void;
  readonly undoButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly undoError: { readonly kind: "error" | "conflict"; readonly profileId: string } | null;
}

function AttendanceUndoBarComponent({
  entry,
  isBusy,
  isPerformerSaving,
  onUndo,
  undoButtonRef,
  undoError,
}: AttendanceUndoBarProps) {
  if (!entry) {
    return <div aria-hidden="true" className="attendance-undo-bar attendance-undo-bar--empty" />;
  }
  const isError = undoError?.profileId === entry.profileId && undoError.kind === "error";
  const message = isBusy
    ? `Restoring ${entry.displayName}…`
    : isError
      ? `Could not restore ${entry.displayName}`
      : undoMessageText(entry);
  const actionLabel = isBusy
    ? `Restoring attendance for ${entry.displayName}`
    : undoActionLabel(entry, isError);

  return (
    <div className={`attendance-undo-bar${isError ? " attendance-undo-bar--error" : ""}`}>
      <span className="attendance-undo-bar__message" title={message}>
        {message}
      </span>
      <span aria-hidden="true" className="attendance-undo-bar__separator">
        ·
      </span>
      <button
        aria-label={actionLabel}
        className="attendance-undo-bar__action"
        disabled={isBusy || isPerformerSaving}
        onClick={onUndo}
        ref={undoButtonRef}
        type="button"
      >
        {isBusy ? "Restoring…" : isError ? "Retry" : "Undo"}
      </button>
    </div>
  );
}

interface AttendanceControlsProps {
  readonly eventId: string;
  readonly events: readonly OrganizationEvent[];
  readonly eventLocationLabel: (event: OrganizationEvent) => string;
  readonly onSelectEvent: (id: string) => void;
  readonly performerLabel: string;
  readonly partLabel: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}

function AttendanceControlsComponent({
  eventId,
  events,
  eventLocationLabel,
  onSelectEvent,
  performerLabel,
  partLabel,
  query,
  onQueryChange,
}: AttendanceControlsProps) {
  const selectedEvent = events.find((event) => event.id === eventId) ?? events[0];
  const selectedLocation = selectedEvent ? eventLocationLabel(selectedEvent) : "";
  const selectedEventText = selectedEvent
    ? `${selectedEvent.title} · ${displayEventDate(selectedEvent.startsAt)}${selectedLocation ? ` · ${selectedLocation}` : ""}`
    : "";

  return (
    <div className="attendance-manager__controls">
      <label className="field attendance-manager__event-field">
        <span>Event</span>
        <select
          aria-label="Event"
          className="attendance-manager__event-select"
          title={selectedEventText}
          value={eventId}
          onChange={(event) => {
            onSelectEvent(event.target.value);
          }}
        >
          {events.map((event) => {
            const optionLabel = `${event.title} · ${displayEventDate(event.startsAt)}${eventLocationLabel(event) ? ` · ${eventLocationLabel(event)}` : ""}`;
            return (
              <option key={event.id} title={optionLabel} value={event.id}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      </label>
      <label className="field attendance-manager__search">
        <span>Find a {performerLabel.toLowerCase()}</span>
        <input
          aria-label={`Find a ${performerLabel.toLowerCase()}`}
          inputMode="search"
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          placeholder={`Search name or ${partLabel.toLowerCase()}`}
          type="search"
          value={query}
        />
      </label>
    </div>
  );
}

export function AttendanceManager({
  enabled,
  initialTab = "attendance",
}: {
  readonly enabled: boolean;
  readonly initialTab?: "attendance" | "automation";
}) {
  const { partLabel, performerLabel, performerLabelPlural } = useOrganizationTerminology();
  const [activeTab, setActiveTab] = useState<"attendance" | "automation">(initialTab);
  const [filter, setFilter] = useState<AttendanceFilter>("Pending");
  const [query, setQuery] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync active tab when initialTab prop updates
    setActiveTab(initialTab);
  }, [initialTab]);

  const { dataUpdatedAt, eventId, events, rosterConfiguration, rows, setSelectedEventId, venues } =
    useAttendanceQueries(enabled);

  const {
    bulkBusy,
    bulkConfirmOpen,
    changeAttendance,
    confirmUnexpectedAttendance,
    latestUndoEntry,
    liveAnnouncement,
    markRemainingPresent,
    message,
    rescueBusy,
    rescueCandidate,
    savingIds,
    setBulkConfirmOpen,
    setRescueCandidate,
    undoBusy,
    undoEntries,
    undoError,
    undoLatest,
  } = useAttendanceMutations({ eventId, rows });

  const undoButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleUndo = () => {
    if (!latestUndoEntry) return;
    const hadFocus =
      undoButtonRef.current !== null && document.activeElement === undoButtonRef.current;
    const wasLastEntry = undoEntries.length === 1;
    const targetProfileId = latestUndoEntry.profileId;

    void undoLatest().then((success) => {
      if (success && hadFocus && wasLastEntry) {
        requestAnimationFrame(() => {
          const rowButton = document.querySelector<HTMLElement>(
            `button[data-profile-id="${targetProfileId}"]`,
          );
          if (rowButton) {
            rowButton.focus();
          } else {
            const filters = document.querySelector<HTMLElement>(".attendance-filters");
            filters?.focus();
          }
        });
      }
    });
  };

  const { counts, groupedRows, markableRows } = useAttendanceFiltering({
    filter,
    query,
    rosterConfiguration,
    rows,
    savingIds,
  });

  const venueNameById = useMemo(
    () => new Map(venues.map((venue) => [venue.id, venue.name])),
    [venues],
  );
  function eventLocationLabel(event: OrganizationEvent): string {
    return venueNameById.get(event.venueId ?? "") ?? event.location.trim();
  }

  if (!enabled) return null;
  return (
    <section className="account-section attendance-manager" aria-label="Attendance management">
      <Tabs onValueChange={setActiveTab} value={activeTab}>
        <TabsList
          aria-label="Attendance sections"
          as="nav"
          className="ticketing-tabs rsvp-page-tabs"
        >
          <TabsTrigger
            aria-controls="attendance-events-panel"
            id="attendance-events-tab"
            value="attendance"
          >
            Event attendance
          </TabsTrigger>
          <TabsTrigger
            aria-controls="attendance-automation-panel"
            id="attendance-automation-tab"
            value="automation"
          >
            Attendance automation
          </TabsTrigger>
        </TabsList>

        <TabsContent
          aria-labelledby="attendance-events-tab"
          className="rsvp-manager__tab-content"
          id="attendance-events-panel"
          value="attendance"
        >
          <div className="attendance-manager__sticky-header">
            <div className="attendance-manager__intro">
              <div className="attendance-manager__sync-container">
                <p className="attendance-manager__sync" role="status">
                  <span aria-hidden="true">●</span> Live updates every 5 seconds ·{" "}
                  {formatSyncTime(dataUpdatedAt ? new Date(dataUpdatedAt) : null)}
                </p>
              </div>
              <div className="attendance-manager__count" aria-label="Attendance progress">
                <div>
                  <strong>{String(counts.present)}</strong> / {String(counts.expected)}
                </div>
                <span>present</span>
              </div>
            </div>

            <AttendanceControlsComponent
              eventId={eventId}
              eventLocationLabel={eventLocationLabel}
              events={events}
              onQueryChange={setQuery}
              onSelectEvent={setSelectedEventId}
              partLabel={partLabel}
              performerLabel={performerLabel}
              query={query}
            />

            <div className="attendance-manager__toolbar">
              <div className="attendance-filters" aria-label="Attendance filter" role="group">
                {(
                  [
                    ["Pending", `Unmarked ${String(counts.pending)}`],
                    ["All", `All ${String(counts.roster)}`],
                    ["Present", `Present ${String(counts.presentTotal)}`],
                    ["Absent", `Absent ${String(counts.absent)}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-label={label}
                    aria-pressed={filter === value}
                    title={label}
                    className={
                      filter === value
                        ? "attendance-filter attendance-filter--active"
                        : "attendance-filter"
                    }
                    key={value}
                    onClick={() => {
                      setFilter(value);
                    }}
                    type="button"
                  >
                    <span className="attendance-filter__label">{label}</span>
                    <span aria-hidden="true" className="attendance-filter__compact-label">
                      {value === "Present"
                        ? `✓ ${String(counts.presentTotal)}`
                        : value === "Absent"
                          ? `× ${String(counts.absent)}`
                          : value === "All"
                            ? "All"
                            : label}
                    </span>
                  </button>
                ))}
              </div>
              <button
                aria-label="Mark remaining present"
                title="Mark remaining present"
                className="button button--primary attendance-manager__bulk"
                disabled={bulkBusy || markableRows.length === 0}
                onClick={() => {
                  setBulkConfirmOpen(true);
                }}
                type="button"
              >
                <span className="attendance-manager__bulk-label">
                  {bulkBusy ? "Saving…" : "Mark remaining present"}
                </span>
                <span aria-hidden="true" className="attendance-manager__bulk-icon">
                  ✓+
                </span>
              </button>
            </div>
            <div
              className={`attendance-undo-slot${latestUndoEntry === null ? " attendance-undo-slot--empty" : ""}`}
            >
              <AttendanceUndoBarComponent
                entry={latestUndoEntry}
                isBusy={undoBusy}
                isPerformerSaving={
                  latestUndoEntry !== null && savingIds.has(latestUndoEntry.profileId)
                }
                onUndo={handleUndo}
                undoButtonRef={undoButtonRef}
                undoError={undoError}
              />
            </div>
          </div>

          <div aria-atomic="true" aria-live="polite" className="sr-only">
            {liveAnnouncement}
          </div>

          {message ? (
            <p className="attendance-manager__message" role="alert">
              {message}
            </p>
          ) : null}

          {rows.length === 0 ? <p>No Profiles are available for this event.</p> : null}
          {rows.length > 0 && groupedRows.rsvped.length + groupedRows.notRsvped.length === 0 ? (
            <p className="attendance-manager__empty">
              No {performerLabelPlural.toLowerCase()} match this filter.
            </p>
          ) : null}
          <div className="attendance-list">
            {groupedRows.rsvped.map((group) => (
              <AttendanceGroupComponent
                bulkBusy={bulkBusy}
                group={group}
                key={group.key}
                onChange={changeAttendance}
                partLabel={partLabel}
                savingIds={savingIds}
              />
            ))}
            {groupedRows.notRsvped.length > 0 ? (
              <div
                aria-label="Not currently RSVP'd"
                className="attendance-list__divider"
                role="separator"
              >
                <span>Not currently RSVP&apos;d</span>
              </div>
            ) : null}
            {groupedRows.notRsvped.map((group) => (
              <AttendanceGroupComponent
                bulkBusy={bulkBusy}
                group={group}
                key={`not-rsvped-${group.key}`}
                onChange={changeAttendance}
                partLabel={partLabel}
                savingIds={savingIds}
              />
            ))}
          </div>
          <UnexpectedAttendanceDialog
            busy={rescueBusy}
            candidate={rescueCandidate}
            onClose={() => {
              if (!rescueBusy) setRescueCandidate(null);
            }}
            onConfirm={() => {
              void confirmUnexpectedAttendance();
            }}
          />
          <Dialog
            description="This action may be difficult to undo."
            onClose={() => {
              if (!bulkBusy) setBulkConfirmOpen(false);
            }}
            open={bulkConfirmOpen}
            title="Mark remaining present?"
          >
            <div className="form-stack">
              <p className="notice notice--warning" role="alert">
                This will mark {String(markableRows.length)}{" "}
                {markableRows.length === 1
                  ? performerLabel.toLowerCase()
                  : performerLabelPlural.toLowerCase()}{" "}
                who RSVP&apos;d Yes and are not currently Present as Present.
              </p>
              <div className="dialog__actions">
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setBulkConfirmOpen(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="button button--danger"
                  onClick={() => {
                    setBulkConfirmOpen(false);
                    void markRemainingPresent(markableRows);
                  }}
                  type="button"
                >
                  Mark remaining present
                </button>
              </div>
            </div>
          </Dialog>
        </TabsContent>

        <TabsContent
          aria-labelledby="attendance-automation-tab"
          className="rsvp-manager__tab-content"
          id="attendance-automation-panel"
          value="automation"
        >
          <AttendanceAutomationSettings enabled={enabled} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
