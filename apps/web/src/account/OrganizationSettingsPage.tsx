import { useEffect, useState } from "react";

import {
  AuthApiError,
  getOrganizationCalendarSettings,
  getOrganizationExportStatus,
  getOrganizationPaymentSettings,
  getOrganizationTransactionFeeSettings,
  startOrganizationExport,
  updateOrganizationCalendarSettings,
  updateOrganizationPaymentActivation,
  updateOrganizationTransactionFeeSettings,
} from "../auth/api";
import type {
  OrganizationExportStatusResponse,
  OrganizationPaymentSettingsResponse,
  TransactionFeeSettings,
} from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { useFloatingSaveAction } from "./useFloatingSaveAction";

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

function currencyDraftFromCents(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function currencyCentsFromDraft(value: string): number {
  const trimmed = value.trim();
  if (!/^\d*(?:\.\d*)?$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
}

function transactionFeeSettingsEqual(left: TransactionFeeSettings, right: TransactionFeeSettings) {
  return (
    left.fixedCents === right.fixedCents &&
    left.passFeeToDonor === right.passFeeToDonor &&
    left.percentage === right.percentage
  );
}

const paymentModules = [
  { id: "tickets", label: "Tickets", description: "Sell tickets and ticket bundles online." },
  { id: "donations", label: "Donations", description: "Accept one-time donations online." },
  { id: "dues", label: "Dues", description: "Collect seasonal dues online." },
] as const;

function OrganizationPaymentSettingsPanel() {
  const [settings, setSettings] = useState<OrganizationPaymentSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyModule, setBusyModule] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getOrganizationPaymentSettings(controller.signal)
      .then((loaded) => {
        setSettings(loaded);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof AuthApiError
              ? loadError.message
              : "Online payment settings could not be loaded.",
          );
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  async function toggle(moduleId: (typeof paymentModules)[number]["id"], enabled: boolean) {
    if (
      enabled &&
      !window.confirm("Enable this online payment type after reviewing the readiness checklist?")
    ) {
      return;
    }
    setBusyModule(moduleId);
    setError(null);
    setSuccess(null);
    try {
      const activations = await updateOrganizationPaymentActivation(moduleId, enabled);
      setSettings((current) => (current ? { ...current, activations } : current));
      setSuccess(
        `${moduleId[0]?.toUpperCase() ?? ""}${moduleId.slice(1)} online payments ${enabled ? "enabled" : "disabled"}.`,
      );
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : "The online payment setting could not be updated.",
      );
    } finally {
      setBusyModule(null);
    }
  }

  return (
    <section
      className="surface-card"
      id="payments-settings"
      aria-labelledby="payments-settings-title"
    >
      <div className="section-heading section-heading--compact organization-payment-settings__heading">
        <p className="eyebrow">Payments</p>
        <h2 id="payments-settings-title">Online payment settings</h2>
        <p className="section-description">
          Connect one Stripe account for this Organization, then turn on only the payment types you
          are ready to support. A payment is shown as processing until Stripe confirms it.
        </p>
      </div>
      {loading ? <p role="status">Checking payment readiness…</p> : null}
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
      {settings ? (
        <>
          <div className="settings-grid">
            <p className="notice notice--info">
              Stripe account: <strong>{settings.stripe.status}</strong>
              {settings.stripe.accountId ? ` · ${settings.stripe.accountId}` : ""}
            </p>
            <p className="notice notice--info">
              Webhook:{" "}
              <strong>{settings.readiness.webhookConfigured ? "Ready" : "Needs setup"}</strong>
            </p>
            <p className="notice notice--info">
              Organization email:{" "}
              <strong>{settings.readiness.brevoConfigured ? "Ready" : "Needs setup"}</strong>
            </p>
          </div>
          {!settings.globalPaymentsEnabled ? (
            <p className="notice notice--warning">
              Online payments are paused by the platform emergency switch or environment settings.
              You can prepare this page, but checkouts will remain unavailable until the platform
              enables them.
            </p>
          ) : null}
          <div className="form-stack">
            {paymentModules.map((module) => (
              <label className="checkbox-row" key={module.id}>
                <input
                  checked={settings.activations[module.id]}
                  disabled={busyModule !== null}
                  onChange={(event) => {
                    void toggle(module.id, event.target.checked);
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>{module.label}</strong>{" "}
                  <span className="field-help">{module.description}</span>
                </span>
              </label>
            ))}
          </div>
          <details>
            <summary>Before enabling a payment type</summary>
            <ul>
              <li>
                Complete Stripe Connect onboarding and confirm charges and payouts are enabled.
              </li>
              <li>Verify the signed Stripe webhook is pointed at the shared platform endpoint.</li>
              <li>
                Verify the Organization email sender (Cloudflare Email Sending) so paid
                confirmations can be delivered.
              </li>
              <li>Use a Stripe test-mode checkout in staging before requesting live activation.</li>
            </ul>
          </details>
        </>
      ) : null}
    </section>
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoadAttempt, setSettingsLoadAttempt] = useState(0);
  const [success, setSuccess] = useState<string | null>(null);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeSuccess, setFeeSuccess] = useState<string | null>(null);
  const [transactionFeeSettings, setTransactionFeeSettings] = useState<TransactionFeeSettings>({
    fixedCents: 30,
    passFeeToDonor: false,
    percentage: 2.9,
  });
  const [savedTransactionFeeSettings, setSavedTransactionFeeSettings] =
    useState<TransactionFeeSettings>(transactionFeeSettings);
  const [fixedFeeDraft, setFixedFeeDraft] = useState(
    currencyDraftFromCents(transactionFeeSettings.fixedCents),
  );
  const [timezone, setTimezone] = useState("UTC");
  const [savedTimezone, setSavedTimezone] = useState("UTC");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.all([
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationTransactionFeeSettings(controller.signal),
    ])
      .then(([calendarSettings, feeSettings]) => {
        setTimezone(calendarSettings.timezone);
        setSavedTimezone(calendarSettings.timezone);
        setTransactionFeeSettings(feeSettings);
        setSavedTransactionFeeSettings(feeSettings);
        setFixedFeeDraft(currencyDraftFromCents(feeSettings.fixedCents));
        setSettingsLoaded(true);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError("Organization settings could not be loaded.");
          setSettingsLoaded(false);
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, settingsLoadAttempt]);

  async function saveTimezone() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const settings = await updateOrganizationCalendarSettings(timezone);
      setTimezone(settings.timezone);
      setSavedTimezone(settings.timezone);
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
    const normalizedSettings = {
      ...transactionFeeSettings,
      fixedCents: currencyCentsFromDraft(fixedFeeDraft),
    };
    setTransactionFeeSettings(normalizedSettings);
    setFixedFeeDraft(currencyDraftFromCents(normalizedSettings.fixedCents));
    setFeeBusy(true);
    setFeeError(null);
    setFeeSuccess(null);
    try {
      const settings = await updateOrganizationTransactionFeeSettings(normalizedSettings);
      setTransactionFeeSettings(settings);
      setSavedTransactionFeeSettings(settings);
      setFixedFeeDraft(currencyDraftFromCents(settings.fixedCents));
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

  useFloatingSaveAction({
    busy,
    dirty: timezone !== savedTimezone,
    id: "organization-timezone",
    onDiscard: () => {
      setTimezone(savedTimezone);
      setSuccess(null);
    },
    onSave: saveTimezone,
  });
  useFloatingSaveAction({
    busy: feeBusy,
    dirty:
      !transactionFeeSettingsEqual(transactionFeeSettings, savedTransactionFeeSettings) ||
      currencyCentsFromDraft(fixedFeeDraft) !== savedTransactionFeeSettings.fixedCents,
    id: "organization-transaction-fees",
    onDiscard: () => {
      setTransactionFeeSettings(savedTransactionFeeSettings);
      setFixedFeeDraft(currencyDraftFromCents(savedTransactionFeeSettings.fixedCents));
      setFeeSuccess(null);
    },
    onSave: saveTransactionFees,
  });

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
      <OrganizationPaymentSettingsPanel />
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
        {settingsLoaded ? (
          <div className="form-stack settings-form">
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
                  inputMode="decimal"
                  onChange={(event) => {
                    setFixedFeeDraft(event.target.value);
                  }}
                  onBlur={() => {
                    const cents = currencyCentsFromDraft(fixedFeeDraft);
                    setFixedFeeDraft(currencyDraftFromCents(cents));
                    setTransactionFeeSettings((current) => ({ ...current, fixedCents: cents }));
                  }}
                  step="0.01"
                  type="text"
                  value={fixedFeeDraft}
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
          </div>
        ) : null}
      </section>
      <section className="surface-card" aria-labelledby="calendar-settings-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Events</p>
          <h2 id="calendar-settings-title">Calendar settings</h2>
        </div>
        {loading ? <p role="status">Loading calendar settings…</p> : null}
        {error ? (
          <div className="notice notice--error" role="alert">
            <p>{error}</p>
            {!settingsLoaded ? (
              <button
                className="button button--secondary button--sm"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setSettingsLoaded(false);
                  setSettingsLoadAttempt((current) => current + 1);
                }}
                type="button"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {success ? (
          <p className="notice notice--success" role="status">
            {success}
          </p>
        ) : null}
        {settingsLoaded ? (
          <div className="form-stack settings-form">
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
          </div>
        ) : null}
      </section>
      <OrganizationExportPanel />
    </div>
  );
}
