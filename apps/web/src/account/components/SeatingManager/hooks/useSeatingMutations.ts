import { useState } from "react";
import type {
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationSeatingChart,
  OrganizationSeatingChartRequest,
  SeatingFormation,
} from "@choir/contracts";
import {
  calculateSeatingSuggestions,
  clearSeatAssignment,
  removeRow,
  removeSeat,
  unassignProfile,
} from "@choir/domain";
import type { addRow } from "@choir/domain";
import {
  AuthApiError,
  createOrganizationProfile,
  createOrganizationSeatingChart,
  deleteOrganizationSeatingChart,
  listOrganizationSeatingCharts,
  reorderOrganizationSeatingCharts,
  setOrganizationEventRsvp,
} from "../../../../auth/api";
import type { ConfirmState, SaveState, SeatingResources } from "../types";
import {
  chartRequest,
  defaultSeatingRowCount,
  distributeSeatsAcrossRows,
  emptyChart,
  emptyProfile,
} from "../utils";

interface Args {
  readonly applyChart: (next: OrganizationSeatingChartRequest) => void;
  readonly chart: OrganizationSeatingChartRequest;
  readonly chartRef: React.RefObject<OrganizationSeatingChartRequest | null>;
  readonly charts: readonly OrganizationSeatingChart[];
  readonly currentFormation: SeatingFormation | null;
  readonly editingId: string | null;
  readonly editingIdRef: React.RefObject<string | null>;
  readonly eligibleProfiles: readonly OrganizationProfile[];
  readonly eventId: string;
  readonly flushSave: () => Promise<boolean>;
  readonly profilesById: ReadonlyMap<string, OrganizationProfile>;
  readonly resources: SeatingResources | null;
  readonly rsvpYesCount: number;
  readonly setAttendance: React.Dispatch<
    React.SetStateAction<
      readonly { readonly profileId: string; readonly rsvp: "No" | "Pending" | "Yes" }[]
    >
  >;
  readonly setChart: React.Dispatch<React.SetStateAction<OrganizationSeatingChartRequest>>;
  readonly setCharts: React.Dispatch<React.SetStateAction<readonly OrganizationSeatingChart[]>>;
  readonly setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setError: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setEventId: React.Dispatch<React.SetStateAction<string>>;
  readonly setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setResources: React.Dispatch<React.SetStateAction<SeatingResources | null>>;
  readonly setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
  readonly updateUrl: (nextEventId: string, nextChartId: string | null) => void;
}

