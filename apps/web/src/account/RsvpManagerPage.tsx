import type {
  OrganizationAttendanceRow,
  OrganizationEvent,
  OrganizationEventRsvpHistoryEntry,
  OrganizationProfile,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { DataTable, useConfirmation, type DataTableColumn } from "@choir/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AuthApiError,
  bulkUpdateOrganizationEventRsvp,
  getOrganizationEventRsvpHistory,
  getOrganizationRosterConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationProfiles,
  setOrganizationEventRsvp,
} from "../auth/api";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type RsvpState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly events: readonly OrganizationEvent[];
      readonly profiles: readonly OrganizationProfile[];
      readonly roster: OrganizationRosterConfiguration;
      readonly status: "ready";
    };

type RsvpFilter = "active" | "Yes" | "No" | "Pending";
type RsvpView = "roster" | "history";
type HistoryFilter = "All" | "Yes" | "No" | "Pending";
type RsvpAssignmentFilter =
  | { readonly kind: "section"; readonly value: string }
  | { readonly kind: "voicePart"; readonly value: string };

function isHistoryFilter(value: string): value is HistoryFilter {
  return value === "All" || value === "Yes" || value === "No" || value === "Pending";
}

function displayEventDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function lastName(value: string): string {
  const parts = value.trim().split(/\s+/);
  return parts.length > 1 ? (parts.at(-1) ?? value) : value;
}

function nearestUpcomingPerformance(events: readonly OrganizationEvent[]): string {
  const now = Date.now();
  return (
    [...events]
      .filter((event) => event.type === "Performance" && new Date(event.startsAt).getTime() >= now)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0]?.id ?? ""
  );
}

function statusText(status: "Yes" | "No" | "Pending"): string {
  if (status === "Yes") return "Attending";
  if (status === "No") return "Declined";
  return "No response";
}

function historySource(entry: OrganizationEventRsvpHistoryEntry): string {
  return entry.automatic ? "Automation" : "Manual update";
}

function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function historyStatusBadge(status: "Yes" | "No" | "Pending") {
  return (
    <span className={`rsvp-status-badge rsvp-status-badge--${status}`}>{statusText(status)}</span>
  );
}

const rsvpHistoryColumns: readonly DataTableColumn<OrganizationEventRsvpHistoryEntry>[] = [
  {
    header: "Performer",
    id: "profile",
    render: (entry) => <strong>{entry.displayName}</strong>,
    sortValue: (entry) => lastName(entry.displayName),
  },
  {
    header: "Previous RSVP",
    id: "previousRsvp",
    render: (entry) => historyStatusBadge(entry.previousRsvp),
    sortValue: (entry) => entry.previousRsvp,
  },
  {
    header: "New RSVP",
    id: "newRsvp",
    render: (entry) => historyStatusBadge(entry.newRsvp),
    sortValue: (entry) => entry.newRsvp,
  },
  {
    header: "Reason",
    id: "reason",
    render: (entry) => entry.reason,
    sortValue: (entry) => entry.reason,
  },
  {
    header: "Source",
    id: "source",
    render: (entry) => historySource(entry),
    sortValue: (entry) => historySource(entry),
  },
  {
    header: "Changed",
    id: "occurredAt",
    render: (entry) => formatHistoryDate(entry.occurredAt),
    sortValue: (entry) => entry.occurredAt,
  },
];

function reportableSections(roster: OrganizationRosterConfiguration) {
  return roster.sections.filter(({ trackOnly }) => !trackOnly);
}

function reportableVoiceParts(roster: OrganizationRosterConfiguration) {
  const trackOnlySections = new Set(
    roster.sections.filter(({ trackOnly }) => trackOnly).map(({ code }) => code),
  );
  return roster.voiceParts.filter(({ sectionCode }) => !trackOnlySections.has(sectionCode));
}

