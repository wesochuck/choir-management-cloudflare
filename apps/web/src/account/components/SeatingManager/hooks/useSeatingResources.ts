import { useCallback, useEffect, useRef, useState } from "react";
import { selectDefaultPerformance } from "@choir/domain";
import {
  getOrganizationCalendarSettings,
  getOrganizationRosterConfiguration,
  getOrganizationSeatingConfiguration,
  listOrganizationEvents,
  listOrganizationProfiles,
} from "../../../../auth/api";
import type { SeatingResources } from "../types";

export function useSeatingResources({ enabled }: { readonly enabled: boolean }) {
  const resourcesRef = useRef<SeatingResources | null>(null);
  const eventIdRef = useRef("");
  const hasInitializedSelectionRef = useRef(false);
  const [resources, setResources] = useState<SeatingResources | null>(null);
  const [eventId, setEventId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectEventId: React.Dispatch<React.SetStateAction<string>> = useCallback((action) => {
    setEventId((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      eventIdRef.current = next;
      return next;
    });
  }, []);

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
      getOrganizationCalendarSettings(controller.signal),
    ])
      .then(([events, profiles, roster, seating, calendarSettings]) => {
        if (controller.signal.aborted) return;
        const performances = events.filter(({ type }) => type === "Performance");
        const nextResources: SeatingResources = {
          calendarSettings,
          events: performances,
          profiles,
          roster,
          seating,
        };
        resourcesRef.current = nextResources;
        setResources(nextResources);

        const requested = new URLSearchParams(window.location.search).get("eventId");
        const currentEventId = eventIdRef.current;
        const isCurrentStillValid = performances.some(({ id }) => id === currentEventId);

        let selected: string;
        if (hasInitializedSelectionRef.current && isCurrentStillValid) {
          selected = currentEventId;
        } else if (requested && performances.some(({ id }) => id === requested)) {
          selected = requested;
          hasInitializedSelectionRef.current = true;
        } else {
          const defaultPerformance = selectDefaultPerformance(
            events,
            new Date(),
            calendarSettings.timezone,
          );
          selected = defaultPerformance?.id ?? "";
          hasInitializedSelectionRef.current = true;
        }

        eventIdRef.current = selected;
        setEventId(selected);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            caught instanceof Error ? caught.message : "Seating resources could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
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
    setEventId: selectEventId,
    setLoading,
    setResources,
    updateUrl,
  };
}
