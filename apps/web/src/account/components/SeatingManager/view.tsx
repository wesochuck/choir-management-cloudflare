import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core";
import {
  addRow,
  addSeat,
  clearSeatAssignment,
  isSeatingSectionMismatch,
  moveAssignment,
} from "@choir/domain";
import { Dialog } from "@choir/ui";
import { type CSSProperties } from "react";
import { setOrganizationEventRsvp } from "../../../auth/api";
import { OrganizationMfaPrompt } from "../../OrganizationMfaPrompt";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { ConfirmDialog, FormationEditor } from "./shared";
import {
  defaultRows,
  emptyProfile,
  formatEventDate,
  groupSeatAssignmentProfiles,
  seatingProfileLabel,
  seatingRowSummary,
  statusLabel,
} from "./utils";
import { ChartList, SeatName, SeatTile, UnassignedTray } from "./chartParts";
import type { SeatingManagerModel } from "./hooks";

// eslint-disable-next-line complexity -- render composition preserves the existing seating workspace's independent tools and dialogs.
export function SeatingManagerView({ model }: { readonly model: SeatingManagerModel }) {
  const { performerLabel, performerLabelPlural } = useOrganizationTerminology();
  const {
    applyChart,
    autoSuggest,
    changeEvent,
    changeFormation,
    changeNewChartRowCount,
    changeNewChartSingerCount,
    chart,
    chartDialog,
    chartName,
    charts,
    confirmState,
    copyBusy,
    copyChartId,
    copyCharts,
    copyOpen,
    copyPerformanceId,
    copySelectedChart,
    createChart,
    currentFormation,
    deleteChart,
    dragMessage,
    draggingToken,
    editingId,
    eligibleProfiles,
    enabled,
    enterFocus,
    error,
    eventId,
    exitFocus,
    fallbackFocus,
    flushSave,
    focusMode,
    formationTab,
    handleDragEnd,
    handleDragStart,
    handleNativeDrop,
    isNarrow,
    loadCopyCharts,
    loading,
    lookupProfiles,
    lookupQuery,
    markNotAttending,
    mobileEditing,
    newChartRowCount,
    newChartSingerCount,
    openCreateChartDialog,
    profileBusy,
    profileDialog,
    profileForm,
    profileMessage,
    profilesById,
    query,
    renameChart,
    reorderCharts,
    requestRemoveRow,
    requestRemoveSeat,
    resources,
    rsvpYesCount,
    saveProfile,
    saveState,
    seatingDisplayNames,
    selectChart,
    selectedSeat,
    sensors,
    setAttendance,
    setChartDialog,
    setChartName,
    setConfirmState,
    setCopyChartId,
    setCopyCharts,
    setCopyOpen,
    setCopyPerformanceId,
    setDragMessage,
    setDraggingToken,
    setFormationTab,
    setLookupQuery,
    setMobileEditing,
    setProfileDialog,
    setProfileForm,
    setQuery,
    setResources,
    setSelectedSeat,
    setShowSeatNumbers,
    setShowVoiceParts,
    setViewMode,
    showSeatNumbers,
    showVoiceParts,
    unassignedProfiles,
    updateLayout,
    viewMode,
    workspaceRef,
  } = model;

  if (!enabled)
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage seating." />;
  if (loading && !resources) return <p role="status">Loading seating resources…</p>;
  if (error && !resources)
    return (
      <p className="notice notice--error" role="alert">
        {error}
      </p>
    );
  if (!resources) return null;
  if (resources.events.length === 0) {
    return (
      <div className="empty-state">
        <h2>Create a Performance first</h2>
        <p>Seating charts belong to active Performance events.</p>
      </div>
    );
  }

  const activeEvent = resources.events.find(({ id }) => id === eventId);
  const isEditing = !isNarrow || mobileEditing;
  const profileForSeat = (seatKey: string) => profilesById.get(chart.assignments[seatKey] ?? "");
  const draggingProfileId = draggingToken
    ? draggingToken.startsWith("profile:")
      ? draggingToken.slice("profile:".length)
      : draggingToken.startsWith("seat:")
        ? chart.assignments[draggingToken.slice("seat:".length)]
        : undefined
    : undefined;
  const draggingProfileName = draggingProfileId
    ? profilesById.get(draggingProfileId)?.displayName
    : undefined;
  const draggingProfileVoicePart = draggingProfileId
    ? profilesById.get(draggingProfileId)?.voicePart
    : undefined;
  const rows = chart.rowCounts.map((_count, index) => index).reverse();
  const totalSeats = chart.rowCounts.reduce((sum, count) => sum + count, 0);
  const assignedCount = Object.keys(chart.assignments).length;
  const eligibleCount = eligibleProfiles.length;
  const selectedSeatSuggestion = selectedSeat ? chart.sectionSuggestions[selectedSeat] : undefined;
  const assignmentGroups = selectedSeat
    ? groupSeatAssignmentProfiles(
        eligibleProfiles,
        selectedSeatSuggestion,
        currentFormation?.isVoicePartLayout ?? false,
        resources.roster,
      )
    : [];
  const createLayoutIsValid =
    newChartSingerCount > 0 && newChartRowCount > 0 && newChartRowCount <= newChartSingerCount;
  const maxNewChartRows = Math.max(1, Math.min(50, newChartSingerCount));

  return (
    <div
      className={`seating-workspace${focusMode ? " seating-workspace--focus" : ""}${fallbackFocus ? " seating-workspace--fallback-focus" : ""}`}
      ref={workspaceRef}
    >
      <p aria-live="polite" className={draggingToken ? "seating-drag-status" : "sr-only"}>
        {dragMessage}
      </p>
      <div className="seating-page-heading no-print">
        <div>
          <p className="eyebrow">Seating</p>
          <h1>Performance seating</h1>
          <p>
            {activeEvent?.title ?? "Performance"} ·{" "}
            {activeEvent ? formatEventDate(activeEvent.startsAt) : ""} · {assignedCount}/
            {totalSeats} seats assigned
          </p>
          {eligibleCount > totalSeats ? (
            <p className="notice notice--warning" role="alert">
              {String(eligibleCount - totalSeats)} eligible Profile(s) exceed this chart&apos;s
              capacity. Auto-suggestions will fill available seats only.
            </p>
          ) : null}
        </div>
        <div className="seating-page-heading__actions">
          {isNarrow && !mobileEditing ? (
            <button
              className="button button--primary"
              onClick={() => {
                setMobileEditing(true);
              }}
              type="button"
            >
              Edit anyway
            </button>
          ) : null}
          <button
            className="button button--secondary"
            onClick={() => void (focusMode ? exitFocus() : enterFocus())}
            type="button"
          >
            {focusMode ? "Exit full screen" : "Full Screen"}
          </button>
        </div>
      </div>

      <div className="seating-tabs no-print" role="tablist" aria-label="Seating tools">
        <button
          aria-controls="seating-chart-panel"
          aria-selected={formationTab === "chart"}
          className={formationTab === "chart" ? "is-active" : ""}
          id="seating-chart-tab"
          onClick={() => {
            setFormationTab("chart");
          }}
          role="tab"
          type="button"
        >
          Chart
        </button>
        <button
          aria-controls="seating-formations-panel"
          aria-selected={formationTab === "formations"}
          className={formationTab === "formations" ? "is-active" : ""}
          id="seating-formations-tab"
          onClick={() => {
            setFormationTab("formations");
          }}
          role="tab"
          type="button"
        >
          Formations
        </button>
      </div>

      {formationTab === "formations" ? (
        <div
          aria-labelledby="seating-formations-tab"
          className="seating-tab-panel"
          id="seating-formations-panel"
          role="tabpanel"
        >
          <FormationEditor
            key={JSON.stringify(resources.seating)}
            initial={resources.seating}
            onSaved={(seating) => {
              setResources((current) => (current ? { ...current, seating } : current));
            }}
            roster={resources.roster}
          />
        </div>
      ) : (
        <div
          aria-labelledby="seating-chart-tab"
          className="seating-tab-panel"
          id="seating-chart-panel"
          role="tabpanel"
        >
          <div className="seating-toolbar no-print">
            <label className="field field--compact">
              Performance
              <select
                aria-label="Seating Performance"
                onChange={(event) => void changeEvent(event.target.value)}
                value={eventId}
              >
                {resources.events.map((event) => (
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
                {resources.seating.formations.map((formation) => (
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
                    onClick={() => void reorderCharts(-1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Move chart later"
                    className="button button--secondary button--small"
                    disabled={
                      !editingId ||
                      charts.findIndex(({ id }) => id === editingId) === charts.length - 1
                    }
                    onClick={() => void reorderCharts(1)}
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
                      void deleteChart();
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
                {performerLabelPlural}
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
                        formationId: resources.seating.defaultFormationId,
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
              <span
                className={`seating-save-status seating-save-status--${saveState}`}
                role="status"
              >
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
                  onClick={() => void flushSave()}
                  type="button"
                >
                  Retry
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <p className="notice notice--error no-print" role="alert">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="notice notice--info no-print" role="status">
              Loading chart…
            </p>
          ) : null}
          {charts.length === 0 ? (
            <div className="empty-state no-print">
              <h2>Start a seating chart</h2>
              <p>Give this Performance a chart name to begin.</p>
              <button
                className="button button--primary"
                onClick={openCreateChartDialog}
                type="button"
              >
                Create chart
              </button>
            </div>
          ) : null}
          {charts.length > 0 && viewMode === "list" ? (
            <ChartList
              chart={chart}
              displayNames={seatingDisplayNames}
              mode="list"
              profilesById={profilesById}
              showSeatNumbers={showSeatNumbers}
              showVoiceParts={showVoiceParts}
            />
          ) : null}
          {charts.length > 0 && viewMode === "index" ? (
            <ChartList
              chart={chart}
              displayNames={seatingDisplayNames}
              mode="index"
              profilesById={profilesById}
              showSeatNumbers={showSeatNumbers}
              showVoiceParts={showVoiceParts}
            />
          ) : null}
          {charts.length > 0 && viewMode === "grid" ? (
            <>
              <DndContext
                collisionDetection={closestCenter}
                onDragCancel={() => {
                  setDraggingToken(null);
                  setDragMessage("Drag canceled.");
                }}
                onDragEnd={handleDragEnd}
                onDragStart={handleDragStart}
                sensors={sensors}
              >
                <div
                  className={`seating-editor-canvas${isEditing ? " seating-editor-canvas--editing" : " seating-editor-canvas--readonly"}`}
                  aria-label="Seating chart assignments"
                >
                  {isEditing ? (
                    <button
                      className="button button--secondary button--small no-print"
                      onClick={() => {
                        updateLayout(addRow({ ...chart }, "back"));
                      }}
                      type="button"
                    >
                      + Add row to back
                    </button>
                  ) : null}
                  <div className="seating-grid seating-grid--canvas">
                    {rows.map((rowIndex) => {
                      const count = chart.rowCounts[rowIndex] ?? 0;
                      const occupied = Array.from(
                        { length: count },
                        (_, seatIndex) =>
                          chart.assignments[`${String(rowIndex)}-${String(seatIndex)}`],
                      ).filter(Boolean).length;
                      return (
                        <div
                          className="seating-row seating-row--canvas"
                          key={rowIndex}
                          style={{ "--seating-seat-count": String(count) } as CSSProperties}
                        >
                          <div className="seating-row-label seating-row-label--canvas">
                            <strong>Row {rowIndex + 1}</strong>
                            <span>
                              {occupied}/{count}
                            </span>
                          </div>
                          {isEditing ? (
                            <button
                              aria-label={`Delete row ${String(rowIndex + 1)}`}
                              className="seating-row-action-btn seating-row-action-btn--delete no-print"
                              disabled={chart.rowCounts.length <= 1}
                              onClick={() => {
                                requestRemoveRow(rowIndex);
                              }}
                              type="button"
                            >
                              ×
                            </button>
                          ) : null}
                          {Array.from({ length: count }, (_, seatIndex) => {
                            const seatKey = `${String(rowIndex)}-${String(seatIndex)}`;
                            const profile = profileForSeat(seatKey);
                            const suggestion = chart.sectionSuggestions[seatKey];
                            const mismatch = currentFormation?.isVoicePartLayout
                              ? Boolean(
                                  profile &&
                                  suggestion &&
                                  profile.voicePart.toUpperCase() !== suggestion.toUpperCase(),
                                )
                              : isSeatingSectionMismatch(
                                  profile?.voicePart,
                                  suggestion,
                                  resources.roster.voiceParts,
                                );
                            return isEditing ? (
                              <SeatTile
                                assigned={profile}
                                key={seatKey}
                                label={`Seat ${String(seatIndex + 1)}`}
                                mismatch={mismatch}
                                onActivate={() => {
                                  setSelectedSeat(seatKey);
                                }}
                                onDrop={(token) => {
                                  handleNativeDrop(token, seatKey);
                                }}
                                onRemove={() => {
                                  requestRemoveSeat(rowIndex, seatIndex);
                                }}
                                seatKey={seatKey}
                                suggestion={suggestion}
                              />
                            ) : (
                              <div
                                aria-label={`Seat ${String(seatIndex + 1)}${profile ? `, assigned to ${profile.displayName}` : ", empty"}`}
                                className={`seating-seat seating-seat--canvas seating-seat--readonly${profile ? " seating-seat--assigned" : " seating-seat--empty"}${mismatch ? " seating-seat--mismatch" : ""}`}
                                key={seatKey}
                                title={profile?.displayName}
                              >
                                <span className="seating-seat__number">Seat {seatIndex + 1}</span>
                                <span className="seating-seat__suggestion">
                                  {suggestion ?? "Open"}
                                </span>
                                <SeatName displayName={profile?.displayName} />
                                {profile ? (
                                  <span className="seating-seat__voice">{profile.voicePart}</span>
                                ) : null}
                              </div>
                            );
                          })}
                          {isEditing ? (
                            <button
                              aria-label={`Add seat to row ${String(rowIndex + 1)}`}
                              className="seating-row-action-btn seating-row-action-btn--add no-print"
                              onClick={() => {
                                updateLayout(addSeat({ ...chart }, rowIndex));
                              }}
                              type="button"
                            >
                              +
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {isEditing ? (
                    <button
                      className="button button--secondary button--small no-print"
                      onClick={() => {
                        updateLayout(addRow({ ...chart }, "front"));
                      }}
                      type="button"
                    >
                      + Add row to front
                    </button>
                  ) : null}
                  <div className="seating-stage-marker">Director</div>
                </div>
                {isEditing ? (
                  <UnassignedTray
                    onAdd={() => {
                      setProfileForm(emptyProfile);
                      setProfileDialog("add");
                    }}
                    onLookup={() => {
                      setLookupQuery("");
                      setProfileDialog("lookup");
                    }}
                    onRemoveRsvp={(profile) => {
                      markNotAttending(profile);
                    }}
                    onDrop={(token) => {
                      handleNativeDrop(token);
                    }}
                    profiles={unassignedProfiles}
                    roster={resources.roster}
                    query={query}
                    setQuery={setQuery}
                  />
                ) : (
                  <button
                    className="button button--secondary no-print"
                    onClick={() => {
                      setMobileEditing(true);
                    }}
                    type="button"
                  >
                    Edit chart
                  </button>
                )}
                <DragOverlay dropAnimation={null}>
                  {draggingToken ? (
                    <div className="seating-drag-overlay">
                      <span>Moving</span>
                      <strong>
                        {draggingProfileId
                          ? seatingProfileLabel(profilesById.get(draggingProfileId) ?? emptyProfile)
                          : (draggingProfileName ??
                            (draggingToken.startsWith("profile:")
                              ? "Profile"
                              : "Assigned Profile"))}
                      </strong>
                      {draggingProfileId ? (
                        <small>
                          {draggingProfileVoicePart?.trim()
                            ? `${performerLabel}: ${draggingProfileVoicePart}`
                            : `No ${performerLabel.toLowerCase()}`}
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        onClose={() => {
          setConfirmState(null);
        }}
        state={confirmState}
      />

      <Dialog
        description={
          chartDialog === "rename"
            ? "Use a short name that identifies this seating arrangement."
            : "Name the chart and set the singers and rows for its initial layout."
        }
        onClose={() => {
          setChartDialog(null);
        }}
        open={chartDialog !== null}
        title={chartDialog === "rename" ? "Rename seating chart" : "New seating chart"}
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (chartDialog === "rename") renameChart();
            else void createChart();
          }}
        >
          <label className="field">
            Chart name
            <input
              autoFocus
              maxLength={200}
              onChange={(event) => {
                setChartName(event.target.value);
              }}
              required
              value={chartName}
            />
          </label>
          {chartDialog === "create" ? (
            <>
              <div className="form-grid seating-chart-create-fields">
                <label className="field">
                  Singers to place
                  <input
                    aria-describedby="seating-chart-rsvp-help"
                    max={4_000}
                    min={0}
                    onChange={(event) => {
                      changeNewChartSingerCount(event.target.valueAsNumber);
                    }}
                    type="number"
                    value={newChartSingerCount}
                  />
                </label>
                <label className="field">
                  Rows
                  <input
                    max={maxNewChartRows}
                    min={1}
                    onChange={(event) => {
                      changeNewChartRowCount(event.target.valueAsNumber);
                    }}
                    type="number"
                    value={newChartRowCount}
                  />
                </label>
              </div>
              <p className="field-help" id="seating-chart-rsvp-help">
                {rsvpYesCount === 0
                  ? "No singers have RSVP’d Yes yet. You can still set the number to place."
                  : `${String(rsvpYesCount)} singer${rsvpYesCount === 1 ? " has" : "s have"} RSVP’d Yes for this Performance; this is the default.`}
              </p>
              <p aria-live="polite" className="seating-chart-layout-preview" role="status">
                {seatingRowSummary(newChartSingerCount, newChartRowCount)}
              </p>
            </>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setChartDialog(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={chartDialog === "create" && !createLayoutIsValid}
              type="submit"
            >
              {chartDialog === "rename" ? "Save name" : "Create chart"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description="Copy layout and eligible assignments from another Performance using the same Venue."
        onClose={() => {
          setCopyOpen(false);
        }}
        open={copyOpen}
        title="Copy seating chart"
      >
        <div className="form-stack">
          <label className="field">
            Source Performance
            <select
              onChange={(event) => void loadCopyCharts(event.target.value)}
              value={copyPerformanceId}
            >
              <option value="">Choose a Performance</option>
              {resources.events
                .filter(({ id }) => id !== eventId)
                .map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Source chart
            <select
              disabled={copyBusy || !copyPerformanceId}
              onChange={(event) => {
                setCopyChartId(event.target.value);
              }}
              value={copyChartId}
            >
              <option value="">Choose a chart</option>
              {copyCharts.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {copyBusy ? <p role="status">Loading source charts…</p> : null}
          {!copyBusy && copyPerformanceId && copyCharts.length === 0 ? (
            <p className="empty-state">No charts use this Venue.</p>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setCopyOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={!copyChartId}
              onClick={copySelectedChart}
              type="button"
            >
              Copy chart
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        description="Add an eligible Profile to this Performance."
        onClose={() => {
          setProfileDialog(null);
        }}
        open={profileDialog === "add"}
        title="Add Profile"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfile();
          }}
        >
          {profileMessage ? (
            <p className="notice notice--error" role="alert">
              {profileMessage}
            </p>
          ) : null}
          <label className="field">
            Display name
            <input
              autoFocus
              maxLength={200}
              onChange={(event) => {
                setProfileForm((current) => ({ ...current, displayName: event.target.value }));
              }}
              required
              value={profileForm.displayName}
            />
          </label>
          <label className="field">
            {performerLabel}
            <select
              onChange={(event) => {
                setProfileForm((current) => ({ ...current, voicePart: event.target.value }));
              }}
              required
              value={profileForm.voicePart}
            >
              <option value="">Choose {performerLabel.toLowerCase()}</option>
              {resources.roster.voiceParts.map(({ fullName, label }) => (
                <option key={label} value={label}>
                  {fullName} ({label})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Status
            <select
              onChange={(event) => {
                setProfileForm((current) => ({
                  ...current,
                  globalStatus:
                    event.target.value === "Idle" || event.target.value === "Inactive"
                      ? event.target.value
                      : "Active",
                }));
              }}
              value={profileForm.globalStatus}
            >
              <option value="Active">Active</option>
              <option value="Idle">On Break</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setProfileDialog(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={profileBusy} type="submit">
              {profileBusy ? "Adding…" : "Add and mark attending"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description="Choose an existing Organization Profile to mark attending for this Performance."
        onClose={() => {
          setProfileDialog(null);
        }}
        open={profileDialog === "lookup"}
        title="Profile lookup"
      >
        <div className="form-stack">
          <label className="field">
            Search Profiles
            <input
              autoFocus
              onChange={(event) => {
                setLookupQuery(event.target.value);
              }}
              placeholder={`Name or ${performerLabel.toLowerCase()}`}
              type="search"
              value={lookupQuery}
            />
          </label>
          <div className="seating-lookup-list">
            {lookupProfiles
              .filter((profile) => {
                const normalized = lookupQuery.trim().toLocaleLowerCase();
                return (
                  !normalized ||
                  `${profile.displayName} ${profile.voicePart}`
                    .toLocaleLowerCase()
                    .includes(normalized)
                );
              })
              .map((profile) => (
                <button
                  className="seating-lookup-row"
                  key={profile.id}
                  onClick={() => {
                    void setOrganizationEventRsvp(eventId, profile.id, "Yes").then(() => {
                      setAttendance((current) => [
                        ...current.filter(({ profileId }) => profileId !== profile.id),
                        { profileId: profile.id, rsvp: "Yes" },
                      ]);
                      setProfileDialog(null);
                    });
                  }}
                  type="button"
                >
                  <strong>{profile.displayName}</strong>
                  <span>{profile.voicePart || `No ${performerLabel.toLowerCase()}`}</span>
                  <em>{statusLabel(profile.globalStatus)}</em>
                </button>
              ))}
          </div>
        </div>
      </Dialog>

      <Dialog
        description="Assign an eligible Profile, unassign the current Profile, or delete an empty seat."
        onClose={() => {
          setSelectedSeat(null);
        }}
        open={selectedSeat !== null}
        title={selectedSeat ? `Seat ${String(Number(selectedSeat.split("-")[1]) + 1)}` : "Seat"}
      >
        {selectedSeat ? (
          <div className="form-stack">
            <p>
              {chart.assignments[selectedSeat]
                ? `Assigned to ${profilesById.get(chart.assignments[selectedSeat])?.displayName ?? "Profile"}.`
                : "This seat is empty."}
            </p>
            {selectedSeatSuggestion ? (
              <p className="seating-assignment-picker__hint">
                Candidates matching {selectedSeatSuggestion} are shown first, followed by the other
                sections in roster order. Names are sorted by surname.
              </p>
            ) : null}
            <div className="seating-assignment-picker">
              {assignmentGroups.map((group) => (
                <section className="seating-assignment-group" key={group.key}>
                  <h3 className="seating-assignment-group__heading">{group.label}</h3>
                  {group.profiles.map((profile) => (
                    <button
                      className="seating-lookup-row"
                      key={profile.id}
                      onClick={() => {
                        applyChart({
                          ...chart,
                          assignments: moveAssignment(
                            chart.assignments,
                            "",
                            selectedSeat,
                            profile.id,
                          ),
                        });
                        setSelectedSeat(null);
                      }}
                      type="button"
                    >
                      <strong>{profile.displayName}</strong>
                      <span>{profile.voicePart || `No ${performerLabel.toLowerCase()}`}</span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
            <div className="form-actions">
              <button
                className="button button--secondary"
                onClick={() => {
                  setSelectedSeat(null);
                }}
                type="button"
              >
                Cancel
              </button>
              {chart.assignments[selectedSeat] ? (
                <button
                  className="button button--secondary"
                  onClick={() => {
                    const [rowText, seatText] = selectedSeat.split("-");
                    const nextLayout = clearSeatAssignment(
                      {
                        assignments: chart.assignments,
                        rowCounts: chart.rowCounts,
                        sectionSuggestions: chart.sectionSuggestions,
                      },
                      Number(rowText),
                      Number(seatText),
                    );
                    applyChart({ ...chart, assignments: nextLayout.assignments });
                    setSelectedSeat(null);
                  }}
                  type="button"
                >
                  Unassign
                </button>
              ) : null}
              {(() => {
                const [rowText, seatText] = selectedSeat.split("-");
                const rowIndex = Number(rowText);
                const seatIndex = Number(seatText);
                return !chart.assignments[selectedSeat] && (chart.rowCounts[rowIndex] ?? 0) > 1 ? (
                  <button
                    className="button button--danger"
                    onClick={() => {
                      setSelectedSeat(null);
                      requestRemoveSeat(rowIndex, seatIndex);
                    }}
                    type="button"
                  >
                    Delete seat
                  </button>
                ) : null;
              })()}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
