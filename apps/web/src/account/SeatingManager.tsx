import type {
  OrganizationEvent,
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationSeatingChart,
  OrganizationSeatingChartRequest,
  OrganizationVenue,
  SeatingConfiguration,
  SeatingFormation,
} from "@choir/contracts";
import { calculateSeatingSuggestions } from "@choir/domain";
import { useEffect, useState } from "react";

import {
  createOrganizationSeatingChart,
  deleteOrganizationSeatingChart,
  getOrganizationRosterConfiguration,
  getOrganizationSeatingConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationProfiles,
  listOrganizationSeatingCharts,
  listOrganizationVenues,
  updateOrganizationSeatingChart,
  updateOrganizationSeatingConfiguration,
} from "../auth/api";

interface SeatingResources {
  readonly events: readonly OrganizationEvent[];
  readonly profiles: readonly OrganizationProfile[];
  readonly roster: OrganizationRosterConfiguration;
  readonly seating: SeatingConfiguration;
  readonly venues: readonly OrganizationVenue[];
}

const emptyChart: OrganizationSeatingChartRequest = {
  assignments: {},
  formationId: "columns-standard",
  name: "Main Seating Chart",
  rowCounts: [8, 10, 12],
  sectionSuggestions: {},
  sortOrder: 0,
  venueId: null,
};

function chartRequest(chart: OrganizationSeatingChart): OrganizationSeatingChartRequest {
  return {
    assignments: chart.assignments,
    formationId: chart.formationId,
    name: chart.name,
    rowCounts: chart.rowCounts,
    sectionSuggestions: chart.sectionSuggestions,
    sortOrder: chart.sortOrder,
    venueId: chart.venueId,
  };
}

function parseRows(value: string): number[] | null {
  const rows = value.split(",").map((item) => Number(item.trim()));
  return rows.length > 0 &&
    rows.every((count) => Number.isInteger(count) && count > 0 && count <= 200)
    ? rows
    : null;
}

function FormationEditor({
  initial,
  roster,
  onSaved,
}: {
  readonly initial: SeatingConfiguration;
  readonly onSaved: (configuration: SeatingConfiguration) => void;
  readonly roster: OrganizationRosterConfiguration;
}) {
  const [configuration, setConfiguration] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function updateFormation(index: number, next: SeatingFormation): void {
    setConfiguration((current) => ({
      ...current,
      formations: current.formations.map((formation, itemIndex) =>
        itemIndex === index ? next : formation,
      ),
    }));
  }

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await updateOrganizationSeatingConfiguration(configuration);
      setConfiguration(saved);
      onSaved(saved);
      setMessage("Seating formations saved.");
    } catch (caught: unknown) {
      setMessage(
        caught instanceof Error ? caught.message : "Seating formations could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="seating-formations">
      <summary>Manage reusable formations</summary>
      <div className="form-stack">
        <label className="field">
          Default formation
          <select
            value={configuration.defaultFormationId}
            onChange={(event) => {
              setConfiguration((current) => ({
                ...current,
                defaultFormationId: event.target.value,
              }));
            }}
          >
            {configuration.formations.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {configuration.formations.map((formation, index) => (
          <fieldset className="seating-formation" key={formation.id} disabled={busy}>
            <legend>{formation.name}</legend>
            <label className="field">
              Name
              <input
                maxLength={200}
                required
                value={formation.name}
                onChange={(event) => {
                  updateFormation(index, { ...formation, name: event.target.value });
                }}
              />
            </label>
            <label className="field">
              Strategy
              <select
                value={formation.strategy}
                onChange={(event) => {
                  updateFormation(index, {
                    ...formation,
                    strategy:
                      event.target.value === "horizontal_row"
                        ? "horizontal_row"
                        : "vertical_column",
                  });
                }}
              >
                <option value="vertical_column">Vertical columns</option>
                <option value="horizontal_row">Horizontal rows</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                checked={formation.isVoicePartLayout}
                type="checkbox"
                onChange={(event) => {
                  updateFormation(index, { ...formation, isVoicePartLayout: event.target.checked });
                }}
              />
              Arrange individual voice parts
            </label>
            <label className="field">
              Order (comma separated)
              <input
                value={formation.sectionOrder.join(", ")}
                onChange={(event) => {
                  const sectionOrder = event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean);
                  updateFormation(index, { ...formation, sectionOrder });
                }}
              />
            </label>
            <button
              className="button button--secondary"
              disabled={
                configuration.formations.length === 1 ||
                configuration.defaultFormationId === formation.id
              }
              type="button"
              onClick={() => {
                setConfiguration((current) => ({
                  ...current,
                  formations: current.formations.filter(({ id }) => id !== formation.id),
                }));
              }}
            >
              Remove formation
            </button>
          </fieldset>
        ))}
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            const ids = new Set(configuration.formations.map(({ id }) => id));
            let suffix = configuration.formations.length + 1;
            while (ids.has(`formation-${String(suffix)}`)) suffix += 1;
            const sectionOrder = roster.sections
              .filter(({ trackOnly }) => !trackOnly)
              .map(({ code }) => code);
            setConfiguration((current) => ({
              ...current,
              formations: [
                ...current.formations,
                {
                  id: `formation-${String(suffix)}`,
                  isVoicePartLayout: false,
                  name: "New formation",
                  sectionOrder,
                  strategy: "vertical_column",
                },
              ],
            }));
          }}
        >
          Add formation
        </button>
        <button
          className="button button--primary"
          disabled={busy}
          type="button"
          onClick={() => {
            void save();
          }}
        >
          {busy ? "Saving formations…" : "Save formations"}
        </button>
        {message ? <p role="status">{message}</p> : null}
      </div>
    </details>
  );
}

