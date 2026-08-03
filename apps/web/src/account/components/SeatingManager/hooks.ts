import type {
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationSeatingChart,
  OrganizationSeatingChartRequest,
} from "@choir/contracts";
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  calculateSeatingSuggestions,
  moveAssignment,
  removeRow,
  removeSeat,
  swapAssignments,
  unassignProfile,
} from "@choir/domain";
import type { addRow } from "@choir/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuthApiError,
  createOrganizationProfile,
  deleteOrganizationSeatingChart,
  getOrganizationRosterConfiguration,
  getOrganizationSeatingConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationProfiles,
  listOrganizationSeatingCharts,
  reorderOrganizationSeatingCharts,
  setOrganizationEventRsvp,
  updateOrganizationSeatingChart,
  createOrganizationSeatingChart,
} from "../../../auth/api";
import { getUniqueDisplayNames } from "../../nameFormatting";
import { emptyChart, emptyProfile, chartRequest } from "./utils";
import type { SeatingResources, ViewMode, SaveState, ConfirmState } from "./types";

export function useIsNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => {
      setNarrow(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  return narrow;
}

export function useSeatingManagerController({ enabled }: { readonly enabled: boolean }) {
  const isNarrow = useIsNarrowScreen();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const queuedRevisionRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const unsavedChangesRef = useRef(false);
  const nativeDropHandledRef = useRef(false);
  const chartRef = useRef<OrganizationSeatingChartRequest | null>(null);
  const resourcesRef = useRef<SeatingResources | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const eventIdRef = useRef("");
  const [resources, setResources] = useState<SeatingResources | null>(null);
  const [eventId, setEventId] = useState("");
  const [charts, setCharts] = useState<readonly OrganizationSeatingChart[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [chart, setChart] = useState<OrganizationSeatingChartRequest>(emptyChart);
  const [attendance, setAttendance] = useState<
    readonly { readonly profileId: string; readonly rsvp: "No" | "Pending" | "Yes" }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showSeatNumbers, setShowSeatNumbers] = useState(true);
  const [showVoiceParts, setShowVoiceParts] = useState(true);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [fallbackFocus, setFallbackFocus] = useState(false);
  const [formationTab, setFormationTab] = useState<"chart" | "formations">("chart");
  const [query, setQuery] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [dragMessage, setDragMessage] = useState("");
  const [draggingToken, setDraggingToken] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [chartDialog, setChartDialog] = useState<"create" | "rename" | null>(null);
  const [chartName, setChartName] = useState("");
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
  const updateUrl = useCallback((nextEventId: string, nextChartId: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (nextEventId) params.set("eventId", nextEventId);
    else params.delete("eventId");
    if (nextChartId) params.set("chartId", nextChartId);
    else params.delete("chartId");
    const queryString = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}`,
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationProfiles(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      getOrganizationSeatingConfiguration(controller.signal),
    ])
      .then(([events, profiles, roster, seating]) => {
        const performances = events.filter(({ type }) => type === "Performance");
        const nextResources = { events: performances, profiles, roster, seating };
        resourcesRef.current = nextResources;
        setResources(nextResources);
        const requested = new URLSearchParams(window.location.search).get("eventId");
        const selected = performances.some(({ id }) => id === requested)
          ? requested
          : (performances[0]?.id ?? "");
        setEventId(selected ?? "");
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            caught instanceof Error ? caught.message : "Seating resources could not be loaded.",
          );
        }
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  useEffect(() => {
    const currentResources = resourcesRef.current;
    if (!enabled || !eventId || !currentResources) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationSeatingCharts(eventId, controller.signal),
      listOrganizationEventAttendance(eventId, controller.signal),
    ])
      .then(([nextCharts, nextAttendance]) => {
        setCharts(nextCharts);
        setAttendance(nextAttendance);
        const requestedChart = new URLSearchParams(window.location.search).get("chartId");
        const active = nextCharts.find(({ id }) => id === requestedChart) ?? nextCharts[0];
        const nextId = active?.id ?? null;
        const nextChart = active
          ? chartRequest(active)
          : {
              ...emptyChart,
              formationId: currentResources.seating.defaultFormationId,
              venueId: null,
            };
        setEditingId(nextId);
        editingIdRef.current = nextId;
        setChart(nextChart);
        chartRef.current = nextChart;
        updateUrl(eventId, nextId);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            caught instanceof Error ? caught.message : "Performance seating could not be loaded.",
          );
        }
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [enabled, eventId, updateUrl]);

  const eligibleProfiles = useMemo(() => {
    if (!resources) return [];
    const attending = new Set(
      attendance.filter(({ rsvp }) => rsvp === "Yes").map(({ profileId }) => profileId),
    );
    return resources.profiles.filter(
      (profile) =>
        profile.globalStatus === "Active" &&
        Boolean(profile.voicePart.trim()) &&
        attending.has(profile.id),
    );
  }, [attendance, resources]);
  const profilesById = useMemo(
    () => new Map((resources?.profiles ?? []).map((profile) => [profile.id, profile])),
    [resources?.profiles],
  );
  const assignedProfiles = useMemo(
    () =>
      [...new Set(Object.values(chart.assignments))].flatMap((profileId) => {
        const profile = profilesById.get(profileId);
        return profile ? [profile] : [];
      }),
    [chart.assignments, profilesById],
  );
  const seatingDisplayNames = useMemo(
    () => getUniqueDisplayNames(assignedProfiles),
    [assignedProfiles],
  );
  const assignedIds = useMemo(() => new Set(Object.values(chart.assignments)), [chart.assignments]);
  const unassignedProfiles = useMemo(
    () => eligibleProfiles.filter(({ id }) => !assignedIds.has(id)),
    [assignedIds, eligibleProfiles],
  );
  const lookupProfiles = useMemo(() => {
    const presentIds = new Set([...unassignedProfiles.map(({ id }) => id), ...assignedIds]);
    return (resources?.profiles ?? []).filter(({ id }) => !presentIds.has(id));
  }, [assignedIds, resources?.profiles, unassignedProfiles]);
  const currentFormation = useMemo(() => {
    const found = resources?.seating.formations.find(({ id }) => id === chart.formationId);
    return found ?? resources?.seating.formations[0] ?? null;
  }, [chart.formationId, resources?.seating.formations]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const saveChart = useCallback(
    async (payload: OrganizationSeatingChartRequest, revision: number): Promise<boolean> => {
      if (!eventIdRef.current || !editingIdRef.current) return true;
      setSaveState("saving");
      try {
        const saved = await updateOrganizationSeatingChart(
          eventIdRef.current,
          editingIdRef.current,
          payload,
        );
        if (revision === saveRevisionRef.current) {
          setChart(chartRequest(saved));
          chartRef.current = chartRequest(saved);
          setCharts((current) =>
            current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
          );
          unsavedChangesRef.current = false;
          setSaveState("saved");
        }
        return true;
      } catch (caught: unknown) {
        if (revision === saveRevisionRef.current) {
          queuedRevisionRef.current = revision - 1;
          unsavedChangesRef.current = true;
          setSaveState("error");
        }
        setError(
          caught instanceof Error ? caught.message : "The seating chart could not be saved.",
        );
        return false;
      }
    },
    [],
  );

  const enqueueSave = useCallback(
    (payload: OrganizationSeatingChartRequest, revision: number): Promise<boolean> => {
      if (revision <= queuedRevisionRef.current) return saveQueueRef.current;
      queuedRevisionRef.current = revision;
      const next = saveQueueRef.current.then(() => saveChart(payload, revision));
      saveQueueRef.current = next.catch(() => false);
      return next;
    },
    [saveChart],
  );

  const scheduleSave = useCallback(
    (next: OrganizationSeatingChartRequest): void => {
      chartRef.current = next;
      setChart(next);
      if (!editingIdRef.current) {
        setSaveState("idle");
        return;
      }
      unsavedChangesRef.current = true;
      setSaveState("saving");
      saveRevisionRef.current += 1;
      const revision = saveRevisionRef.current;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void enqueueSave(next, revision);
      }, 750);
    },
    [enqueueSave],
  );

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!editingIdRef.current || !chartRef.current || saveState === "idle") return true;
    const revision = saveRevisionRef.current;
    return enqueueSave(chartRef.current, revision);
  }, [enqueueSave, saveState]);

  function applyChart(next: OrganizationSeatingChartRequest): void {
    setError(null);
    scheduleSave(next);
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

  async function createChart(): Promise<void> {
    if (!eventId || !resources) return;
    setSaveState("saving");
    try {
      const created = await createOrganizationSeatingChart(eventId, {
        ...chart,
        name: chartName.trim() || "Main Seating Chart",
        formationId: chart.formationId || resources.seating.defaultFormationId,
      });
      setCharts((current) =>
        [...current, created].toSorted((left, right) => left.sortOrder - right.sortOrder),
      );
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

  function handleDropToken(token: string, targetSeatKey?: string): void {
    if (!token) return;
    if (!targetSeatKey) {
      if (!token.startsWith("seat:")) return;
      const seatKey = token.slice("seat:".length);
      applyChart({
        ...chart,
        assignments: Object.fromEntries(
          Object.entries(chart.assignments).filter(([key]) => key !== seatKey),
        ),
      });
      return;
    }
    if (token.startsWith("seat:")) {
      const sourceSeatKey = token.slice("seat:".length);
      const targetOccupied = Boolean(chart.assignments[targetSeatKey]);
      applyChart({
        ...chart,
        assignments: targetOccupied
          ? swapAssignments(chart.assignments, sourceSeatKey, targetSeatKey)
          : moveAssignment(chart.assignments, sourceSeatKey, targetSeatKey),
      });
    } else if (token.startsWith("profile:")) {
      const profileId = token.slice("profile:".length);
      applyChart({
        ...chart,
        assignments: moveAssignment(chart.assignments, "", targetSeatKey, profileId),
      });
    }
  }

  function handleDragStart(event: DragStartEvent): void {
    nativeDropHandledRef.current = false;
    const token = String(event.active.id);
    setDraggingToken(token);
    const profileId = token.startsWith("profile:")
      ? token.slice("profile:".length)
      : token.startsWith("seat:")
        ? chart.assignments[token.slice("seat:".length)]
        : undefined;
    const profileName = profileId ? profilesById.get(profileId)?.displayName : undefined;
    setDragMessage(
      profileName
        ? `Dragging ${profileName}. Choose a seat to assign or move, or the tray to unassign.`
        : token.startsWith("profile:")
          ? "Dragging Profile. Choose an empty or occupied seat to assign or replace."
          : "Dragging assigned seat. Choose another seat to move or swap, or the tray to unassign.",
    );
  }

  function handleDragEnd(event: DragEndEvent): void {
    setDraggingToken(null);
    if (nativeDropHandledRef.current) {
      nativeDropHandledRef.current = false;
      return;
    }
    const token = String(event.active.id);
    const target = event.over ? String(event.over.id) : null;
    if (target === "tray") {
      handleDropToken(token);
      setDragMessage("Profile unassigned and returned to the tray.");
      return;
    }
    if (target?.startsWith("seat:")) {
      handleDropToken(token, target.slice("seat:".length));
      setDragMessage("Seating assignment updated.");
      return;
    }
    setDragMessage("Drag canceled.");
  }

  function handleNativeDrop(token: string, targetSeatKey?: string): void {
    nativeDropHandledRef.current = true;
    setDraggingToken(null);
    handleDropToken(token, targetSeatKey);
    setDragMessage(
      targetSeatKey
        ? "Seating assignment updated."
        : "Profile unassigned and returned to the tray.",
    );
  }

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
    const occupant = profilesById.get(chart.assignments[key] ?? "");
    setConfirmState({
      title: "Delete seat?",
      message: occupant
        ? `Deleting this seat will return ${occupant.displayName} to Unassigned Profiles.`
        : "Delete this seat from the row?",
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
      setResources((current) =>
        current ? { ...current, profiles: [...current.profiles, created] } : current,
      );
      setAttendance((current) => [...current, { profileId: created.id, rsvp: "Yes" }]);
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
      ([, profileId]) => profileId === profile.id,
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
        setAttendance((current) =>
          current.map((row) => (row.profileId === profile.id ? { ...row, rsvp: "No" } : row)),
        );
        setConfirmState(null);
      },
    });
  }

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
    const onFullscreenChange = () => {
      setFocusMode(Boolean(document.fullscreenElement));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fallbackFocus) void exitFocus();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [fallbackFocus]);

  useEffect(() => {
    if (!fallbackFocus) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fallbackFocus]);

  useEffect(() => {
    if (saveState !== "error" || !unsavedChangesRef.current) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari still requires returnValue for the native prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveState]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );
  return {
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
  };
}

export type SeatingManagerModel = ReturnType<typeof useSeatingManagerController>;
