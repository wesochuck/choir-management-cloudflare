import type {
  OrganizationProviderStatusResponse,
  OrganizationStripeConnectStatusResponse,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
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
      const result = await startOrganizationStripeConnectOnboarding();
      window.location.assign(result.url);
    } catch {
      setConnectError(
        "Stripe onboarding could not be started. Ask a Platform Administrator to verify the Stripe setup.",
      );
      setConnectBusy(false);
    }
  }

  function connectStatusLabel(status: "not_started" | "onboarding" | "restricted" | "ready") {
    if (status === "ready") return "Ready";
    if (status === "restricted") return "Needs information";
    if (status === "onboarding") return "Onboarding started";
    return "Not connected";
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
            <span>External effects: {state.data.externalEffectsMode}</span>
          </div>
          <div className="provider-status-card__rows">
            <ProviderRow label="Stripe" {...state.data.stripe} />
            <ProviderRow label="Email & SMS" {...state.data.brevo} />
          </div>
          <div className="provider-status-card__connect">
            <div>
              <p className="eyebrow">Organization payments</p>
              <h3>Stripe Connect account</h3>
              {connectState.status === "loading" ? <p>Checking connected-account status…</p> : null}
              {connectState.status === "error" ? (
                <p className="notice notice--error" role="alert">
                  Connected-account status could not be loaded.
                </p>
              ) : null}
              {connectState.status === "ready" ? (
                <>
                  <p>
                    Each Organization uses its own Stripe connected account. Stripe handles the
                    identity and payout details; this app stores only the account ID and readiness
                    state.
                  </p>
                  <p className="field-help">
                    Status: <strong>{connectStatusLabel(connectState.data.stripe.status)}</strong>
                    {connectState.data.stripe.accountId
                      ? ` · ${connectState.data.stripe.accountId}`
                      : ""}
                  </p>
                  {connectState.data.stripe.requirementsDue.length > 0 ? (
                    <p className="field-help">
                      Stripe still needs {connectState.data.stripe.requirementsDue.length} item(s)
                      before payments can be enabled.
                    </p>
                  ) : null}
                  {connectError ? (
                    <p className="notice notice--error" role="alert">
                      {connectError}
                    </p>
                  ) : null}
                  <button
                    className="button button--secondary"
                    disabled={!connectState.data.platformConfigured || connectBusy}
                    onClick={() => {
                      void beginConnectOnboarding();
                    }}
                    type="button"
                  >
                    {connectBusy
                      ? "Opening Stripe…"
                      : connectState.data.stripe.status === "not_started"
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
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      <details className="provider-status-card__guide">
        <summary>How platform setup works</summary>
        <div>
          <p>
            These values are Worker secrets and environment settings, not Organization form fields.
            Never paste secret values into support messages or Organization settings.
          </p>
          <h3>Stripe</h3>
          <ol>
            <li>
              The Platform Administrator stores the Stripe platform API secret as{" "}
              <code>STRIPE_SECRET_KEY</code>.
            </li>
            <li>
              Point Stripe webhooks at the product webhook endpoint and store its signing secret as{" "}
              <code>STRIPE_WEBHOOK_SECRET</code>.
            </li>
            <li>Have each Organization owner complete the Stripe Connect onboarding card above.</li>
          </ol>
          <p className="field-help">
            Connected-account readiness is recorded here. Use Organization Settings → Payments to
            review the checklist and enable each direct-charge payment type separately after the
            staging test-mode checkout and webhook verification pass.
          </p>
          <h3>Email &amp; SMS</h3>
          <ol>
            <li>
              Email sends through the Cloudflare Email Sending binding. Configure the{" "}
              <code>PLATFORM_EMAIL</code> binding, a <code>PLATFORM_EMAIL_FROM</code> sender, and
              the comma-separated <code>PLATFORM_EMAIL_ALLOWED_RECIPIENTS</code> allowlist.
            </li>
            <li>
              For SMS testing only, configure the Brevo <code>BREVO_API_KEY</code>,{" "}
              <code>BREVO_SMS_SENDER</code>, and the comma-separated{" "}
              <code>BREVO_SMS_ALLOWED_RECIPIENTS</code> allowlist.
            </li>
            <li>
              Use sandbox mode and the Communications → Settings test email before enabling live
              external effects.
            </li>
          </ol>
          <p className="field-help">No secret values are returned by the status check.</p>
        </div>
      </details>
    </section>
  );
}
