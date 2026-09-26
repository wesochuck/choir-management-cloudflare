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
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { OrganizationBrandingPanel } from "./OrganizationBrandingPanel";
import { OrganizationEmailSettingsPanel } from "./OrganizationEmailSettingsPanel";
import type {
  OrganizationExportStatusResponse,
  OrganizationPaymentSettingsResponse,
  TransactionFeeSettings,
} from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { useConfirmation } from "@choir/ui";
import { usePersistedDraft } from "../persistence";

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
  const { confirm, confirmationDialog } = useConfirmation();
  const stripeResult =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("stripe");

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

  async function requestToggle(
    moduleId: (typeof paymentModules)[number]["id"],
    enabled: boolean,
  ): Promise<void> {
    if (
      enabled &&
      !(await confirm({
        description: "Review the readiness checklist before enabling online payment collection.",
        title: "Enable online payments?",
      }))
    ) {
      return;
    }
    await toggle(moduleId, enabled);
  }

  return (
    <fieldset className="surface-card organization-settings-panel" id="payments-settings">
      <legend id="payments-settings-title">Online payment settings</legend>
      <div className="section-heading section-heading--compact organization-payment-settings__heading">
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
      {stripeResult === "return" ? (
        <p className="notice notice--success" role="status">
          Stripe Connect returned from onboarding. The connected-account status below has been
          refreshed.
        </p>
      ) : null}
      {stripeResult === "refresh" ? (
        <p className="notice notice--warning" role="alert">
          The Stripe onboarding link needs to be refreshed. Use the setup checklist below to reopen
          the Organization&apos;s setup flow.
          <br />
          <a href="/admin/settings/setup-checklist?stripe=refresh#provider-status-title">
            Open Stripe setup checklist
          </a>
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
          {settings.stripe.status !== "ready" ? (
            <p className="field-help">
              <a href="/admin/settings/setup-checklist#provider-status-title">
                Open the Stripe Connect setup checklist
              </a>{" "}
              to connect or continue this Organization&apos;s account.
            </p>
          ) : null}
          {!settings.globalPaymentsEnabled ? (
            <p className="notice notice--warning" role="status">
              Online payments are paused by the platform emergency switch or environment settings.
              You can prepare this page, but checkouts will remain unavailable until the platform
              enables them.
            </p>
          ) : null}
          <div className="form-stack">
            {paymentModules.map((module) => (
              <label className="choice-field" key={module.id}>
                <input
                  checked={settings.activations[module.id]}
                  disabled={busyModule !== null}
                  onChange={(event) => {
                    void requestToggle(module.id, event.target.checked);
                  }}
                  type="checkbox"
                />
                <span className="choice-field__content">
                  <strong className="choice-field__title">{module.label}</strong>
                  <span className="choice-field__description">{module.description}</span>
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
      {confirmationDialog}
    </fieldset>
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
    <fieldset className="surface-card organization-settings-panel">
      <legend id="organization-export-title">Export Organization data</legend>
      <div className="section-heading section-heading--compact">
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
    </fieldset>
  );
}

function TransactionFeeSettingsSection({
  feeError,
  feeSuccess,
  fixedFeeDraft,
  setFixedFeeDraft,
  setTransactionFeeSettings,
  settingsLoaded,
  transactionFeeSettings,
}: {
  readonly feeError: string | null;
  readonly feeSuccess: string | null;
  readonly fixedFeeDraft: string;
  readonly setFixedFeeDraft: (val: string) => void;
  readonly setTransactionFeeSettings: (
    updater: TransactionFeeSettings | ((current: TransactionFeeSettings) => TransactionFeeSettings),
  ) => void;
  readonly settingsLoaded: boolean;
  readonly transactionFeeSettings: TransactionFeeSettings | null;
}) {
  const currentFeeSettings: TransactionFeeSettings = transactionFeeSettings ?? {
    fixedCents: 30,
    passFeeToDonor: false,
    percentage: 2.9,
  };
  const exampleFeeCents = transactionProcessingFeeCents(1_000, currentFeeSettings);
  const examplePayerTotalCents = 1_000 + exampleFeeCents;

  return (
    <fieldset className="surface-card organization-settings-panel">
      <legend id="transaction-fee-settings-title">Transaction processing fees</legend>
      <div className="section-heading section-heading--compact">
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
      {settingsLoaded && transactionFeeSettings ? (
        <div className="form-stack settings-form">
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="transaction-fee-percentage">Percentage (%)</label>
              <input
                id="transaction-fee-percentage"
                max="99.99"
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
            </div>
            <div className="field">
              <label htmlFor="transaction-fee-fixed">Fixed fee (USD)</label>
              <input
                id="transaction-fee-fixed"
                inputMode="decimal"
                onBlur={() => {
                  const cents = currencyCentsFromDraft(fixedFeeDraft);
                  setFixedFeeDraft(currencyDraftFromCents(cents));
                  setTransactionFeeSettings((current) => ({
                    ...current,
                    fixedCents: cents,
                  }));
                }}
                onChange={(event) => {
                  setFixedFeeDraft(event.target.value);
                }}
                step="0.01"
                type="text"
                value={fixedFeeDraft}
              />
            </div>
          </div>
          <label className="choice-field">
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
            <span className="choice-field__content">Pass the processing fee through to donors</span>
          </label>
          <p className="notice notice--info">
            On a $10.00 base amount, the grossed-up processing fee is {money(exampleFeeCents)}, for
            a payer total of {money(examplePayerTotalCents)}. This calculation accounts for the fee
            Stripe charges on the processing-fee portion itself so the Organization nets the full
            $10.00. Tickets, ticket bundles, and dues always add this fee; donations add it only
            when pass-through is enabled.
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

export function OrganizationSettingsPage({ enabled }: { readonly enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoadAttempt, setSettingsLoadAttempt] = useState(0);
  const [success, setSuccess] = useState<string | null>(null);
  const [feeSuccess, setFeeSuccess] = useState<string | null>(null);

  const [initialTimezone, setInitialTimezone] = useState<string | null>(null);
  const [initialFeeSettings, setInitialFeeSettings] = useState<TransactionFeeSettings | null>(null);
  const [fixedFeeDraft, setFixedFeeDraft] = useState("0.30");

  const {
    draft: timezone,
    error: timezoneError,
    setDraft: setTimezone,
  } = usePersistedDraft<string>({
    initialValue: initialTimezone,
    onSaveSuccess: () => {
      setSuccess("Organization timezone updated.");
    },
    resourceKey: "organization-timezone",
    save: async (nextTz) => (await updateOrganizationCalendarSettings(nextTz)).timezone,
  });

  const {
    draft: transactionFeeSettings,
    error: feeError,
    setDraft: setTransactionFeeSettings,
  } = usePersistedDraft<TransactionFeeSettings>({
    equals: transactionFeeSettingsEqual,
    initialValue: initialFeeSettings,
    onSaveSuccess: (saved) => {
      setFixedFeeDraft(currencyDraftFromCents(saved.fixedCents));
      setFeeSuccess("Transaction fee settings updated.");
    },
    resourceKey: "organization-transaction-fees",
    save: (nextFees) => updateOrganizationTransactionFeeSettings(nextFees),
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.all([
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationTransactionFeeSettings(controller.signal),
    ])
      .then(([calendarSettings, feeSettings]) => {
        setInitialTimezone(calendarSettings.timezone);
        setInitialFeeSettings(feeSettings);
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

  const effectiveError = error ?? timezoneError;

  if (!enabled) {
    return (
      <OrganizationMfaPrompt message="Verify Organization MFA to change Organization settings." />
    );
  }

  return (
    <div className="settings-stack">
      <OrganizationBrandingPanel />
      <OrganizationPaymentSettingsPanel />
      <TransactionFeeSettingsSection
        feeError={feeError}
        feeSuccess={feeSuccess}
        fixedFeeDraft={fixedFeeDraft}
        setFixedFeeDraft={setFixedFeeDraft}
        setTransactionFeeSettings={setTransactionFeeSettings}
        settingsLoaded={settingsLoaded}
        transactionFeeSettings={transactionFeeSettings}
      />
      <fieldset className="surface-card organization-settings-panel">
        <legend id="calendar-settings-title">Calendar settings</legend>
        {loading ? <p role="status">Loading calendar settings…</p> : null}
        {effectiveError ? (
          <div className="notice notice--error" role="alert">
            <p>{effectiveError}</p>
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
        {settingsLoaded && timezone ? (
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
      </fieldset>
      <OrganizationEmailSettingsPanel />
      <OrganizationExportPanel />
    </div>
  );
}
