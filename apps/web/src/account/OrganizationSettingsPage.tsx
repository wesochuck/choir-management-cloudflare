import { useEffect, useState } from "react";

import {
  AuthApiError,
  getOrganizationCalendarSettings,
  getOrganizationExportStatus,
  getOrganizationTransactionFeeSettings,
  startOrganizationExport,
  updateOrganizationCalendarSettings,
  updateOrganizationTransactionFeeSettings,
} from "../auth/api";
import type { OrganizationExportStatusResponse, TransactionFeeSettings } from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { RosterConfiguration } from "./RosterConfiguration";

const fallbackTimeZones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

const timeZoneOptions = [
  ...new Set(
    typeof Intl.supportedValuesOf === "function"
      ? ["UTC", ...Intl.supportedValuesOf("timeZone")]
      : fallbackTimeZones,
  ),
].sort((left, right) => left.localeCompare(right));

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

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
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeSuccess, setFeeSuccess] = useState<string | null>(null);
  const [transactionFeeSettings, setTransactionFeeSettings] = useState<TransactionFeeSettings>({
    fixedCents: 30,
    passFeeToDonor: false,
    percentage: 2.9,
  });
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.all([
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationTransactionFeeSettings(controller.signal),
    ])
      .then(([calendarSettings, feeSettings]) => {
        setTimezone(calendarSettings.timezone);
        setTransactionFeeSettings(feeSettings);
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

  async function saveTransactionFees() {
    setFeeBusy(true);
    setFeeError(null);
    setFeeSuccess(null);
    try {
      const settings = await updateOrganizationTransactionFeeSettings(transactionFeeSettings);
      setTransactionFeeSettings(settings);
      setFeeSuccess("Transaction fee settings updated.");
    } catch (saveError: unknown) {
      setFeeError(
        saveError instanceof AuthApiError
          ? saveError.message
          : "Transaction fee settings could not be updated.",
      );
    } finally {
      setFeeBusy(false);
    }
  }

  const exampleFeeCents = transactionProcessingFeeCents(1_000, transactionFeeSettings);
  const examplePayerTotalCents =
    1_000 + (transactionFeeSettings.passFeeToDonor ? exampleFeeCents : 0);

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
              <select
                id="settings-timezone"
                onChange={(event) => {
                  setTimezone(event.target.value);
                }}
                required
                value={timezone}
              >
                {!timeZoneOptions.includes(timezone) ? (
                  <option value={timezone}>{timezone}</option>
                ) : null}
                {timeZoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save timezone"}
            </button>
          </form>
        ) : null}
      </section>
      <section className="surface-card" aria-labelledby="transaction-fee-settings-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Payments</p>
          <h2 id="transaction-fee-settings-title">Transaction processing fees</h2>
          <p className="section-description">
            Tickets, ticket bundles, and dues use this fee. You can optionally pass the same fee
            through to donation checkout.
          </p>
        </div>
        {feeError ? (
          <p className="notice notice--error" role="alert">
            {feeError}
          </p>
        ) : null}
        {feeSuccess ? (
          <p className="notice notice--success" role="status">
            {feeSuccess}
          </p>
        ) : null}
        {!loading ? (
          <form
            className="form-stack settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTransactionFees();
            }}
          >
            <div className="settings-grid">
              <label className="field" htmlFor="transaction-fee-percentage">
                Percentage (%)
                <input
                  id="transaction-fee-percentage"
                  min="0"
                  onChange={(event) => {
                    setTransactionFeeSettings((current) => ({
                      ...current,
                      percentage: Number(event.target.value) || 0,
                    }));
                  }}
                  step="0.01"
                  type="number"
                  value={transactionFeeSettings.percentage}
                />
              </label>
              <label className="field" htmlFor="transaction-fee-fixed">
                Fixed fee (USD)
                <input
                  id="transaction-fee-fixed"
                  min="0"
                  onChange={(event) => {
                    setTransactionFeeSettings((current) => ({
                      ...current,
                      fixedCents: Math.round((Number(event.target.value) || 0) * 100),
                    }));
                  }}
                  step="0.01"
                  type="number"
                  value={(transactionFeeSettings.fixedCents / 100).toFixed(2)}
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                checked={transactionFeeSettings.passFeeToDonor}
                onChange={(event) => {
                  setTransactionFeeSettings((current) => ({
                    ...current,
                    passFeeToDonor: event.target.checked,
                  }));
                }}
                type="checkbox"
              />
              Pass the processing fee through to donors
            </label>
            <p className="notice notice--info">
              On a $10.00 charge, the processing fee is {money(exampleFeeCents)} (
              {money(Math.round(1_000 * (transactionFeeSettings.percentage / 100)))} variable +{" "}
              {money(transactionFeeSettings.fixedCents)} fixed), for a total of{" "}
              {money(examplePayerTotalCents)} paid by the donor when pass-through is enabled;
              otherwise the Organization covers the fee.
            </p>
            <button className="button button--primary" disabled={feeBusy} type="submit">
              {feeBusy ? "Saving…" : "Save transaction fees"}
            </button>
          </form>
        ) : null}
      </section>
      <RosterConfiguration enabled={enabled} />
      <OrganizationExportPanel />
    </div>
  );
}
