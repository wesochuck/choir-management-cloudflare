import { useEffect, useRef, useState } from "react";
import type { OrganizationSeatingChart, OrganizationSeatingChartRequest } from "@choir/contracts";
import {
  listOrganizationEventAttendance,
  listOrganizationSeatingCharts,
} from "../../../../auth/api";
import type { SeatingResources } from "../types";
import { chartRequest, emptyChart } from "../utils";

interface Args {
  readonly enabled: boolean;
  readonly eventId: string;
  readonly resourcesRef: React.RefObject<SeatingResources | null>;
  readonly updateUrl: (nextEventId: string, nextChartId: string | null) => void;
  readonly setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useSeatingCharts({
  enabled,
  eventId,
  resourcesRef,
  setError,
  setLoading,
  updateUrl,
}: Args) {
  const chartRef = useRef<OrganizationSeatingChartRequest | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const [charts, setCharts] = useState<readonly OrganizationSeatingChart[]>([]);
  const [attendance, setAttendance] = useState<
    readonly { readonly profileId: string; readonly rsvp: "No" | "Pending" | "Yes" }[]
  >([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [chart, setChart] = useState<OrganizationSeatingChartRequest>(emptyChart);

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
  }, [enabled, eventId, resourcesRef, setError, setLoading, updateUrl]);

  return {
    attendance,
    chart,
    chartRef,
    charts,
    editingId,
    editingIdRef,
    setAttendance,
    setChart,
    setCharts,
    setEditingId,
  };
}