export function useSeatingMutations({
  applyChart,
  chart,
  chartRef,
  charts,
  currentFormation,
  editingId,
  editingIdRef,
  eligibleProfiles,
  eventId,
  flushSave,
  profilesById,
  resources,
  rsvpYesCount,
  setAttendance,
  setChart,
  setCharts,
  setEditingId,
  setError,
  setEventId,
  setLoading,
  setResources,
  setSaveState,
  updateUrl,
}: Args) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [chartDialog, setChartDialog] = useState<"create" | "rename" | null>(null);
  const [chartName, setChartName] = useState("");
  const [newChartSingerCount, setNewChartSingerCount] = useState(0);
  const [newChartRowCount, setNewChartRowCount] = useState(1);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyPerformanceId, setCopyPerformanceId] = useState("");
  const [copyCharts, setCopyCharts] = useState<readonly OrganizationSeatingChart[]>([]);
  const [copyChartId, setCopyChartId] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [profileDialog, setProfileDialog] = useState<"add" | "lookup" | null>(null);
  const [profileForm, setProfileForm] = useState<OrganizationProfileRequest>(emptyProfile);
  const [lookupQuery, setLookupQuery] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  function updateLayout(nextLayout: ReturnType<typeof addRow>): void {
    applyChart({
      ...chart,
      assignments: nextLayout.assignments,
      rowCounts: nextLayout.rowCounts,
      sectionSuggestions: nextLayout.sectionSuggestions,
    });
  }
  function requestRemoveSeat(rowIndex: number, seatIndex: number): void {
    const key = `${String(rowIndex)}-${String(seatIndex)}`;
    const assignedProfileId = chart.assignments[key];
    const occupant = assignedProfileId ? profilesById.get(assignedProfileId) : undefined;
    if (assignedProfileId) {
      setConfirmState({
        title: "Clear seat assignment?",
        message: occupant
          ? `Clear ${occupant.displayName} from this seat and return them to Unassigned Profiles?`
          : "Clear the assigned Profile from this seat without deleting the seat?",
        confirmLabel: "Clear assignment",
        onConfirm: () => {
          updateLayout(clearSeatAssignment({ ...chart }, rowIndex, seatIndex));
          setConfirmState(null);
        },
      });
      return;
    }
    setConfirmState({
      title: "Delete empty seat?",
      message: "Delete this empty seat from the row?",
      confirmLabel: "Delete seat",
      onConfirm: () => {
        updateLayout(removeSeat({ ...chart }, rowIndex, seatIndex));
        setConfirmState(null);
      },
    });
  }
  function requestRemoveRow(rowIndex: number): void {
    const occupied = Object.keys(chart.assignments).filter((key) =>
      key.startsWith(`${String(rowIndex)}-`),
    ).length;
    setConfirmState({
      title: "Delete row?",
      message:
        occupied > 0
          ? `This row has ${String(occupied)} assigned Profile(s). Deleting it will return them to the tray.`
          : "Delete this row?",
      confirmLabel: "Delete row",
      onConfirm: () => {
        updateLayout(removeRow({ ...chart }, rowIndex));
        setConfirmState(null);
      },
    });
  }
  function autoSuggest(): void {
    if (!resources || !currentFormation) return;
    const sectionForVoicePart = new Map(
      resources.roster.voiceParts.map(({ label, sectionCode }) => [label, sectionCode]),
    );
    const counts: Record<string, number> = {};
    eligibleProfiles.forEach((profile) => {
      const key = currentFormation.isVoicePartLayout
        ? profile.voicePart
        : (sectionForVoicePart.get(profile.voicePart) ?? "");
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    });
    applyChart({
      ...chart,
      sectionSuggestions: calculateSeatingSuggestions(
        chart.rowCounts,
        counts,
        currentFormation.sectionOrder,
        currentFormation.strategy,
      ),
    });
  }
  function changeFormation(formationId: string): void {
    if (formationId === chart.formationId) return;
    const nextFormation = resources?.seating.formations.find(({ id }) => id === formationId);
    if (!nextFormation) return;
    if (Object.keys(chart.assignments).length > 0) {
      setConfirmState({
        title: "Change formation?",
        message:
          "Changing the formation clears current assignments so the new section order can be applied.",
        confirmLabel: "Change formation",
        onConfirm: () => {
          applyChart({ ...chart, formationId, assignments: {}, sectionSuggestions: {} });
          setConfirmState(null);
        },
      });
      return;
    }
    applyChart({ ...chart, formationId, sectionSuggestions: {} });
  }
  async function loadCopyCharts(nextPerformanceId: string): Promise<void> {
    setCopyPerformanceId(nextPerformanceId);
    setCopyChartId("");
    setCopyBusy(true);
    try {
      const loaded = await listOrganizationSeatingCharts(nextPerformanceId);
      setCopyCharts(loaded.filter(({ venueId }) => venueId === chart.venueId));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Source charts could not be loaded.");
    } finally {
      setCopyBusy(false);
    }
  }
  function copySelectedChart(): void {
    const source = copyCharts.find(({ id }) => id === copyChartId);
    if (!source) return;
    const eligibleIds = new Set(eligibleProfiles.map(({ id }) => id));
    const assignments = Object.fromEntries(
      Object.entries(source.assignments).filter(([, profileId]) => eligibleIds.has(profileId)),
    );
    const skipped = Object.keys(source.assignments).length - Object.keys(assignments).length;
    setConfirmState({
      title: "Copy seating chart?",
      message: `Copy layout and assignments from “${source.name}”?${skipped > 0 ? ` ${String(skipped)} ineligible assignment(s) will remain unassigned.` : ""}`,
      confirmLabel: "Copy chart",
      onConfirm: () => {
        applyChart({
          ...chart,
          assignments,
          formationId: source.formationId,
          rowCounts: source.rowCounts,
          sectionSuggestions: source.sectionSuggestions,
        });
        setCopyOpen(false);
        setConfirmState(null);
      },
    });
  }
  async function saveProfile(): Promise<void> {
    if (!profileForm.displayName.trim() || !profileForm.voicePart.trim()) return;
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      const created = await createOrganizationProfile(profileForm);
      await setOrganizationEventRsvp(eventId, created.id, "Yes");
      setResources((c) => (c ? { ...c, profiles: [...c.profiles, created] } : c));
      setAttendance((c) => [...c, { profileId: created.id, rsvp: "Yes" }]);
      setProfileForm(emptyProfile);
      setProfileDialog(null);
      setProfileMessage("Profile added and marked attending.");
    } catch (caught: unknown) {
      setProfileMessage(
        caught instanceof AuthApiError ? caught.message : "The Profile could not be added.",
      );
    } finally {
      setProfileBusy(false);
    }
  }
  function markNotAttending(profile: OrganizationProfile): void {
    const assignedSeat = Object.entries(chart.assignments).find(
      ([, pid]) => pid === profile.id,
    )?.[0];
    setConfirmState({
      title: "Mark Profile not attending?",
      message: assignedSeat
        ? `${profile.displayName} will be unassigned and marked not attending.`
        : `Mark ${profile.displayName} not attending for this Performance?`,
      confirmLabel: "Mark not attending",
      onConfirm: async () => {
        await setOrganizationEventRsvp(eventId, profile.id, "No");
        const assignments = unassignProfile(chart.assignments, profile.id);
        applyChart({ ...chart, assignments });
        setAttendance((c) =>
          c.map((row) => (row.profileId === profile.id ? { ...row, rsvp: "No" } : row)),
        );
        setConfirmState(null);
      },
    });
  }
  async function changeEvent(nextEventId: string): Promise<void> {
    if (nextEventId === eventId) return;
    setLoading(true);
    const flushed = await flushSave();
    if (!flushed) {
      setLoading(false);
      setConfirmState({
        title: "Unsaved seating changes",
        message:
          "The current chart could not be saved. Stay here and retry before changing Performance.",
        confirmLabel: "Retry",
        onConfirm: async () => {
          if (await flushSave()) setConfirmState(null);
        },
      });
      return;
    }
    setEventId(nextEventId);
    updateUrl(nextEventId, null);
  }
  function openCreateChartDialog(): void {
    setError(null);
    setChartName("Main Seating Chart");
    setNewChartSingerCount(rsvpYesCount);
    setNewChartRowCount(defaultSeatingRowCount(rsvpYesCount));
    setChartDialog("create");
  }
  function changeNewChartSingerCount(nextValue: number): void {
    const nextCount = Number.isFinite(nextValue)
      ? Math.max(0, Math.min(4_000, Math.trunc(nextValue)))
      : 0;
    setNewChartSingerCount(nextCount);
    setNewChartRowCount((c) => (nextCount > 0 ? Math.min(c, nextCount, 50) : 1));
  }
  function changeNewChartRowCount(nextValue: number): void {
    const maxRows = Math.max(1, Math.min(50, newChartSingerCount));
    const nextCount = Number.isFinite(nextValue) ? Math.trunc(nextValue) : 1;
    setNewChartRowCount(Math.max(1, Math.min(maxRows, nextCount)));
  }
  async function createChart(): Promise<void> {
    if (!eventId || !resources) return;
    const rowCounts = distributeSeatsAcrossRows(newChartSingerCount, newChartRowCount);
    if (rowCounts.length === 0) {
      setError(
        newChartSingerCount < 1
          ? "At least one singer is required to create a seating layout."
          : "Choose no more rows than singers before creating the chart.",
      );
      return;
    }
    setSaveState("saving");
    try {
      const created = await createOrganizationSeatingChart(eventId, {
        ...chart,
        assignments: {},
        name: chartName.trim() || "Main Seating Chart",
        formationId: chart.formationId || resources.seating.defaultFormationId,
        rowCounts,
        sectionSuggestions: {},
        sortOrder: charts.length,
      });
      setCharts((c) => [...c, created].toSorted((l, r) => l.sortOrder - r.sortOrder));
      setEditingId(created.id);
      editingIdRef.current = created.id;
      const next = chartRequest(created);
      setChart(next);
      chartRef.current = next;
      setChartDialog(null);
      updateUrl(eventId, created.id);
      setSaveState("saved");
    } catch (caught: unknown) {
      setSaveState("error");
      setError(
        caught instanceof Error ? caught.message : "The seating chart could not be created.",
      );
    }
  }
  function renameChart(): void {
    if (!editingId || !chartName.trim()) return;
    const next = { ...chart, name: chartName.trim() };
    applyChart(next);
    setChartDialog(null);
  }
  async function deleteChart(): Promise<void> {
    if (!editingId || !eventId || charts.length <= 1) return;
    try {
      if (!(await flushSave())) return;
      await deleteOrganizationSeatingChart(eventId, editingId);
      const remaining = charts.filter(({ id }) => id !== editingId);
      setCharts(remaining);
      const next = remaining[0];
      const nextId = next?.id ?? null;
      setEditingId(nextId);
      editingIdRef.current = nextId;
      const nextChart = next ? chartRequest(next) : { ...emptyChart };
      setChart(nextChart);
      chartRef.current = nextChart;
      updateUrl(eventId, nextId);
      setSaveState("saved");
    } catch (caught: unknown) {
      setSaveState("error");
      setError(
        caught instanceof Error ? caught.message : "The seating chart could not be deleted.",
      );
    }
  }
  async function reorderCharts(direction: -1 | 1): Promise<void> {
    if (!editingId || !eventId) return;
    const index = charts.findIndex(({ id }) => id === editingId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= charts.length) return;
    const ordered = [...charts];
    const [moved] = ordered.splice(index, 1);
    if (!moved) return;
    ordered.splice(target, 0, moved);
    try {
      const saved = await reorderOrganizationSeatingCharts(
        eventId,
        ordered.map(({ id }) => id),
      );
      setCharts(saved);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Charts could not be reordered.");
    }
  }
  function selectChart(nextId: string): void {
    const nextChart = charts.find(({ id }) => id === nextId);
    if (!nextChart) return;
    void (async () => {
      if (!(await flushSave())) return;
      const next = chartRequest(nextChart);
      setEditingId(nextId);
      editingIdRef.current = nextId;
      setChart(next);
      chartRef.current = next;
      setSaveState("saved");
      updateUrl(eventId, nextId);
    })();
  }
  return {
    autoSuggest,
    changeEvent,
    changeFormation,
    changeNewChartRowCount,
    changeNewChartSingerCount,
    chartDialog,
    chartName,
    confirmState,
    copyBusy,
    copyChartId,
    copyCharts,
    copyOpen,
    copyPerformanceId,
    copySelectedChart,
    createChart,
    deleteChart,
    loadCopyCharts,
    lookupQuery,
    markNotAttending,
    newChartRowCount,
    newChartSingerCount,
    openCreateChartDialog,
    profileBusy,
    profileDialog,
    profileForm,
    profileMessage,
    renameChart,
    reorderCharts,
    requestRemoveRow,
    requestRemoveSeat,
    saveProfile,
    selectChart,
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
    updateLayout,
  };
}
