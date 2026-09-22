import { useEffect, useState } from "react";

import {
  AuthApiError,
  createPlatformElevation,
  getPlatformOrganizationContext,
  revokePlatformElevation,
} from "../../../auth/api";
import { displayDate, type ElevationState } from "./shared";
import { StripeConnectRecovery } from "./StripeConnectRecovery";

export function OrganizationElevation({ organizationId }: { readonly organizationId: string }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elevation, setElevation] = useState<ElevationState>({ status: "loading" });
  const [reason, setReason] = useState("");

  useEffect(() => {
    const abortController = new AbortController();
    getPlatformOrganizationContext(abortController.signal)
      .then((context) => {
        setElevation(
          context.organizationId === organizationId
            ? { context, status: "ready" }
            : { status: "error" },
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setElevation({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [organizationId]);

  async function enableEdits() {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      setActionError("Enter a concise reason between 3 and 500 characters.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const context = await createPlatformElevation(normalizedReason);
      if (context.organizationId !== organizationId) {
        setElevation({ status: "error" });
        return;
      }
      setElevation({ context, status: "ready" });
      setReason("");
    } catch (error: unknown) {
      setActionError(
        error instanceof AuthApiError
          ? error.message
          : "Platform edit access could not be enabled. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function endEdits() {
    if (elevation.status !== "ready" || !elevation.context.elevationId) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await revokePlatformElevation(elevation.context.elevationId);
      setElevation({
        context: {
          ...elevation.context,
          canEdit: false,
          elevationExpiresAt: null,
          elevationId: null,
        },
        status: "ready",
      });
    } catch {
      setActionError("Platform edit access could not be ended. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="platform-operations" aria-labelledby="platform-elevation-title">
      <div className="section-heading section-heading--nested platform-operation__heading">
        <h3 id="platform-elevation-title">Organization access</h3>
        <p>
          The validated hostname selected this Organization. Read access does not impersonate a
          member; edits require a short-lived, session-bound reason and retain your identity in the
          audit history.
        </p>
      </div>
      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      {elevation.status === "loading" ? <p>Checking scoped edit access…</p> : null}
      {elevation.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Scoped Platform Administrator access could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {elevation.status === "ready" && elevation.context.canEdit ? (
        <div className="platform-action platform-elevation-active">
          <div className="notice notice--warning" role="status">
            <strong>Platform edits enabled.</strong> Access expires{" "}
            {elevation.context.elevationExpiresAt
              ? displayDate(elevation.context.elevationExpiresAt)
              : "at the end of this short-lived session"}
            .
          </div>
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => {
              void endEdits();
            }}
            type="button"
          >
            {busy ? "Ending edit access…" : "End edit access"}
          </button>
        </div>
      ) : null}
      {elevation.status === "ready" && !elevation.context.canEdit ? (
        <form
          className="form-stack platform-elevation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void enableEdits();
          }}
        >
          <p className="status-pill">Read-only Platform access</p>
          <div className="field">
            <label htmlFor="platform-elevation-reason">Reason for enabling edits</label>
            <textarea
              id="platform-elevation-reason"
              maxLength={500}
              minLength={3}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              required
              rows={3}
              value={reason}
            />
          </div>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Enabling edits…" : "Enable Platform edits for 15 minutes"}
          </button>
        </form>
      ) : null}

      <StripeConnectRecovery organizationId={organizationId} />
    </div>
  );
}
