import { useEffect, useState } from "react";

import {
  AuthApiError,
  getOrganizationCalendarSettings,
  getOrganizationExportStatus,
  startOrganizationExport,
  updateOrganizationCalendarSettings,
} from "../auth/api";
import type { OrganizationExportStatusResponse } from "@choir/contracts";
import { RosterConfiguration } from "./RosterConfiguration";

function OrganizationExportPanel() {
  const [exportId, setExportId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<OrganizationExportStatusResponse | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!exportId) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await getOrganizationExportStatus(exportId, controller.signal);
        if (cancelled) return;
        setExportStatus(status);
        if (status.status === "queued" || status.status === "processing") {
          timer = window.setTimeout(() => void poll(), 1500);
        }
      } catch (pollError: unknown) {
        if (!cancelled && !(pollError instanceof DOMException && pollError.name === "AbortError")) {
          setExportError(
            pollError instanceof AuthApiError
              ? pollError.message
              : "The Organization export status could not be loaded.",
          );
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [exportId]);

  async function startExport() {
    setExportBusy(true);
    setExportError(null);
    setExportStatus(null);
    try {
      const started = await startOrganizationExport();
      setExportId(started.exportId);
      setExportStatus({
        byteCount: null,
        checksumSha256: null,
        downloadUrl: null,
        errorCode: null,
        exportId: started.exportId,
        requestId: started.requestId,
        status: started.status,
      });
    } catch (startError: unknown) {
      setExportError(
        startError instanceof AuthApiError
          ? startError.message
          : "The Organization export could not be started.",
      );
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <section className="surface-card" aria-labelledby="organization-export-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Data portability</p>
        <h2 id="organization-export-title">Export Organization data</h2>
        <p className="section-description">
          Owners and elevated Platform Administrators can request a bounded JSON snapshot of
          Organization records, audit events, and private-file inventory for backup or migration.
        </p>
      </div>
      {exportError ? (
        <p className="notice notice--error" role="alert">
          {exportError}
        </p>
      ) : null}
      {exportStatus ? (
        <p className="notice notice--success" role="status">
          {exportStatus.status === "completed"
            ? "Export ready to download."
            : exportStatus.status === "failed"
              ? `Export failed${exportStatus.errorCode ? ` (${exportStatus.errorCode})` : ""}.`
              : exportStatus.status === "processing"
                ? "Export is being prepared…"
                : "Export queued…"}
        </p>
      ) : null}
      <div className="button-row">
        <button
          className="button button--secondary"
          disabled={exportBusy}
          onClick={() => void startExport()}
          type="button"
        >
          {exportBusy ? "Starting…" : "Start Organization export"}
        </button>
        {exportStatus?.downloadUrl ? (
          <a className="button button--primary" download href={exportStatus.downloadUrl}>
            Download export
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function OrganizationSettingsPage({ enabled }: { readonly enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationCalendarSettings(controller.signal)
      .then((settings) => {
        setTimezone(settings.timezone);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError("Organization settings could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function saveTimezone() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const settings = await updateOrganizationCalendarSettings(timezone);
      setTimezone(settings.timezone);
      setSuccess("Organization timezone updated.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : "The Organization timezone could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <p className="notice notice--warning">
        Verify Organization MFA to change Organization settings.
      </p>
    );
  }

  return (
    <div className="settings-stack">
      <section className="surface-card" aria-labelledby="calendar-settings-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Events</p>
          <h2 id="calendar-settings-title">Calendar settings</h2>
        </div>
        {loading ? <p role="status">Loading calendar settings…</p> : null}
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="notice notice--success" role="status">
            {success}
          </p>
        ) : null}
        {!loading ? (
          <form
            className="form-stack settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTimezone();
            }}
          >
            <div className="field">
              <label htmlFor="settings-timezone">IANA timezone</label>
              <input
                id="settings-timezone"
                list="settings-timezones"
                maxLength={100}
                onChange={(event) => {
                  setTimezone(event.target.value);
                }}
                required
                value={timezone}
              />
              <datalist id="settings-timezones">
                <option value="UTC" />
                <option value="America/New_York" />
                <option value="America/Chicago" />
                <option value="America/Denver" />
                <option value="America/Los_Angeles" />
              </datalist>
            </div>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save timezone"}
            </button>
          </form>
        ) : null}
      </section>
      <RosterConfiguration enabled={enabled} />
      <OrganizationExportPanel />
    </div>
  );
}
