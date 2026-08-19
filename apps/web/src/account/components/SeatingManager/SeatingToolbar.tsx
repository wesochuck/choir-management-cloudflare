import type {
  OrganizationEvent,
  OrganizationSeatingChart,
  OrganizationSeatingChartRequest,
  SeatingFormation,
} from "@choir/contracts";
import type { ConfirmState, SaveState, ViewMode } from "./types";
import { defaultRows } from "./utils";

export interface SeatingToolbarProps {
  readonly applyChart: (chart: OrganizationSeatingChartRequest) => void;
  readonly autoSuggest: () => void;
  readonly changeEvent: (eventId: string) => void;
  readonly changeFormation: (formationId: string) => void;
  readonly chart: OrganizationSeatingChartRequest;
  readonly charts: readonly OrganizationSeatingChart[];
  readonly defaultFormationId: string;
  readonly deleteChart: () => void;
  readonly editingId: string | null;
  readonly eventId: string;
  readonly events: readonly OrganizationEvent[];
  readonly flushSave: () => void;
  readonly formations: readonly SeatingFormation[];
  readonly openCreateChartDialog: () => void;
  readonly partLabelPlural: string;
  readonly reorderCharts: (delta: -1 | 1) => void;
  readonly saveState: SaveState;
  readonly selectChart: (chartId: string) => void;
  readonly setChartDialog: (dialog: "create" | "rename" | null) => void;
  readonly setChartName: (name: string) => void;
  readonly setConfirmState: (state: ConfirmState | null) => void;
  readonly setCopyCharts: (charts: readonly OrganizationSeatingChart[]) => void;
  readonly setCopyOpen: (open: boolean) => void;
  readonly setCopyPerformanceId: (id: string) => void;
  readonly setShowSeatNumbers: (show: boolean) => void;
  readonly setShowVoiceParts: (show: boolean) => void;
  readonly setViewMode: (mode: ViewMode) => void;
  readonly showSeatNumbers: boolean;
  readonly showVoiceParts: boolean;
  readonly viewMode: ViewMode;
}