export function SeatingManager({ enabled }: { readonly enabled: boolean }) {
  const [resources, setResources] = useState<SeatingResources | null>(null);
  const [eventId, setEventId] = useState("");
  const [charts, setCharts] = useState<readonly OrganizationSeatingChart[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [chart, setChart] = useState<OrganizationSeatingChartRequest>(emptyChart);
  const [eligibleProfiles, setEligibleProfiles] = useState<readonly OrganizationProfile[]>([]);
  const [rowsInput, setRowsInput] = useState("8, 10, 12");
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationProfiles(controller.signal),
      listOrganizationVenues(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      getOrganizationSeatingConfiguration(controller.signal),
    ])
      .then(([events, profiles, venues, roster, seating]) => {
        const performances = events.filter(({ type }) => type === "Performance");
        setResources({ events: performances, profiles, roster, seating, venues });
        const firstEvent = performances[0];
        if (firstEvent) setEventId(firstEvent.id);
        setChart((current) => ({ ...current, formationId: seating.defaultFormationId }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Seating resources could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !eventId || !resources) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationSeatingCharts(eventId, controller.signal),
      listOrganizationEventAttendance(eventId, controller.signal),
    ])
      .then(([nextCharts, attendance]) => {
        setCharts(nextCharts);
        const attending = new Set(
          attendance.filter(({ rsvp }) => rsvp === "Yes").map(({ profileId }) => profileId),
        );
        setEligibleProfiles(
          resources.profiles.filter(
            (profile) =>
              attending.has(profile.id) &&
              profile.globalStatus === "Active" &&
              profile.voicePart !== "",
          ),
        );
        const first = nextCharts[0];
        setEditingId(first?.id ?? null);
        setChart(
          first
            ? chartRequest(first)
            : { ...emptyChart, formationId: resources.seating.defaultFormationId },
        );
        setRowsInput((first?.rowCounts ?? emptyChart.rowCounts).join(", "));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Performance seating could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled, eventId, resources]);

  if (!enabled) return null;

  function selectChart(next: OrganizationSeatingChart): void {
    setEditingId(next.id);
    setChart(chartRequest(next));
    setRowsInput(next.rowCounts.join(", "));
    setDeleteConfirm(false);
    setError(null);
    setSuccess(null);
  }

  function beginNewChart(): void {
    if (!resources) return;
    const next = {
      ...emptyChart,
      formationId: resources.seating.defaultFormationId,
      sortOrder: charts.length,
    };
    setEditingId(null);
    setChart(next);
    setRowsInput(next.rowCounts.join(", "));
    setDeleteConfirm(false);
  }

  function applyRows(): void {
    const rows = parseRows(rowsInput);
    if (!rows) {
      setError("Rows must be comma-separated whole numbers from 1 through 200.");
      return;
    }
    setChart((current) => ({
      ...current,
      assignments: {},
      rowCounts: rows,
      sectionSuggestions: {},
    }));
    setError(null);
  }

  function autoSuggest(): void {
    if (!resources) return;
    const formation = resources.seating.formations.find(({ id }) => id === chart.formationId);
    if (!formation) return;
    const sectionForVoicePart = new Map(
      resources.roster.voiceParts.map(({ label, sectionCode }) => [label, sectionCode]),
    );
    const counts: Record<string, number> = {};
    for (const profile of eligibleProfiles) {
      const key = formation.isVoicePartLayout
        ? profile.voicePart
        : (sectionForVoicePart.get(profile.voicePart) ?? "");
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    setChart((current) => ({
      ...current,
      sectionSuggestions: calculateSeatingSuggestions(
        current.rowCounts,
        counts,
        formation.sectionOrder,
        formation.strategy,
      ),
    }));
  }

  async function save(): Promise<void> {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = editingId
        ? await updateOrganizationSeatingChart(eventId, editingId, chart)
        : await createOrganizationSeatingChart(eventId, chart);
      setCharts((current) =>
        editingId
          ? current.map((candidate) => (candidate.id === saved.id ? saved : candidate))
          : [...current, saved],
      );
      setEditingId(saved.id);
      setChart(chartRequest(saved));
      setSuccess("Seating chart saved.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The seating chart could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!editingId || !eventId) return;
    setBusy(true);
    try {
      await deleteOrganizationSeatingChart(eventId, editingId);
      const remaining = charts.filter(({ id }) => id !== editingId);
      setCharts(remaining);
      const first = remaining[0];
      setEditingId(first?.id ?? null);
      setChart(first ? chartRequest(first) : emptyChart);
      setRowsInput((first?.rowCounts ?? emptyChart.rowCounts).join(", "));
      setDeleteConfirm(false);
      setSuccess("Seating chart deleted.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "The seating chart could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  const assignedIds = new Set(Object.values(chart.assignments));

  return (
    <section
      className="account-section account-section--seating"
      aria-labelledby="seating-manager-title"
    >
      <p className="eyebrow">Seating</p>
      <h2 id="seating-manager-title">Performance seating</h2>
      <p className="section-description">
        Build multiple charts and assign only active, voiced Profiles attending the performance.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {!resources ? (
        <p role="status">Loading performance seating…</p>
      ) : resources.events.length === 0 ? (
        <p className="empty-state">Create a performance before building seating charts.</p>
      ) : (
        <div className="seating-layout">
          <div className="form-stack seating-sidebar">
            <label className="field">
              Performance
              <select
                aria-label="Seating performance"
                value={eventId}
                onChange={(event) => {
                  setEventId(event.target.value);
                  setError(null);
                }}
              >
                {resources.events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button--secondary" type="button" onClick={beginNewChart}>
              New chart
            </button>
            {charts.map((item) => (
              <button
                className={
                  item.id === editingId ? "button button--primary" : "button button--secondary"
                }
                key={item.id}
                type="button"
                onClick={() => {
                  selectChart(item);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
          <form
            className="form-stack seating-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="calendar-management-grid seating-settings-grid">
              <label className="field">
                Chart name
                <input
                  maxLength={200}
                  required
                  value={chart.name}
                  onChange={(event) => {
                    setChart((current) => ({ ...current, name: event.target.value }));
                  }}
                />
              </label>
              <label className="field">
                Formation
                <select
                  value={chart.formationId}
                  onChange={(event) => {
                    setChart((current) => ({
                      ...current,
                      formationId: event.target.value,
                      sectionSuggestions: {},
                    }));
                  }}
                >
                  {resources.seating.formations.map((formation) => (
                    <option key={formation.id} value={formation.id}>
                      {formation.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Venue
                <select
                  value={chart.venueId ?? ""}
                  onChange={(event) => {
                    setChart((current) => ({ ...current, venueId: event.target.value || null }));
                  }}
                >
                  <option value="">No venue</option>
                  {resources.venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Seats per row
                <input
                  aria-label="Seats per row"
                  value={rowsInput}
                  onChange={(event) => {
                    setRowsInput(event.target.value);
                  }}
                />
              </label>
              <button className="button button--secondary" type="button" onClick={applyRows}>
                Apply rows
              </button>
              <button className="button button--secondary" type="button" onClick={autoSuggest}>
                Auto-suggest sections
              </button>
            </div>
            <div className="seating-grid" aria-label="Seating chart assignments">
              {chart.rowCounts.map((count, row) => (
                <div className="seating-row" key={String(row)}>
                  <span className="seating-row-label">Row {String(row + 1)}</span>
                  {Array.from({ length: count }, (_, seat) => {
                    const key = `${String(row)}-${String(seat)}`;
                    const assigned = chart.assignments[key] ?? "";
                    return (
                      <label className="seating-seat" key={key}>
                        <span>{chart.sectionSuggestions[key] ?? `Seat ${String(seat + 1)}`}</span>
                        <select
                          aria-label={`Row ${String(row + 1)} seat ${String(seat + 1)}`}
                          value={assigned}
                          onChange={(event) => {
                            const profileId = event.target.value;
                            setChart((current) => {
                              const assignments = profileId
                                ? { ...current.assignments, [key]: profileId }
                                : Object.fromEntries(
                                    Object.entries(current.assignments).filter(
                                      ([seatKey]) => seatKey !== key,
                                    ),
                                  );
                              return { ...current, assignments };
                            });
                          }}
                        >
                          <option value="">Empty</option>
                          {eligibleProfiles
                            .filter(({ id }) => id === assigned || !assignedIds.has(id))
                            .map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.displayName} · {profile.voicePart}
                              </option>
                            ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="button button--primary" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save seating chart"}
              </button>
              {editingId ? (
                deleteConfirm ? (
                  <div
                    className="danger-confirmation"
                    role="group"
                    aria-label="Confirm seating chart deletion"
                  >
                    <button
                      className="button button--danger"
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        void remove();
                      }}
                    >
                      Confirm delete
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        setDeleteConfirm(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="button button--danger"
                    type="button"
                    onClick={() => {
                      setDeleteConfirm(true);
                    }}
                  >
                    Delete chart
                  </button>
                )
              ) : null}
            </div>
          </form>
          <FormationEditor
            initial={resources.seating}
            onSaved={(seating) => {
              setResources((current) => (current ? { ...current, seating } : current));
            }}
            roster={resources.roster}
          />
        </div>
      )}
    </section>
  );
}
