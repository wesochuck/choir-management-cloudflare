import { useCallback, useEffect, useRef, useState } from "react";
import type { OrganizationSeatingChart, OrganizationSeatingChartRequest } from "@choir/contracts";
import { updateOrganizationSeatingChart } from "../../../../auth/api";
import type { SaveState } from "../types";
import { chartRequest } from "../utils";

interface Args {
  readonly chart: OrganizationSeatingChartRequest;
  readonly chartRef: React.RefObject<OrganizationSeatingChartRequest | null>;
  readonly editingIdRef: React.RefObject<string | null>;
  readonly eventIdRef: React.RefObject<string>;
  readonly setChart: React.Dispatch<React.SetStateAction<OrganizationSeatingChartRequest>>;
  readonly setCharts: React.Dispatch<React.SetStateAction<readonly OrganizationSeatingChart[]>>;
  readonly setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useSeatingPersistence({
  chart,
  chartRef,
  editingIdRef,
  eventIdRef,
  setChart,
  setCharts,
  setError,
}: Args) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const queuedRevisionRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const unsavedChangesRef = useRef(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

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
    [chartRef, editingIdRef, eventIdRef, setChart, setCharts, setError],
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
      clearTimeout(saveTimerRef.current ?? undefined);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void enqueueSave(next, revision);
      }, 750);
    },
    [chartRef, editingIdRef, enqueueSave, setChart],
  );

  const flushSave = useCallback(async (): Promise<boolean> => {
    clearTimeout(saveTimerRef.current ?? undefined);
    saveTimerRef.current = null;
    if (!editingIdRef.current || !chartRef.current || saveState === "idle") return true;
    const revision = saveRevisionRef.current;
    return enqueueSave(chartRef.current, revision);
  }, [chartRef, editingIdRef, enqueueSave, saveState]);
  function applyChart(next: OrganizationSeatingChartRequest): void {
    setError(null);
    scheduleSave(next);
  }

  useEffect(() => {
    if (saveState !== "error" || !unsavedChangesRef.current) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- required for beforeunload compat
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveState]);

  useEffect(
    () => () => {
      clearTimeout(saveTimerRef.current ?? undefined);
    },
    [],
  );

  return {
    applyChart,
    chartRef,
    enqueueSave,
    flushSave,
    queuedRevisionRef,
    saveQueueRef,
    saveRevisionRef,
    saveState,
    saveTimerRef,
    scheduleSave,
    setSaveState,
    unsavedChangesRef,
    // expose chart synchronously for facades that need it
    _chart: chart,
  };
}