export function SeatingToolbar({
  applyChart,
  autoSuggest,
  changeEvent,
  changeFormation,
  chart,
  charts,
  defaultFormationId,
  deleteChart,
  editingId,
  eventId,
  events,
  flushSave,
  formations,
  openCreateChartDialog,
  partLabelPlural,
  reorderCharts,
  saveState,
  selectChart,
  setChartDialog,
  setChartName,
  setConfirmState,
  setCopyCharts,
  setCopyOpen,
  setCopyPerformanceId,
  setShowSeatNumbers,
  setShowVoiceParts,
  setViewMode,
  showSeatNumbers,
  showVoiceParts,
  viewMode,
}: SeatingToolbarProps) {
  return (
    <>
      <div className="seating-toolbar no-print">
        <label className="field field--compact">
          Performance
          <select
            aria-label="Seating Performance"
            onChange={(event) => {
              changeEvent(event.target.value);
            }}
            value={eventId}
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--compact">
          Formation
          <select
            aria-label="Seating formation"
            onChange={(event) => {
              changeFormation(event.target.value);
            }}
            value={chart.formationId}
          >
            {formations.map((formation) => (
              <option key={formation.id} value={formation.id}>
                {formation.name}
              </option>
            ))}
          </select>
        </label>
        <div className="seating-chart-control field--compact">
          <span>Chart</span>
          <div className="seating-chart-control__row">
            <select
              aria-label="Select seating chart"
              onChange={(event) => {
                selectChart(event.target.value);
              }}
              value={editingId ?? ""}
            >
              {charts.map((candidate, index) => (
                <option key={candidate.id} value={candidate.id}>
                  {index + 1}. {candidate.name}
                </option>
              ))}
            </select>
            <div className="seating-chart-order-actions">
              <button
                aria-label="Move chart earlier"
                className="button button--secondary button--small"
                disabled={!editingId || charts.findIndex(({ id }) => id === editingId) <= 0}
                onClick={() => {
                  reorderCharts(-1);
                }}
                type="button"
              >
                ↑
              </button>
              <button
                aria-label="Move chart later"
                className="button button--secondary button--small"
                disabled={
                  !editingId || charts.findIndex(({ id }) => id === editingId) === charts.length - 1
                }
                onClick={() => {
                  reorderCharts(1);
                }}
                type="button"
              >
                ↓
              </button>
            </div>
          </div>
        </div>
        <div className="seating-toolbar__actions seating-toolbar__actions--chart">
          <button
            className="button button--secondary button--small"
            onClick={openCreateChartDialog}
            type="button"
          >
            New
          </button>
          <button
            className="button button--secondary button--small"
            disabled={!editingId}
            onClick={() => {
              setChartName(chart.name);
              setChartDialog("rename");
            }}
            type="button"
          >
            Rename
          </button>
          <button
            className="button button--danger button--small"
            disabled={!editingId || charts.length <= 1}
            onClick={() => {
              setConfirmState({
                title: "Delete seating chart?",
                message: `Delete “${chart.name}”?`,
                confirmLabel: "Delete chart",
                onConfirm: () => {
                  deleteChart();
                  setConfirmState(null);
                },
              });
            }}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="seating-toolbar seating-toolbar--secondary no-print">
        <div className="seating-toolbar__actions seating-toolbar__display-options">
          <label className="checkbox-row checkbox-row--compact">
            <input
              checked={showSeatNumbers}
              disabled={viewMode !== "list"}
              onChange={(event) => {
                setShowSeatNumbers(event.target.checked);
              }}
              title="Available in List view"
              type="checkbox"
            />{" "}
            Seat numbers
          </label>
          <label className="checkbox-row checkbox-row--compact">
            <input
              checked={showVoiceParts}
              disabled={viewMode !== "list"}
              onChange={(event) => {
                setShowVoiceParts(event.target.checked);
              }}
              title="Available in List view"
              type="checkbox"
            />{" "}
            {partLabelPlural}
          </label>
        </div>
        <div className="seating-toolbar__actions seating-toolbar__primary-actions">
          <button
            className="button button--secondary button--small"
            onClick={() => {
              setConfirmState({
                title: "Clear assignments?",
                message: "Return every assigned Profile to the unassigned tray?",
                confirmLabel: "Clear assignments",
                onConfirm: () => {
                  applyChart({ ...chart, assignments: {} });
                  setConfirmState(null);
                },
              });
            }}
            type="button"
          >
            Clear
          </button>
          <button
            className="button button--danger button--small"
            onClick={() => {
              setConfirmState({
                title: "Reset seating chart?",
                message: "Reset assignments, rows, and formation to the Organization defaults?",
                confirmLabel: "Reset chart",
                onConfirm: () => {
                  applyChart({
                    ...chart,
                    assignments: {},
                    formationId: defaultFormationId,
                    rowCounts: defaultRows,
                    sectionSuggestions: {},
                  });
                  setConfirmState(null);
                },
              });
            }}
            type="button"
          >
            Reset
          </button>
          <button
            className="button button--secondary button--small"
            onClick={autoSuggest}
            type="button"
          >
            Auto-suggest sections
          </button>
          <button
            className="button button--secondary button--small"
            onClick={() => {
              setCopyOpen(true);
              setCopyPerformanceId("");
              setCopyCharts([]);
            }}
            type="button"
          >
            Copy
          </button>
          <button
            className="button button--secondary button--small"
            onClick={() => {
              window.print();
            }}
            type="button"
          >
            Print
          </button>
        </div>
        <div className="seating-toolbar__actions seating-toolbar__view-actions">
          <button
            aria-pressed={viewMode === "grid"}
            className={`button button--small ${viewMode === "grid" ? "button--primary" : "button--secondary"}`}
            onClick={() => {
              setViewMode("grid");
            }}
            type="button"
          >
            Grid
          </button>
          <button
            aria-pressed={viewMode === "list"}
            className={`button button--small ${viewMode === "list" ? "button--primary" : "button--secondary"}`}
            onClick={() => {
              setViewMode("list");
            }}
            type="button"
          >
            List
          </button>
          <button
            aria-label="Last name index"
            aria-pressed={viewMode === "index"}
            className={`button button--small ${viewMode === "index" ? "button--primary" : "button--secondary"}`}
            onClick={() => {
              setViewMode("index");
            }}
            title="Last name index"
            type="button"
          >
            Index
          </button>
          <span className={`seating-save-status seating-save-status--${saveState}`} role="status">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "error"
                ? "Couldn’t save — Retry"
                : saveState === "saved"
                  ? "Saved"
                  : "Ready"}
          </span>
          {saveState === "error" ? (
            <button
              className="button button--secondary button--small"
              onClick={flushSave}
              type="button"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
