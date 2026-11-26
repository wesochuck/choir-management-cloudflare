import { useCallback, useEffect, useRef, useState } from "react";
import type { CommunicationOverview } from "@choir/contracts";
import { getCommunicationOverview } from "../../../api/communications";
import { failureMessage } from "./utils";

const OVERVIEW_FRESHNESS_MS = 60_000;

export function useCommunicationOverview(section: "overview" | "automations" | null) {
  const [data, setData] = useState<CommunicationOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lastSuccess = useRef<number | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    lastSuccess.current = null;
    setLoading(true);
    try {
      const next = await getCommunicationOverview(controller.signal);
      if (!controller.signal.aborted) {
        lastSuccess.current = Date.now();
        setData(next);
        setError(null);
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) setError(failureMessage(err));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!section) return;
    let active = true;
    const refreshIfStale = () => {
      if (requestRef.current) return;
      if (
        lastSuccess.current !== null &&
        Date.now() - lastSuccess.current < OVERVIEW_FRESHNESS_MS
      ) {
        return;
      }
      void refresh();
    };
    void Promise.resolve().then(() => {
      if (active) refreshIfStale();
    });
    const onFocus = () => {
      if (document.visibilityState === "visible") refreshIfStale();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [section, refresh]);
  return { data, loading, error, refresh };
}
