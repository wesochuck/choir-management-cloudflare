import type {
  OrganizationAttendanceRow,
  OrganizationEvent,
  OrganizationEventRsvpHistoryEntry,
  OrganizationProfile,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  AuthApiError,
  getOrganizationEventRsvpHistory,
  getOrganizationRosterConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationProfiles,
  setOrganizationEventRsvp,
} from "../auth/api";

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
    <p className={event.rsvpDeadlinePassed ? "notice notice--warning" : "notice notice--info"}>
      {event.rsvpDeadlinePassed
        ? `Member self-service RSVP is closed. The deadline was ${event.rsvpDeadlineDate}. Administrators can still override responses.`
        : `Member RSVP deadline: ${event.rsvpDeadlineDate} through 11:59 p.m.`}
      <a href="/admin/settings"> Roster Settings</a>
    </p>
  );
}

export function RsvpManagerPage({
  enabled,
  eventId: initialEventId = null,
}: {
  readonly enabled: boolean;
  readonly eventId?: string | null;
}) {
  const [eventId, setEventId] = useState(initialEventId ?? "");
  const [state, setState] = useState<RsvpState>({ status: "loading" });
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
  const [history, setHistory] = useState<readonly OrganizationEventRsvpHistoryEntry[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RsvpFilter>("active");
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return activeRows
      .filter((row) => {
        const matchesFilter = filter === "active" || row.rsvp === filter;
        const matchesQuery =
          !normalized ||
          `${row.displayName} ${row.voicePart}`.toLocaleLowerCase().includes(normalized);
        return matchesFilter && matchesQuery;
      })
      .sort((left, right) => {
        const byLastName = lastName(left.displayName).localeCompare(lastName(right.displayName));
        return byLastName === 0 ? left.displayName.localeCompare(right.displayName) : byLastName;
      });
  }, [activeRows, filter, query]);

  async function updateRsvp(profileId: string, next: "Yes" | "No" | "Pending") {
    const current = rows.find((row) => row.profileId === profileId);
    if (!current || savingId) return;
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

  if (!enabled) {
    return <p className="notice notice--warning">Verify Organization MFA to manage RSVPs.</p>;
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
            <p className="eyebrow">Event response</p>
            <h2 id="rsvp-balance-title">Voice part RSVP balance</h2>
            <p className="field-help">
              {selectedEvent
                ? `${selectedEvent.title} · ${displayEventDate(selectedEvent.startsAt)}`
                : "Choose an event to view responses."}
            </p>
            <RsvpDeadlineNotice event={selectedEvent} />
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
        <div className="rsvp-status-filters" role="tablist" aria-label="RSVP filters">
          {(
            [
              ["active", `All active (${String(counts.active)})`],
              ["Yes", `Attending (${String(counts.attending)})`],
              ["No", `Declined (${String(counts.declined)})`],
              ["Pending", `No response (${String(counts.pending)})`],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-selected={filter === value}
              className={filter === value ? "is-active" : undefined}
              key={value}
              onClick={() => {
                setFilter(value);
              }}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="roster-balance__sections">
          {reportableSections(state.roster).map((section) => (
            <div className="roster-balance__section" key={section.code}>
              <span>{section.name}</span>
              <strong>{sectionCounts.get(section.code) ?? 0}</strong>
            </div>
          ))}
        </div>
        <div className="roster-balance__parts">
          {reportableVoiceParts(state.roster).map((voicePart) => (
            <div className="roster-balance__part" key={voicePart.label}>
              <span>{voicePart.label}</span>
              <strong>{voicePartCounts.get(voicePart.label) ?? 0}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-card rsvp-manager__roster" aria-labelledby="rsvp-roster-title">
        <div className="rsvp-manager__controls">
          <label className="field">
            <span>Performance</span>
            <select
              onChange={(event) => {
                setEventId(event.target.value);
                setRows([]);
                setFeedback(null);
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
          <label className="field rsvp-manager__search">
            <span>Search active singers</span>
            <input
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Name or voice part"
              value={query}
            />
          </label>
        </div>
        <div className="rsvp-manager__table-heading">
          <h2 id="rsvp-roster-title">RSVP roster</h2>
          <span>{rowsLoading ? "Loading…" : `${String(visibleRows.length)} shown`}</span>
        </div>
        {visibleRows.length === 0 ? (
          <p className="empty-state">No active profiles match this RSVP filter.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table rsvp-manager__table table--actions">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Voice</th>
                  <th>RSVP status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.profileId}>
                    <td>
                      <strong>{row.displayName}</strong>
                    </td>
                    <td>{row.voicePart || "—"}</td>
                    <td>
                      <span className={`rsvp-status-badge rsvp-status-badge--${row.rsvp}`}>
                        {statusText(row.rsvp)}
                      </span>
                    </td>
                    <td>
                      <div className="rsvp-row-actions">
                        <button
                          className={
                            row.rsvp === "Yes"
                              ? "button button--sm"
                              : "button button--secondary button--sm"
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface-card rsvp-manager__history" aria-labelledby="rsvp-history-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Audit trail</p>
          <h2 id="rsvp-history-title">Event RSVP History</h2>
          <p className="section-description">
            Actual RSVP changes are shown here separately from Profile Status History.
          </p>
        </div>
        {history.length === 0 ? (
          <p className="empty-state">No RSVP changes recorded for this event yet.</p>
        ) : (
          <ol className="compact-list">
            {history.slice(0, 20).map((entry) => (
              <li key={`${entry.occurredAt}-${entry.profileId}-${entry.newRsvp}`}>
                <strong>{entry.displayName}</strong>: {statusText(entry.previousRsvp)} →{" "}
                {statusText(entry.newRsvp)} · {entry.reason} ·{" "}
                {entry.automatic ? "Automation" : "Administrator or member"} ·{" "}
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(entry.occurredAt))}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
