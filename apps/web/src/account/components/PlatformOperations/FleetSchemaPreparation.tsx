import { useEffect, useState } from "react";

import {
  getPlatformFleetSchemaStatus,
  startPlatformFleetSchemaPreparation,
} from "../../../auth/api";
import { schemaButtonLabel, schemaStatusMessage, type FleetSchemaState } from "./shared";

export function FleetSchemaPreparation() {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<FleetSchemaState>({ status: "loading" });

  useEffect(() => {
    const abortController = new AbortController();
    getPlatformFleetSchemaStatus(abortController.signal)
      .then((result) => {
        setState({ result, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function startPreparation() {
    setBusy(true);
    try {
      setState({ result: await startPlatformFleetSchemaPreparation(), status: "ready" });
    } catch {
      setState({ status: "error" });
    } finally {
      setBusy(false);
    }
  }

  const running = state.status === "ready" && state.result.preparation?.status === "running";
  const upToDate =
    state.status === "ready" &&
    state.result.preparation?.status === "completed" &&
    state.result.preparation.targetVersion >= state.result.currentVersion;
  return (
    <div className="platform-directory" aria-live="polite">
      <h4>Organization schema preparation</h4>
      <p>
        This is an operator-only migration step for a deployed schema change. New Organizations are
        initialized automatically; routine Organization setup does not require this action.
      </p>
      {state.status === "loading" ? <p>Loading schema preparation status…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Schema preparation status could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {state.status === "ready" ? (
        <>
          <p>
            Deployed schema version: {String(state.result.currentVersion)}.{" "}
            {state.result.preparation
              ? `Latest run: ${state.result.preparation.status}; ${String(state.result.preparation.processedCount)} Organizations prepared.`
              : "No fleet preparation has run yet."}
          </p>
          <p className="notice notice--info">{schemaStatusMessage(state, running, upToDate)}</p>
        </>
      ) : null}
      {state.status === "ready" && upToDate ? (
        <span className="status-pill platform-schema-status">All Organizations prepared</span>
      ) : (
        <button
          className="button button--secondary"
          disabled={busy || running || state.status === "loading"}
          onClick={() => {
            void startPreparation();
          }}
          type="button"
        >
          {schemaButtonLabel(state, busy, running)}
        </button>
      )}
    </div>
  );
}
