import type {
  OrganizationProviderStatusResponse,
  OrganizationStripeConnectStatusResponse,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  getOrganizationProviderStatus,
  getOrganizationStripeConnectStatus,
  startOrganizationStripeConnectOnboarding,
} from "../auth/api";

type ProviderStatusState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly data: OrganizationProviderStatusResponse; readonly status: "ready" };

type ConnectStatusState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly data: OrganizationStripeConnectStatusResponse; readonly status: "ready" };

function statusLabel(status: "attention" | "error" | "ok"): string {
  if (status === "ok") return "Configured";
  if (status === "attention") return "Needs attention";
  return "Not configured";
}

function ProviderRow({
  detail,
  label,
  status,
}: {
  readonly detail: string;
  readonly label: string;
  readonly status: "attention" | "error" | "ok";
}) {
  return (
    <div className="provider-status-card__row">
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
      <span className={`platform-setup-status platform-setup-status--${status}`}>
        {statusLabel(status)}
      </span>
    </div>
  );
}

function deliveryStatusLabel(environment: string, externalEffectsMode: string): string {
  if (environment === "production") return "Live";
  if (externalEffectsMode === "fake") return "Simulated";
  if (externalEffectsMode === "disabled") return "Disabled";
  return "Staging sandbox";
}

function connectStatusLabel(status: "not_started" | "onboarding" | "restricted" | "ready"): string {
  if (status === "ready") return "Ready";
  if (status === "restricted") return "Needs information";
  if (status === "onboarding") return "Onboarding started";
  return "Not connected";
}

function StripeConnectAccountDetails({
  beginConnectOnboarding,
  connectBusy,
  connectError,
  connectState,
}: {
  readonly beginConnectOnboarding: () => void;
  readonly connectBusy: boolean;
  readonly connectError: string | null;
  readonly connectState: ConnectStatusState;
}) {
  if (connectState.status === "loading") return <p>Checking connected-account status…</p>;
  if (connectState.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Connected-account status could not be loaded.
      </p>
    );
  }
  const stripe = connectState.data.stripe;
  return (
    <>
      <p>
        Each Organization uses its own Stripe connected account. Stripe handles the identity and
        payout details; this app stores only the account ID and readiness state.
      </p>
      <p className="field-help">
        Status: <strong>{connectStatusLabel(stripe.status)}</strong>
        {stripe.accountId ? ` · ${stripe.accountId}` : ""}
      </p>
      {stripe.requirementsDue.length > 0 ? (
        <p className="field-help">
          Stripe still needs {stripe.requirementsDue.length} item(s) before payments can be enabled.
        </p>
      ) : null}
      {stripe.status === "ready" ? (
        <p className="field-help">Stripe Connect is ready for payments.</p>
      ) : (
        <>
          {connectError ? (
            <p className="notice notice--error" role="alert">
              {connectError}
            </p>
          ) : null}
          <button
            className="button button--secondary"
            disabled={!connectState.data.platformConfigured || connectBusy}
            onClick={beginConnectOnboarding}
            type="button"
          >
            {connectBusy
              ? "Opening Stripe…"
              : stripe.status === "not_started"
                ? "Connect Stripe account"
                : "Continue Stripe onboarding"}
          </button>
          {!connectState.data.platformConfigured ? (
            <p className="field-help">
              A Platform Administrator must configure the Stripe platform key before this
              Organization can connect.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

export function OrganizationProviderStatus() {
  const [state, setState] = useState<ProviderStatusState>({ status: "loading" });
  const [connectState, setConnectState] = useState<ConnectStatusState>({ status: "loading" });
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getOrganizationProviderStatus(controller.signal),
      getOrganizationStripeConnectStatus(controller.signal),
    ])
      .then(([data, connect]) => {
        setState({ data, status: "ready" });
        setConnectState({ data: connect, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
          setConnectState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  async function beginConnectOnboarding() {
    setConnectBusy(true);
    setConnectError(null);
    try {
      const latest = await getOrganizationStripeConnectStatus();
      setConnectState({ data: latest, status: "ready" });
      if (latest.stripe.status === "ready") return;

      const result = await startOrganizationStripeConnectOnboarding();
      window.location.assign(result.url);
    } catch (error: unknown) {
      if (error instanceof AuthApiError && error.status === 409) {
        try {
          const latest = await getOrganizationStripeConnectStatus();
          setConnectState({ data: latest, status: "ready" });
          if (latest.stripe.status === "ready") return;
        } catch {
          // Fall through to error below.
        }
      }
      setConnectError(
        "Stripe onboarding could not be started. Ask a Platform Administrator to verify the Stripe setup.",
      );
      setConnectBusy(false);
    }
  }

  return (
    <section className="surface-card provider-status-card" aria-labelledby="provider-status-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Platform-managed services</p>
        <h2 id="provider-status-title">Payments and email setup</h2>
        <p className="section-description">
          Provider credentials are configured once by a Platform Administrator for each environment;
          Organization admins do not enter or store provider secrets here.
        </p>
      </div>
      {state.status === "loading" ? <p role="status">Checking provider setup…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Provider setup status could not be loaded. Ask a Platform Administrator to verify the
          environment configuration.
        </p>
      ) : null}
      {state.status === "ready" ? (
        <>
          <div className="provider-status-card__meta">
            <span>Environment: {state.data.environment}</span>
            <span>
              Delivery:{" "}
              {deliveryStatusLabel(state.data.environment, state.data.externalEffectsMode)}
            </span>
          </div>
          <div className="provider-status-card__rows">
            <ProviderRow label="Stripe" {...state.data.stripe} />
            <ProviderRow label="Email & SMS" {...state.data.brevo} />
          </div>
          <div className="provider-status-card__connect">
            <div>
              <p className="eyebrow">Organization payments</p>
              <h3>Stripe Connect account</h3>
              <StripeConnectAccountDetails
                beginConnectOnboarding={() => {
                  void beginConnectOnboarding();
                }}
                connectBusy={connectBusy}
                connectError={connectError}
                connectState={connectState}
              />
            </div>
          </div>
        </>
      ) : null}
      <p className="notice notice--info">
        <strong>Platform-managed setup:</strong> Provider credentials and environment settings are
        managed by a Platform Administrator. Organization admins cannot edit them here. If Stripe or
        Email &amp; SMS shows “Needs attention” or “Not configured,” contact your Platform
        Administrator. Organization-specific Stripe Connect onboarding is handled above.
      </p>
    </section>
  );
}
