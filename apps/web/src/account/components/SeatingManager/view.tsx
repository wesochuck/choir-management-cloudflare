import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core";
import { addRow, addSeat, isSeatingSectionMismatch, moveAssignment } from "@choir/domain";
import { Dialog } from "@choir/ui";
import { type CSSProperties } from "react";
import { setOrganizationEventRsvp } from "../../../auth/api";
import { ConfirmDialog, FormationEditor } from "./shared";
import { defaultRows, emptyProfile, formatEventDate, statusLabel } from "./utils";
import { SeatTile, UnassignedTray, ChartList } from "./chartParts";
import type { SeatingManagerModel } from "./hooks";

// eslint-disable-next-line complexity -- render composition preserves the existing seating workspace's independent tools and dialogs.
export function SeatingManagerView({ model }: { readonly model: SeatingManagerModel }) {
  const {
    applyChart,
    autoSuggest,
    changeEvent,
    changeFormation,
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
    return <p className="notice notice--warning">Verify Organization MFA to manage seating.</p>;
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
          aria-selected={formationTab === "chart"}
          className={formationTab === "chart" ? "is-active" : ""}
          onClick={() => {
            setFormationTab("chart");
          }}
          role="tab"
          type="button"
        >
          Chart
        </button>
        <button
          aria-selected={formationTab === "formations"}
          className={formationTab === "formations" ? "is-active" : ""}
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
        <FormationEditor
          key={JSON.stringify(resources.seating)}
          initial={resources.seating}
          onSaved={(seating) => {
            setResources((current) => (current ? { ...current, seating } : current));
          }}
          roster={resources.roster}
        />
      ) : (
        <>
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
                onClick={() => {
                  setChartName("");
                  setChartDialog("create");
                }}
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
            <div className="seating-toolbar__actions">
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
            <div className="seating-toolbar__actions">
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
              {viewMode === "list" ? (
                <>
                  <label className="checkbox-row checkbox-row--compact">
                    <input
                      checked={showSeatNumbers}
                      onChange={(event) => {
                        setShowSeatNumbers(event.target.checked);
                      }}
                      type="checkbox"
                    />{" "}
                    Seat numbers
                  </label>
                  <label className="checkbox-row checkbox-row--compact">
                    <input
                      checked={showVoiceParts}
                      onChange={(event) => {
                        setShowVoiceParts(event.target.checked);
                      }}
                      type="checkbox"
                    />{" "}
                    Voice parts
                  </label>
                </>
              ) : null}
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
                onClick={() => {
                  setChartName("Main Seating Chart");
                  setChartDialog("create");
                }}
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
                                className={`seating-seat seating-seat--canvas seating-seat--readonly${mismatch ? " seating-seat--mismatch" : ""}`}
                                key={seatKey}
                              >
                                <span className="seating-seat__number">Seat {seatIndex + 1}</span>
                                <span className="seating-seat__suggestion">
                                  {suggestion ?? "Open"}
                                </span>
                                <strong>{profile?.displayName ?? "Empty"}</strong>
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
                        {draggingProfileName ??
                          (draggingToken.startsWith("profile:") ? "Profile" : "Assigned Profile")}
                      </strong>
                      {draggingProfileId ? (
                        <small>
                          {draggingProfileVoicePart?.trim()
                            ? draggingProfileVoicePart
                            : "No voice part"}
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          ) : null}
        </>
      )}

      <ConfirmDialog
        onClose={() => {
          setConfirmState(null);
        }}
        state={confirmState}
      />

      <Dialog
        description="Use a short name that identifies this seating arrangement."
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
            <button className="button button--primary" type="submit">
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
            Voice part
            <select
              onChange={(event) => {
                setProfileForm((current) => ({ ...current, voicePart: event.target.value }));
              }}
              required
              value={profileForm.voicePart}
            >
              <option value="">Choose voice part</option>
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
              placeholder="Name or voice part"
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
                  <span>{profile.voicePart || "No voice part"}</span>
                  <em>{statusLabel(profile.globalStatus)}</em>
                </button>
              ))}
          </div>
        </div>
      </Dialog>

      <Dialog
        description="Assign an eligible Profile, unassign the current Profile, or remove this seat."
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
            <div className="seating-assignment-picker">
              {eligibleProfiles.map((profile) => (
                <button
                  className="seating-lookup-row"
                  key={profile.id}
                  onClick={() => {
                    applyChart({
                      ...chart,
                      assignments: moveAssignment(chart.assignments, "", selectedSeat, profile.id),
                    });
                    setSelectedSeat(null);
                  }}
                  type="button"
                >
                  <strong>{profile.displayName}</strong>
                  <span>{profile.voicePart}</span>
                </button>
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
                    applyChart({
                      ...chart,
                      assignments: Object.fromEntries(
                        Object.entries(chart.assignments).filter(([key]) => key !== selectedSeat),
                      ),
                    });
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
                return (chart.rowCounts[rowIndex] ?? 0) > 1 ? (
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