function RsvpDeadlineNotice({ event }: { readonly event: OrganizationEvent | null }) {
  if (event?.type !== "Performance" || !event.rsvpDeadlineDate) return null;
  return (
    <p
      className={`rsvp-manager__deadline-notice ${
        event.rsvpDeadlinePassed ? "notice notice--warning" : "notice notice--info"
      }`}
    >
      {event.rsvpDeadlinePassed
        ? `Member self-service RSVP is closed. The deadline was ${event.rsvpDeadlineDate}. Administrators can still override responses.`
        : `Member RSVP deadline: ${event.rsvpDeadlineDate} through 11:59 p.m.`}
    </p>
  );
}

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
  const [state, setState] = useState<RsvpState>({ status: "loading" });
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
  const [history, setHistory] = useState<readonly OrganizationEventRsvpHistoryEntry[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationProfiles(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
    ])
      .then(([events, profiles, roster]) => {
        setState({ events, profiles, roster, status: "ready" });
        setEventId((current) => {
          if (current && events.some((event) => event.id === current)) return current;
          if (initialEventId && events.some((event) => event.id === initialEventId)) {
            return initialEventId;
          }
          return nearestUpcomingPerformance(events);
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
  }, [enabled, initialEventId]);

  useEffect(() => {
    if (!enabled || state.status !== "ready" || !eventId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mark the selected roster as loading before the request starts.
    setRowsLoading(true);
    setRowsError(null);
    setHistory([]);
    Promise.all([
      listOrganizationEventAttendance(eventId, controller.signal),
      getOrganizationEventRsvpHistory(eventId, controller.signal),
    ])
      .then(([loaded, loadedHistory]) => {
        if (!controller.signal.aborted) {
          setRows(loaded);
          setHistory(loadedHistory.entries);
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setRows([]);
          setRowsError(
            loadError instanceof AuthApiError
              ? loadError.message
              : "The RSVP roster could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRowsLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [enabled, eventId, state.status]);

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
  const counts = useMemo(
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
  const sectionCounts = useMemo(() => {
    const values = new Map<string, number>();
    if (state.status !== "ready") return values;
    reportableSections(state.roster).forEach(({ code }) => values.set(code, 0));
    balanceRows.forEach((row) => {
      const voicePart = state.roster.voiceParts.find(({ label }) => label === row.voicePart);
      if (voicePart && values.has(voicePart.sectionCode)) {
        values.set(voicePart.sectionCode, (values.get(voicePart.sectionCode) ?? 0) + 1);
      }
    });
    return values;
  }, [balanceRows, state]);
  const sectionByVoicePart = useMemo(() => {
    if (state.status !== "ready") return new Map<string, string>();
    return new Map(state.roster.voiceParts.map(({ label, sectionCode }) => [label, sectionCode]));
  }, [state]);
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
        historySource(entry),
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
    setRowsError(null);
    try {
      const updatedRows = await bulkUpdateOrganizationEventRsvp(
        eventId,
        targets.map(({ profileId }) => ({ profileId, rsvp: next, rsvpNote: "" })),
      );
      const previousRsvpByProfile: Readonly<Record<string, "No" | "Pending" | "Yes">> =
        Object.fromEntries(targets.map(({ profileId, rsvp }) => [profileId, rsvp]));
      const changedCount = updatedRows.filter((row) => {
        const previous = previousRsvpByProfile[row.profileId];
        return previous !== undefined && previous !== row.rsvp;
      }).length;
      setRows(updatedRows);
      setSelectedProfileIds([]);
      setFeedback(
        changedCount === 0
          ? "The selected RSVP responses were already up to date."
          : `RSVP updated for ${String(changedCount)} Profile${changedCount === 1 ? "" : "s"}.`,
      );
      try {
        setHistory((await getOrganizationEventRsvpHistory(eventId)).entries);
      } catch {
        setRowsError("RSVP updated, but the event history could not be refreshed.");
      }
    } catch (bulkError: unknown) {
      setRowsError(
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
    setRows((existing) =>
      existing.map((row) => (row.profileId === profileId ? { ...row, rsvp: next } : row)),
    );
    try {
      await setOrganizationEventRsvp(eventId, profileId, next);
      setFeedback("RSVP updated.");
      try {
        setHistory((await getOrganizationEventRsvpHistory(eventId)).entries);
      } catch {
        setRowsError("RSVP updated, but the event history could not be refreshed.");
      }
    } catch (saveError: unknown) {
      setRows((existing) => existing.map((row) => (row.profileId === profileId ? current : row)));
      setRowsError(
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
      <section
        className="surface-card roster-balance rsvp-manager__balance"
        aria-labelledby="rsvp-balance-title"
      >
        <div className="roster-balance__header">
          <div>
            <h2 id="rsvp-balance-title">{partLabel} RSVP balance</h2>
            <p className="field-help">
              Select a section or {partLabel.toLowerCase()} to filter the roster below.
            </p>
            <div className="rsvp-manager__performance-row">
              <label className="field rsvp-manager__performance">
                <span>Performance</span>
                <select
                  onChange={(event) => {
                    setEventId(event.target.value);
                    setRows([]);
                    setFeedback(null);
                    setAssignmentFilter(null);
                    setView("roster");
                    setHistoryFilter("All");
                    setHistoryQuery("");
                    setSelectedProfileIds([]);
                  }}
                  value={eventId}
                >
                  <option value="">Choose performance</option>
                  {state.events
                    .filter((event) => event.type === "Performance")
                    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
                    .map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title} · {displayEventDate(event.startsAt)}
                      </option>
                    ))}
                </select>
              </label>
              <RsvpDeadlineNotice event={selectedEvent} />
            </div>
          </div>
          <div className="rsvp-manager__summary-actions">
            <span className="status-pill">Total: {counts.active} active</span>
            {eventId ? (
              <a
                className="button button--secondary button--sm"
                href={`/api/organization/events/${encodeURIComponent(eventId)}/rsvp-export.csv?sort=lastName`}
              >
                Export CSV
              </a>
            ) : null}
          </div>
        </div>
        <div className="rsvp-status-filters" role="tablist" aria-label="RSVP views">
          {(
            [
              ["active", `All active (${String(counts.active)})`],
              ["Yes", `Attending (${String(counts.attending)})`],
              ["No", `Declined (${String(counts.declined)})`],
              ["Pending", `No response (${String(counts.pending)})`],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-selected={view === "roster" && filter === value}
              className={view === "roster" && filter === value ? "is-active" : undefined}
              key={value}
              onClick={() => {
                setFilter(value);
                setView("roster");
              }}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
          <button
            aria-selected={view === "history"}
            className={view === "history" ? "is-active" : undefined}
            onClick={() => {
              setView("history");
            }}
            role="tab"
            type="button"
          >
            History
          </button>
        </div>
        <div className="roster-balance__sections">
          {reportableSections(state.roster).map((section) => {
            const selected =
              assignmentFilter?.kind === "section" && assignmentFilter.value === section.code;
            return (
              <button
                aria-pressed={selected}
                className={`roster-balance__section${selected ? " roster-balance__section--selected" : ""}`}
                key={section.code}
                onClick={() => {
                  toggleAssignmentFilter({ kind: "section", value: section.code });
                }}
                type="button"
              >
                <span>{section.name}</span>
                <strong>{sectionCounts.get(section.code) ?? 0}</strong>
              </button>
            );
          })}
        </div>
        <div className="roster-balance__parts">
          {reportableVoiceParts(state.roster).map((voicePart) => {
            const selected =
              assignmentFilter?.kind === "voicePart" && assignmentFilter.value === voicePart.label;
            return (
              <button
                aria-pressed={selected}
                className={`roster-balance__part${selected ? " roster-balance__part--selected" : ""}`}
                key={voicePart.label}
                onClick={() => {
                  toggleAssignmentFilter({ kind: "voicePart", value: voicePart.label });
                }}
                type="button"
              >
                <span>{voicePart.label}</span>
                <strong>{voicePartCounts.get(voicePart.label) ?? 0}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <>
        <section
          className="surface-card rsvp-manager__roster"
          aria-labelledby="rsvp-roster-title"
          hidden={view !== "roster"}
        >
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
            <h2 id="rsvp-roster-title">RSVP roster</h2>
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
        </section>
        <section
          className="surface-card rsvp-manager__history"
          aria-labelledby="rsvp-history-title"
          hidden={view !== "history"}
        >
          <div className="section-heading section-heading--compact">
            <p className="eyebrow">Audit trail</p>
            <h2 id="rsvp-history-title">Event RSVP History</h2>
            <p className="section-description">
              Actual RSVP changes are shown here separately from Profile Status History.
            </p>
          </div>
          <div className="rsvp-manager__controls rsvp-manager__history-controls">
            <label className="field">
              <span>Search history</span>
              <input
                onChange={(event) => {
                  setHistoryQuery(event.target.value);
                }}
                placeholder="Name, reason, or source"
                type="search"
                value={historyQuery}
              />
            </label>
            <label className="field">
              <span>Filter new RSVP</span>
              <select
                onChange={(event) => {
                  const nextFilter = event.target.value;
                  if (isHistoryFilter(nextFilter)) setHistoryFilter(nextFilter);
                }}
                value={historyFilter}
              >
                <option value="All">All statuses</option>
                <option value="Yes">Attending</option>
                <option value="No">Declined</option>
                <option value="Pending">No response</option>
              </select>
            </label>
          </div>
          <div className="rsvp-manager__table-heading">
            <span aria-live="polite">{`${String(filteredHistory.length)} shown`}</span>
          </div>
          <DataTable
            columns={rsvpHistoryColumns}
            emptyMessage={
              history.length === 0
                ? "No RSVP changes recorded for this event yet."
                : "No history entries match these filters."
            }
            initialSort={{ columnId: "occurredAt", direction: "desc" }}
            keySelector={(entry) =>
              `${entry.occurredAt}-${entry.profileId}-${entry.previousRsvp}-${entry.newRsvp}-${entry.reason}`
            }
            rows={filteredHistory}
          />
        </section>
      </>
      {confirmationDialog}
    </div>
  );
}
