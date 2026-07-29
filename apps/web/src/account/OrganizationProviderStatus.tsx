import type { OrganizationProviderStatusResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getOrganizationProviderStatus } from "../auth/api";

type ProviderStatusState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly data: OrganizationProviderStatusResponse; readonly status: "ready" };

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

  useEffect(() => {
    const controller = new AbortController();
    getOrganizationProviderStatus(controller.signal)
      .then((data) => {
        setState({ data, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, []);

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
            <ProviderRow label="Brevo" {...state.data.brevo} />
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
              Create the Stripe platform and connected-account configuration for the environment.
            </li>
            <li>
              Point Stripe webhooks at the product webhook endpoint and store its signing secret as{" "}
              <code>STRIPE_WEBHOOK_SECRET</code>.
            </li>
            <li>
              Keep checkout in fake mode until live Stripe Connect activation has been completed and
              verified.
            </li>
          </ol>
          <p className="field-help">
            The current build does not onboard an Organization&apos;s connected account or create
            live direct charges yet; a webhook secret alone is not payment activation.
          </p>
          <h3>Brevo</h3>
          <ol>
            <li>Verify the sender/domain in Brevo and create an API key for the environment.</li>
            <li>
              Store <code>BREVO_API_KEY</code> and <code>BREVO_EMAIL_FROM</code>; add{" "}
              <code>BREVO_EMAIL_FROM_NAME</code> for the sender name.
            </li>
            <li>
              For SMS testing only, also configure <code>BREVO_SMS_SENDER</code> and the
              comma-separated <code>BREVO_SMS_ALLOWED_RECIPIENTS</code> allowlist.
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
