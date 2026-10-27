import type { ModuleState } from "@choir/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOrganizationModuleState } from "../../api";
import type { OrganizationModuleSnapshot } from "./moduleStateContext";

/** One shell-owned catalog. Mutations invalidate earlier reads before applying confirmed deltas. */
export function useOrganizationModuleState(
  identity: string,
  initialModules?: readonly ModuleState[],
  enabled = true,
  refreshOnMount = true,
) {
  const [state, setState] = useState<{
    identity: string;
    snapshot: OrganizationModuleSnapshot;
    warning: boolean;
  }>(() => ({
    identity,
    snapshot: initialModules
      ? { status: "ready", modules: initialModules }
      : { status: "loading", modules: [] },
    warning: false,
  }));
  const generation = useRef(0);
  const active = useRef(false);
  const currentIdentity = useRef(identity);
  const inFlight = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const invalidateRead = useCallback(() => {
    generation.current++;
    inFlight.current?.controller.abort();
    inFlight.current = null;
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (!enabled || !active.current || currentIdentity.current !== identity)
      return Promise.resolve();
    if (inFlight.current) return inFlight.current.promise;
    const controller = new AbortController();
    const started = generation.current;
    const promise = getOrganizationModuleState(controller.signal)
      .then((modules) => {
        if (
          !controller.signal.aborted &&
          started === generation.current &&
          currentIdentity.current === identity
        )
          setState({ identity, snapshot: { status: "ready", modules }, warning: false });
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          started === generation.current &&
          currentIdentity.current === identity
        )
          setState((previous) => ({
            identity,
            snapshot:
              previous.identity === identity && previous.snapshot.status === "ready"
                ? previous.snapshot
                : { status: "error", modules: [] },
            warning: true,
          }));
      })
      .finally(() => {
        if (inFlight.current?.controller === controller) inFlight.current = null;
      });
    inFlight.current = { controller, promise };
    return promise;
  }, [enabled, identity]);
  const confirmChange = useCallback(
    (id: string, enabled: boolean) => {
      if (!active.current || currentIdentity.current !== identity) return;
      invalidateRead();
      setState((previous) =>
        previous.identity === identity && previous.snapshot.status === "ready"
          ? {
              ...previous,
              snapshot: {
                status: "ready",
                modules: previous.snapshot.modules.map((module) =>
                  module.id === id ? { ...module, enabled } : module,
                ),
              },
            }
          : previous,
      );
      void refresh();
    },
    [identity, refresh, invalidateRead],
  );
  useEffect(() => {
    currentIdentity.current = identity;
    if (!enabled) {
      active.current = false;
      invalidateRead();
      return;
    }
    active.current = true;
    generation.current++;
    if (refreshOnMount) void refresh();
    let foreground = document.visibilityState !== "hidden";
    const onBackground = () => {
      foreground = false;
    };
    const onForeground = () => {
      if (document.visibilityState === "hidden") {
        foreground = false;
        return;
      }
      if (!foreground) {
        foreground = true;
        void refresh();
      }
    };
    window.addEventListener("blur", onBackground);
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      active.current = false;
      invalidateRead();
      window.removeEventListener("blur", onBackground);
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [enabled, identity, refresh, refreshOnMount, invalidateRead]);
  return useMemo(
    () => ({
      snapshot:
        state.identity === identity ? state.snapshot : { status: "loading" as const, modules: [] },
      warning: state.identity === identity && state.warning,
      refresh,
      confirmChange,
    }),
    [identity, state, refresh, confirmChange],
  );
}
