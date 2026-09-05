import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { ChartList } from "./chartParts";
import { SeatingCanvasView } from "./SeatingCanvasView";
import { SeatingDialogs } from "./SeatingDialogs";
import { SeatingToolbar } from "./SeatingToolbar";
import type { SeatingManagerModel } from "./hooks";

function ChartStatusNotice({
  error,
  hasActiveDialog,
  loading,
}: {
  readonly error: string | null;
  readonly hasActiveDialog: boolean;
  readonly loading: boolean;
}) {
  if (error && !hasActiveDialog) {
    return (
      <p className="notice notice--error no-print" role="alert">
        {error}
      </p>
    );
  }
  if (loading) {
    return (
      <p className="notice notice--info no-print" role="status">
        Loading chart…
      </p>
    );
  }
  return null;
}

export function SeatingChartPanel({ model }: { readonly model: SeatingManagerModel }) {
  const { partLabel, partLabelPlural } = useOrganizationTerminology();
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
    editingId,
    eligibleProfiles,
    error,
    eventId,
    flushSave,
    loadCopyCharts,
    loading,
    lookupProfiles,
    lookupQuery,
    newChartRowCount,
    newChartSingerCount,
    openCreateChartDialog,
    profileBusy,
    profileDialog,
    profileForm,
    profileMessage,
    profilesById,
    renameChart,
    reorderCharts,
    requestRemoveSeat,
    resources,
    rsvpYesCount,
    saveProfile,
    saveState,
    seatingDisplayNames,
    selectChart,
    selectedSeat,
    setAttendance,
    setChartDialog,
    setChartName,
    setConfirmState,
    setCopyChartId,
    setCopyCharts,
    setCopyOpen,
    setCopyPerformanceId,
    setLookupQuery,
    setProfileDialog,
    setProfileForm,
    setSelectedSeat,
    setShowSeatNumbers,
    setShowVoiceParts,
    setViewMode,
    showSeatNumbers,
    showVoiceParts,
    viewMode,
  } = model;

  if (!resources) return null;

  const hasActiveDialog =
    chartDialog !== null ||
    copyOpen ||
    profileDialog !== null ||
    selectedSeat !== null ||
    confirmState !== null;
  const hasNoCharts = charts.length === 0;
  const isListView = charts.length > 0 && (viewMode === "list" || viewMode === "index");
  const isGridView = charts.length > 0 && viewMode === "grid";

  return (
    <div className="seating-chart-content">
      <SeatingToolbar
        applyChart={applyChart}
        autoSuggest={autoSuggest}
        changeEvent={(id) => {
          void changeEvent(id);
        }}
        changeFormation={changeFormation}
        chart={chart}
        charts={charts}
        defaultFormationId={resources.seating.defaultFormationId}
        deleteChart={() => {
          void deleteChart();
        }}
        editingId={editingId}
        eventId={eventId}
        events={resources.events}
        flushSave={() => {
          void flushSave();
        }}
        formations={resources.seating.formations}
        openCreateChartDialog={openCreateChartDialog}
        partLabelPlural={partLabelPlural}
        reorderCharts={(delta) => {
          void reorderCharts(delta);
        }}
        saveState={saveState}
        selectChart={selectChart}
        setChartDialog={setChartDialog}
        setChartName={setChartName}
        setConfirmState={setConfirmState}
        setCopyCharts={setCopyCharts}
        setCopyOpen={setCopyOpen}
        setCopyPerformanceId={setCopyPerformanceId}
        setShowSeatNumbers={setShowSeatNumbers}
        setShowVoiceParts={setShowVoiceParts}
        setViewMode={setViewMode}
        showSeatNumbers={showSeatNumbers}
        showVoiceParts={showVoiceParts}
        viewMode={viewMode}
      />

      <ChartStatusNotice error={error} hasActiveDialog={hasActiveDialog} loading={loading} />

      {hasNoCharts ? (
        <div className="empty-state no-print">
          <h2>Start a seating chart</h2>
          <p>Give this Performance a chart name to begin.</p>
          <button className="button button--primary" onClick={openCreateChartDialog} type="button">
            Create chart
          </button>
        </div>
      ) : null}
      {isListView ? (
        <ChartList
          chart={chart}
          displayNames={seatingDisplayNames}
          mode={viewMode === "index" ? "index" : "list"}
          profilesById={profilesById}
          showSeatNumbers={showSeatNumbers}
          showVoiceParts={showVoiceParts}
        />
      ) : null}
      {isGridView ? <SeatingCanvasView model={model} /> : null}

      <SeatingDialogs
        applyChart={applyChart}
        changeNewChartRowCount={changeNewChartRowCount}
        changeNewChartSingerCount={changeNewChartSingerCount}
        chart={chart}
        chartDialog={chartDialog}
        chartName={chartName}
        confirmState={confirmState}
        copyBusy={copyBusy}
        copyChartId={copyChartId}
        copyCharts={copyCharts}
        copyOpen={copyOpen}
        copyPerformanceId={copyPerformanceId}
        copySelectedChart={copySelectedChart}
        createChart={() => {
          void createChart();
        }}
        eligibleProfiles={eligibleProfiles}
        eventId={eventId}
        events={resources.events}
        isVoicePartLayout={currentFormation?.isVoicePartLayout ?? false}
        loadCopyCharts={(id) => {
          void loadCopyCharts(id);
        }}
        lookupProfiles={lookupProfiles}
        lookupQuery={lookupQuery}
        newChartRowCount={newChartRowCount}
        newChartSingerCount={newChartSingerCount}
        partLabel={partLabel}
        profileBusy={profileBusy}
        profileDialog={profileDialog}
        profileForm={profileForm}
        profileMessage={profileMessage}
        profilesById={profilesById}
        renameChart={renameChart}
        requestRemoveSeat={requestRemoveSeat}
        roster={resources.roster}
        rsvpYesCount={rsvpYesCount}
        saveProfile={() => {
          void saveProfile();
        }}
        selectedSeat={selectedSeat}
        setAttendance={setAttendance}
        setChartDialog={setChartDialog}
        setChartName={setChartName}
        setConfirmState={setConfirmState}
        setCopyChartId={setCopyChartId}
        setCopyOpen={setCopyOpen}
        setLookupQuery={setLookupQuery}
        setProfileDialog={setProfileDialog}
        setProfileForm={setProfileForm}
        setSelectedSeat={setSelectedSeat}
      />
    </div>
  );
}
