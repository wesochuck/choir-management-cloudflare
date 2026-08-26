import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOrganizationRosterConfiguration,
  getOrganizationSeatingConfiguration,
  listOrganizationEvents,
  listOrganizationProfiles,
} from "../../../../auth/api";
import type { SeatingResources } from "../types";

export function useSeatingResources({ enabled }: { readonly enabled: boolean }) {
  const resourcesRef = useRef<SeatingResources | null>(null);
  const eventIdRef = useRef("");
  const [resources, setResources] = useState<SeatingResources | null>(null);
  const [eventId, setEventId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    eventIdRef.current = eventId;
  }, [eventId]);

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

  return {
    error,
    eventId,
    eventIdRef,
    loading,
    resources,
    resourcesRef,
    setError,
    setEventId,
    setLoading,
    setResources,
    updateUrl,
  };
}
