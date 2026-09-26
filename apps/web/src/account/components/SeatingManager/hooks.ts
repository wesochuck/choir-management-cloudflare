import { useEffect, useRef, useState } from "react";
import { useSeatingResources } from "./hooks/useSeatingResources";
import { useSeatingCharts } from "./hooks/useSeatingCharts";
import { useSeatingDerived } from "./hooks/useSeatingDerived";
import { useSeatingPersistence } from "./hooks/useSeatingPersistence";
import { useSeatingDragDrop } from "./hooks/useSeatingDragDrop";
import { useSeatingMutations } from "./hooks/useSeatingMutations";
import type { ViewMode } from "./types";

function useIsNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 48rem)");
    const u = () => {
      setNarrow(m.matches);
    };
    u();
    m.addEventListener("change", u);
    return () => {
      m.removeEventListener("change", u);
    };
  }, []);
  return narrow;
}

export function useSeatingManagerController({ enabled }: { readonly enabled: boolean }) {
  const isNarrow = useIsNarrowScreen();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showSeatNumbers, setShowSeatNumbers] = useState(true);
  const [showVoiceParts, setShowVoiceParts] = useState(true);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [fallbackFocus, setFallbackFocus] = useState(false);
  const [formationTab, setFormationTab] = useState<"chart" | "formations">("chart");
  const [query, setQuery] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);

  const res = useSeatingResources({ enabled });
  const ch = useSeatingCharts({
    enabled,
    eventId: res.eventId,
    resourcesRef: res.resourcesRef,
    setError: res.setError,
    setLoading: res.setLoading,
    updateUrl: res.updateUrl,
  });
  const derived = useSeatingDerived({
    attendance: ch.attendance,
    chart: ch.chart,
    resources: res.resources,
  });
  const persist = useSeatingPersistence({
    chart: ch.chart,
    chartRef: ch.chartRef,
    editingIdRef: ch.editingIdRef,
    eventIdRef: res.eventIdRef,
    setChart: ch.setChart,
    setCharts: ch.setCharts,
    setError: res.setError,
  });
  const dnd = useSeatingDragDrop({
    applyChart: persist.applyChart,
    chart: ch.chart,
    profilesById: derived.profilesById,
  });
  const mut = useSeatingMutations({
    applyChart: persist.applyChart,
    chart: ch.chart,
    chartRef: ch.chartRef,
    charts: ch.charts,
    currentFormation: derived.currentFormation,
    editingId: ch.editingId,
    editingIdRef: ch.editingIdRef,
    eligibleProfiles: derived.eligibleProfiles,
    eventId: res.eventId,
    flushSave: persist.flushSave,
    profilesById: derived.profilesById,
    resources: res.resources,
    rsvpYesCount: derived.rsvpYesCount,
    setAttendance: ch.setAttendance,
    setChart: ch.setChart,
    setCharts: ch.setCharts,
    setEditingId: ch.setEditingId,
    setError: res.setError,
    setEventId: res.setEventId,
    setLoading: res.setLoading,
    setResources: res.setResources,
    setSaveState: persist.setSaveState,
    updateUrl: res.updateUrl,
  });

  async function enterFocus(): Promise<void> {
    if (!workspaceRef.current) return;
    try {
      await workspaceRef.current.requestFullscreen();
      setFocusMode(true);
    } catch {
      setFallbackFocus(true);
      setFocusMode(true);
    }
  }
  async function exitFocus(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    setFocusMode(false);
    setFallbackFocus(false);
  }
  useEffect(() => {
    const onFs = () => {
      setFocusMode(Boolean(document.fullscreenElement));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fallbackFocus) void exitFocus();
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("keydown", onKey);
    };
  }, [fallbackFocus]);
  useEffect(() => {
    if (!fallbackFocus) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fallbackFocus]);

  return {
    applyChart: persist.applyChart,
    autoSuggest: mut.autoSuggest,
    changeEvent: mut.changeEvent,
    changeFormation: mut.changeFormation,
    chart: ch.chart,
    chartDialog: mut.chartDialog,
    chartName: mut.chartName,
    charts: ch.charts,
    confirmState: mut.confirmState,
    copyBusy: mut.copyBusy,
    copyChartId: mut.copyChartId,
    copyCharts: mut.copyCharts,
    copyOpen: mut.copyOpen,
    copyPerformanceId: mut.copyPerformanceId,
    copySelectedChart: mut.copySelectedChart,
    createChart: mut.createChart,
    currentFormation: derived.currentFormation,
    deleteChart: mut.deleteChart,
    dragMessage: dnd.dragMessage,
    draggingToken: dnd.draggingToken,
    editingId: ch.editingId,
    eligibleProfiles: derived.eligibleProfiles,
    enabled,
    enterFocus,
    error: res.error,
    eventId: res.eventId,
    exitFocus,
    fallbackFocus,
    flushSave: persist.flushSave,
    focusMode,
    formationTab,
    handleDragEnd: dnd.handleDragEnd,
    handleDragStart: dnd.handleDragStart,
    handleNativeDrop: dnd.handleNativeDrop,
    isNarrow,
    loadCopyCharts: mut.loadCopyCharts,
    loading: res.loading,
    lookupProfiles: derived.lookupProfiles,
    lookupQuery: mut.lookupQuery,
    markNotAttending: mut.markNotAttending,
    mobileEditing,
    newChartRowCount: mut.newChartRowCount,
    newChartSingerCount: mut.newChartSingerCount,
    openCreateChartDialog: mut.openCreateChartDialog,
    profileBusy: mut.profileBusy,
    profileDialog: mut.profileDialog,
    profileForm: mut.profileForm,
    profileMessage: mut.profileMessage,
    profilesById: derived.profilesById,
    query,
    renameChart: mut.renameChart,
    reorderCharts: mut.reorderCharts,
    requestRemoveRow: mut.requestRemoveRow,
    requestRemoveSeat: mut.requestRemoveSeat,
    resources: res.resources,
    rsvpYesCount: derived.rsvpYesCount,
    saveProfile: mut.saveProfile,
    saveState: persist.saveState,
    seatingDisplayNames: derived.seatingDisplayNames,
    selectChart: mut.selectChart,
    selectedSeat,
    sensors: dnd.sensors,
    setAttendance: ch.setAttendance,
    setChartDialog: mut.setChartDialog,
    setChartName: mut.setChartName,
    changeNewChartRowCount: mut.changeNewChartRowCount,
    changeNewChartSingerCount: mut.changeNewChartSingerCount,
    setConfirmState: mut.setConfirmState,
    setCopyChartId: mut.setCopyChartId,
    setCopyCharts: mut.setCopyCharts,
    setCopyOpen: mut.setCopyOpen,
    setCopyPerformanceId: mut.setCopyPerformanceId,
    setDragMessage: dnd.setDragMessage,
    setDraggingToken: dnd.setDraggingToken,
    setFormationTab,
    setLookupQuery: mut.setLookupQuery,
    setMobileEditing,
    setProfileDialog: mut.setProfileDialog,
    setProfileForm: mut.setProfileForm,
    setQuery,
    setResources: res.setResources,
    setSelectedSeat,
    setShowSeatNumbers,
    setShowVoiceParts,
    setViewMode,
    showSeatNumbers,
    showVoiceParts,
    unassignedProfiles: derived.unassignedProfiles,
    updateLayout: mut.updateLayout,
    viewMode,
    workspaceRef,
  };
}

export type SeatingManagerModel = ReturnType<typeof useSeatingManagerController>;
