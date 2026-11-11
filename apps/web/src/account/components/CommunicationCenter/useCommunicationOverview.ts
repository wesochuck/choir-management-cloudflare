import { useCallback, useEffect, useRef, useState } from "react";
import type { CommunicationOverview } from "@choir/contracts";
import { getCommunicationOverview } from "../../../api/communications";
import { failureMessage } from "./utils";

export function useCommunicationOverview(enabled: boolean, revision: string | null) {
  const [data, setData] = useState<CommunicationOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await getCommunicationOverview(controller.signal);
      if (!controller.signal.aborted) setData(next);
    } catch (err: unknown) {
      if (!controller.signal.aborted) setError(failureMessage(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      requestRef.current?.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, revision, refresh]);
  return { data, loading, error, refresh };
}
