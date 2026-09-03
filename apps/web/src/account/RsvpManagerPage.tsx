import type { OrganizationAttendanceRow } from "@choir/contracts";
import { DataTable, useConfirmation, type DataTableColumn } from "@choir/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { AuthApiError } from "../api";
import {
  RsvpHistoryTable,
  RsvpManagerFilters,
  isHistoryFilter,
  lastName,
  nearestUpcomingPerformance,
  reportableSections,
  reportableVoiceParts,
  statusText,
  type HistoryFilter,
  type RsvpAssignmentFilter,
  type RsvpCounts,
  type RsvpFilter,
  type RsvpState,
  type RsvpView,
} from "./components/RsvpManager";
import {
  useBulkUpdateRsvpMutation,
  useEventAttendanceQuery,
  useEventRsvpHistoryQuery,
  useRsvpBootstrapQuery,
  useSetRsvpMutation,
} from "./hooks/useRsvpQueries";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

// eslint-disable-next-line complexity -- the RSVP manager coordinates filters, per-row updates, and bulk selection in one screen state.
export function RsvpManagerPage({
  enabled,
  eventId: initialEventId = null,
}: {
  readonly enabled: boolean;
  readonly eventId?: string | null;
}) {
  const { partLabel } = useOrganizationTerminology();
  const [eventId, setEventId] = useState(initialEventId ?? "");
  const [filter, setFilter] = useState<RsvpFilter>("active");
  const [assignmentFilter, setAssignmentFilter] = useState<RsvpAssignmentFilter | null>(null);
  const [view, setView] = useState<RsvpView>("roster");
  const [query, setQuery] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("All");
  const [historyQuery, setHistoryQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<readonly string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { confirm, confirmationDialog } = useConfirmation();

  const bootstrapQuery = useRsvpBootstrapQuery(enabled);

  useEffect(() => {
    if (!bootstrapQuery.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync default selected event ID when bootstrap data loads
    setEventId((current) => {
      if (current && bootstrapQuery.data.events.some((event) => event.id === current))
        return current;
      if (
        initialEventId &&
        bootstrapQuery.data.events.some((event) => event.id === initialEventId)
      ) {
        return initialEventId;
      }
      return nearestUpcomingPerformance(bootstrapQuery.data.events);
    });
  }, [bootstrapQuery.data, initialEventId]);

  const attendanceQuery = useEventAttendanceQuery(eventId, enabled && bootstrapQuery.isSuccess);
  const historyQueryData = useEventRsvpHistoryQuery(eventId, enabled && bootstrapQuery.isSuccess);
  const setRsvpMutation = useSetRsvpMutation(eventId);
  const bulkRsvpMutation = useBulkUpdateRsvpMutation(eventId);

  const state: RsvpState = useMemo(() => {
    if (bootstrapQuery.isError) return { status: "error" };
    if (bootstrapQuery.data) {
      return {
        events: bootstrapQuery.data.events,
        profiles: bootstrapQuery.data.profiles,
        roster: bootstrapQuery.data.roster,
        status: "ready",
      };
    }
    return { status: "loading" };
  }, [bootstrapQuery.data, bootstrapQuery.isError]);

  const rows = useMemo(() => attendanceQuery.data ?? [], [attendanceQuery.data]);
  const history = useMemo(() => historyQueryData.data ?? [], [historyQueryData.data]);
  const rowsLoading = attendanceQuery.isLoading;
  const historyLoading = historyQueryData.isLoading;
  const rowsError = attendanceQuery.error
    ? attendanceQuery.error instanceof AuthApiError
      ? attendanceQuery.error.message
      : "The RSVP roster could not be loaded."
    : null;
  const historyError = historyQueryData.error
    ? historyQueryData.error instanceof AuthApiError
      ? historyQueryData.error.message
      : "The RSVP history could not be loaded."
    : null;

  const selectedEvent =
    state.status === "ready"
      ? (state.events.find((candidate) => candidate.id === eventId) ?? null)
      : null;
  const profileById = useMemo(
    () =>
      new Map(
        (state.status === "ready" ? state.profiles : []).map((profile) => [profile.id, profile]),
      ),
    [state],
  );
  const activeRows = useMemo(
    () => rows.filter((row) => profileById.get(row.profileId)?.globalStatus === "Active"),
    [profileById, rows],
  );
  const counts: RsvpCounts = useMemo(
    () => ({
      active: activeRows.length,
      attending: activeRows.filter((row) => row.rsvp === "Yes").length,
      declined: activeRows.filter((row) => row.rsvp === "No").length,
      pending: activeRows.filter((row) => row.rsvp === "Pending").length,
    }),
    [activeRows],
  );
  const balanceRows = useMemo(
    () => (filter === "active" ? activeRows : activeRows.filter((row) => row.rsvp === filter)),
    [activeRows, filter],
  );
  const voicePartCounts = useMemo(() => {
    const values = new Map<string, number>();
    if (state.status !== "ready") return values;
    reportableVoiceParts(state.roster).forEach(({ label }) => values.set(label, 0));
    balanceRows.forEach((row) => {
      if (values.has(row.voicePart))
        values.set(row.voicePart, (values.get(row.voicePart) ?? 0) + 1);
    });
    return values;
  }, [balanceRows, state]);
  const sectionByVoicePart = useMemo(() => {
    if (state.status !== "ready") return new Map<string, string>();
    return new Map(state.roster.voiceParts.map(({ label, sectionCode }) => [label, sectionCode]));
  }, [state]);
  const sectionCounts = useMemo(() => {
    const values = new Map<string, number>();
    if (state.status !== "ready") return values;
    reportableSections(state.roster).forEach(({ code }) => values.set(code, 0));
    balanceRows.forEach((row) => {
      const sectionCode = sectionByVoicePart.get(row.voicePart);
      if (sectionCode && values.has(sectionCode)) {
        values.set(sectionCode, (values.get(sectionCode) ?? 0) + 1);
      }
    });
    return values;
  }, [balanceRows, sectionByVoicePart, state]);
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return activeRows
      .filter((row) => {
        const matchesAssignment =
          assignmentFilter === null ||
          (assignmentFilter.kind === "voicePart"
            ? row.voicePart === assignmentFilter.value
            : sectionByVoicePart.get(row.voicePart) === assignmentFilter.value);
        const matchesFilter = filter === "active" || row.rsvp === filter;
        const matchesQuery =
          !normalized ||
          `${row.displayName} ${row.voicePart}`.toLocaleLowerCase().includes(normalized);
        return matchesAssignment && matchesFilter && matchesQuery;
      })
      .sort((left, right) => {
        const byLastName = lastName(left.displayName).localeCompare(lastName(right.displayName));
        return byLastName === 0 ? left.displayName.localeCompare(right.displayName) : byLastName;
      });
  }, [activeRows, assignmentFilter, filter, query, sectionByVoicePart]);
  const filteredHistory = useMemo(() => {
    const normalized = historyQuery.trim().toLocaleLowerCase();
    return history.filter((entry) => {
      const matchesFilter = historyFilter === "All" || entry.newRsvp === historyFilter;
      const searchText = [
        entry.displayName,
        entry.previousRsvp,
        entry.newRsvp,
        entry.reason,
        entry.actorType,
        entry.automatic ? "Automation" : "Manual update",
      ]
        .join(" ")
        .toLocaleLowerCase();
      return matchesFilter && (!normalized || searchText.includes(normalized));
    });
  }, [history, historyFilter, historyQuery]);

  const selectableRows = useMemo(
    () => visibleRows.filter((row) => row.voicePart.trim() !== ""),
    [visibleRows],
  );
  const selectedProfileIdsSet = useMemo(() => new Set(selectedProfileIds), [selectedProfileIds]);
  const selectedVisibleCount = useMemo(
    () => selectableRows.filter((row) => selectedProfileIdsSet.has(row.profileId)).length,
    [selectableRows, selectedProfileIdsSet],
  );
  const selectedTargetCount = useMemo(
    () =>
      activeRows.filter(
        (row) => row.voicePart.trim() !== "" && selectedProfileIdsSet.has(row.profileId),
      ).length,
    [activeRows, selectedProfileIdsSet],
  );
  const allVisibleSelected =
    selectableRows.length > 0 && selectedVisibleCount === selectableRows.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectAllVisibleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (selectAllVisibleRef.current)
      selectAllVisibleRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  function toggleProfileSelection(profileId: string, checked: boolean) {
    setSelectedProfileIds((current) =>
      checked ? [...current, profileId] : current.filter((id) => id !== profileId),
    );
  }

  function toggleVisibleProfileSelection(profileIds: readonly string[], checked: boolean) {
    setSelectedProfileIds((current) => {
      const next = new Set(current);
      for (const profileId of profileIds) {
        if (checked) next.add(profileId);
        else next.delete(profileId);
      }
      return [...next];
    });
  }

  async function applyBulkRsvp(next: "Yes" | "No" | "Pending") {
    const targets = activeRows.filter(
      (row) => row.voicePart.trim() !== "" && selectedProfileIdsSet.has(row.profileId),
    );
    if (!eventId || targets.length === 0 || bulkBusy || savingId) return;
    const confirmed = await confirm({
      confirmLabel: `Mark ${statusText(next).toLowerCase()}`,
      description: `${String(targets.length)} Profile${targets.length === 1 ? "" : "s"} will be marked ${statusText(next)}. This overwrites their current responses, records one history entry per changed RSVP, and cannot be undone.`,
      title: "Apply bulk RSVP change?",
    });
    if (!confirmed) return;
    setBulkBusy(true);
    setFeedback(null);
    try {
      const updatedRows = await bulkRsvpMutation.mutateAsync({
        updates: targets.map(({ profileId }) => ({ profileId, rsvp: next, rsvpNote: "" })),
      });
      const previousRsvpByProfile: Readonly<Record<string, "No" | "Pending" | "Yes">> =
        Object.fromEntries(targets.map(({ profileId, rsvp }) => [profileId, rsvp]));
      const changedCount = updatedRows.filter((row) => {
        const previous = previousRsvpByProfile[row.profileId];
        return previous !== undefined && previous !== row.rsvp;
      }).length;
      setSelectedProfileIds([]);
      setFeedback(
        changedCount === 0
          ? "The selected RSVP responses were already up to date."
          : `RSVP updated for ${String(changedCount)} Profile${changedCount === 1 ? "" : "s"}.`,
      );
    } catch (bulkError: unknown) {
      setFeedback(
        bulkError instanceof AuthApiError
          ? bulkError.message
          : "The bulk RSVP change could not be applied.",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function updateRsvp(profileId: string, next: "Yes" | "No" | "Pending") {
    const current = rows.find((row) => row.profileId === profileId);
    if (!current?.voicePart.trim() || savingId) return;
    setSavingId(profileId);
    setFeedback(null);
    try {
      await setRsvpMutation.mutateAsync({ profileId, rsvp: next });
      setFeedback("RSVP updated.");
    } catch (saveError: unknown) {
      setFeedback(
        saveError instanceof AuthApiError ? saveError.message : "The RSVP could not be updated.",
      );
    } finally {
      setSavingId(null);
    }
  }

  function toggleAssignmentFilter(next: RsvpAssignmentFilter) {
    setAssignmentFilter((current) =>
      current?.kind === next.kind && current.value === next.value ? null : next,
    );
    setView("roster");
  }

  const rsvpRosterColumns: readonly DataTableColumn<OrganizationAttendanceRow>[] = [
    {
      header: "Select",
      headerContent: (
        <input
          aria-label="Select all visible Profiles"
          checked={allVisibleSelected}
          disabled={selectableRows.length === 0 || bulkBusy || savingId !== null}
          onChange={(event) => {
            toggleVisibleProfileSelection(
              selectableRows.map(({ profileId }) => profileId),
              event.target.checked,
            );
          }}
          ref={selectAllVisibleRef}
          type="checkbox"
        />
      ),
      id: "selection",
      mobileLabel: "Select",
      render: (row) => (
        <input
          aria-label={`Select ${row.displayName}`}
          checked={selectedProfileIdsSet.has(row.profileId)}
          disabled={bulkBusy || savingId !== null || row.voicePart.trim() === ""}
          onChange={(event) => {
            toggleProfileSelection(row.profileId, event.target.checked);
          }}
          type="checkbox"
        />
      ),
    },
    {
      header: "Name",
      id: "name",
      render: (row) => <strong>{row.displayName}</strong>,
      sortValue: (row) => lastName(row.displayName),
    },
    {
      header: partLabel,
      id: "performer",
      render: (row) => row.voicePart || "—",
      sortValue: (row) => row.voicePart,
    },
    {
      header: "RSVP status",
      id: "rsvpStatus",
      render: (row) => (
        <span className={`rsvp-status-badge rsvp-status-badge--${row.rsvp}`}>
          {statusText(row.rsvp)}
        </span>
      ),
      sortValue: (row) => row.rsvp,
    },
    {
      header: "Actions",
      id: "actions",
      render: (row) => {
        if (!row.voicePart.trim()) {
          return (
            <div className="rsvp-row-actions">
              <span className="rsvp-row-actions__message">Assign a part before managing RSVP.</span>
            </div>
          );
        }
        return (
          <div className="rsvp-row-actions">
            <button
              className={
                row.rsvp === "Yes" ? "button button--sm" : "button button--secondary button--sm"
              }
              disabled={savingId !== null}
              onClick={() => void updateRsvp(row.profileId, "Yes")}
              type="button"
            >
              Attending
            </button>
            <button
              className={
                row.rsvp === "No"
                  ? "button button--danger button--sm"
                  : "button button--secondary button--sm"
              }
              disabled={savingId !== null}
              onClick={() => void updateRsvp(row.profileId, "No")}
              type="button"
            >
              Declined
            </button>
            <button
              className="button button--secondary button--sm"
              disabled={savingId !== null || row.rsvp === "Pending"}
              onClick={() => void updateRsvp(row.profileId, "Pending")}
              type="button"
            >
              Reset
            </button>
          </div>
        );
      },
    },
  ];

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage RSVPs." />;
  }

  if (state.status === "loading") return <p role="status">Loading RSVP roster…</p>;
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Event and roster data could not be loaded.
      </p>
    );
  }

  return (
    <div className="rsvp-manager">
      {rowsError ? (
        <p className="notice notice--error" role="alert">
          {rowsError}
        </p>
      ) : null}
      {feedback ? (
        <p className="notice notice--success" role="status">
          {feedback}
        </p>
      ) : null}
      <RsvpManagerFilters
        assignmentFilter={assignmentFilter}
        counts={counts}
        eventId={eventId}
        events={state.events}
        filter={filter}
        onEventChange={(nextEventId) => {
          setEventId(nextEventId);
          setFeedback(null);
          setAssignmentFilter(null);
          setView("roster");
          setHistoryFilter("All");
          setHistoryQuery("");
          setSelectedProfileIds([]);
        }}
        partLabel={partLabel}
        roster={state.roster}
        sectionCounts={sectionCounts}
        selectedEvent={selectedEvent}
        setFilter={setFilter}
        setView={setView}
        toggleAssignmentFilter={toggleAssignmentFilter}
        view={view}
        voicePartCounts={voicePartCounts}
      />

      <>
        <fieldset className="surface-card rsvp-manager__roster" hidden={view !== "roster"}>
          <legend id="rsvp-roster-title">RSVP roster</legend>
          <div className="rsvp-manager__controls">
            <label className="field rsvp-manager__search">
              <span>Search active singers</span>
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder={`Name or ${partLabel.toLowerCase()}`}
                value={query}
              />
            </label>
          </div>
          <div className="rsvp-manager__table-heading">
            <span>{rowsLoading ? "Loading…" : `${String(visibleRows.length)} shown`}</span>
          </div>
          {selectedTargetCount > 0 ? (
            <div className="roster-bulk-actions" aria-label="Bulk RSVP actions" role="region">
              <div>
                <strong>{selectedTargetCount} selected</strong>
                <p>Bulk changes are applied after you confirm the action.</p>
              </div>
              <div className="roster-bulk-actions__buttons">
                <button
                  className="button button--secondary"
                  disabled={bulkBusy || savingId !== null}
                  onClick={() => {
                    void applyBulkRsvp("Yes");
                  }}
                  type="button"
                >
                  {bulkBusy ? "Updating…" : "Mark attending"}
                </button>
                <button
                  className="button button--secondary"
                  disabled={bulkBusy || savingId !== null}
                  onClick={() => {
                    void applyBulkRsvp("No");
                  }}
                  type="button"
                >
                  Mark declined
                </button>
                <button
                  className="button button--secondary"
                  disabled={bulkBusy || savingId !== null}
                  onClick={() => {
                    void applyBulkRsvp("Pending");
                  }}
                  type="button"
                >
                  Reset to no response
                </button>
                <button
                  className="text-button"
                  disabled={bulkBusy}
                  onClick={() => {
                    setSelectedProfileIds([]);
                  }}
                  type="button"
                >
                  Clear selection
                </button>
              </div>
            </div>
          ) : null}
          {visibleRows.length === 0 ? (
            <p className="empty-state">No active profiles match this RSVP filter.</p>
          ) : (
            <DataTable
              columns={rsvpRosterColumns}
              keySelector={(row) => row.profileId}
              rows={visibleRows}
            />
          )}
        </fieldset>
        <RsvpHistoryTable
          filteredHistory={filteredHistory}
          historyError={historyError}
          historyFilter={historyFilter}
          historyLoading={historyLoading}
          historyQuery={historyQuery}
          onRetry={() => {
            void historyQueryData.refetch();
          }}
          setHistoryFilter={(nextFilter) => {
            if (isHistoryFilter(nextFilter)) setHistoryFilter(nextFilter);
          }}
          setHistoryQuery={setHistoryQuery}
          totalHistoryCount={history.length}
          view={view}
        />
      </>
      {confirmationDialog}
    </div>
  );
}
