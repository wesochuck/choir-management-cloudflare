import type {
  OrganizationRosterAutomationPreviewResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { previewOrganizationRosterAutomation } from "../auth/api";

export type RosterPreviewState =
  | { readonly status: "idle" }
  | {
      readonly isSlow: boolean;
      readonly preview: OrganizationRosterAutomationPreviewResponse | null;
      readonly status: "loading";
    }
  | {
      readonly preview: OrganizationRosterAutomationPreviewResponse;
      readonly status: "ready";
    }
  | {
      readonly error: string;
      readonly preview: OrganizationRosterAutomationPreviewResponse | null;
      readonly status: "error";
    };

export function formatPreviewCounts(preview: OrganizationRosterAutomationPreviewResponse): string {
  if (preview.affectedProfileCount === 0)
    return "No existing Profiles would change under these settings.";
  return `${String(preview.affectedProfileCount)} Profile${preview.affectedProfileCount === 1 ? "" : "s"} affected · ${String(preview.statusChangeCount)} status change${preview.statusChangeCount === 1 ? "" : "s"} · ${String(preview.rsvpExpiryCount)} RSVP expiry${preview.rsvpExpiryCount === 1 ? "" : "ies"}`;
}

export function previewSummary(state: RosterPreviewState): string {
  if (state.status === "error") {
    if (state.preview) {
      return `${formatPreviewCounts(state.preview)} (Preview out of date)`;
    }
    return "Preview unavailable.";
  }

  if (state.status === "loading") {
    if (state.preview) {
      return `${formatPreviewCounts(state.preview)}${state.isSlow ? " · Still updating…" : " · Refreshing…"}`;
    }
    return state.isSlow ? "Still previewing the current roster…" : "Previewing the current roster…";
  }

  if (state.status === "ready") {
    return formatPreviewCounts(state.preview);
  }

  return "Previewing the current roster…";
}

export function useRosterAutomationPreview(
  configuration: OrganizationRosterConfiguration | null,
  effectiveProfileId: string | null,
  enabled: boolean,
) {
  const [previewState, setPreviewState] = useState<RosterPreviewState>({ status: "idle" });
  const [retryTrigger, setRetryTrigger] = useState(0);
  const isManualRetryRef = useRef(false);

  const handleRetry = useCallback(() => {
    isManualRetryRef.current = true;
    setRetryTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!configuration || !enabled) return;

    const controller = new AbortController();
    let slowTimer: number | undefined;

    const executePreview = () => {
      setPreviewState((current) => ({
        isSlow: false,
        preview: "preview" in current ? current.preview : null,
        status: "loading",
      }));

      slowTimer = window.setTimeout(() => {
        if (!controller.signal.aborted) {
          setPreviewState((current) =>
            current.status === "loading" ? { ...current, isSlow: true } : current,
          );
        }
      }, 3000);

      previewOrganizationRosterAutomation(configuration, effectiveProfileId, controller.signal)
        .then((nextPreview) => {
          if (!controller.signal.aborted) {
            if (slowTimer) window.clearTimeout(slowTimer);
            setPreviewState({
              preview: nextPreview,
              status: "ready",
            });
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (slowTimer) window.clearTimeout(slowTimer);
          const message =
            err instanceof Error && err.message
              ? err.message
              : "Failed to load roster automation preview.";
          setPreviewState((current) => ({
            error: message,
            preview: "preview" in current ? current.preview : null,
            status: "error",
          }));
        });
    };

    const isRetry = isManualRetryRef.current;
    isManualRetryRef.current = false;
    const delay = isRetry ? 0 : 250;
    const debounceTimer = window.setTimeout(executePreview, delay);

    return () => {
      controller.abort();
      window.clearTimeout(debounceTimer);
      if (slowTimer) window.clearTimeout(slowTimer);
    };
  }, [configuration, effectiveProfileId, enabled, retryTrigger]);

  const activeState = !configuration || !enabled ? { status: "idle" as const } : previewState;

  return { handleRetry, previewState: activeState };
}
