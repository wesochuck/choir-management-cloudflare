import type { PlatformSetupStatusResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getPlatformSetupStatus } from "../auth/api";

type MonitorState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly data: PlatformSetupStatusResponse; readonly status: "ready" };

function statusLabel(status: "attention" | "error" | "ok"): string {
  if (status === "ok") return "Configured";
  if (status === "attention") return "Needs attention";
  return "Unavailable";
}

function checkAction(id: string): { readonly href: string; readonly label: string } | null {
  if (id === "platform_mfa") return { href: "/platform/security", label: "Review security" };
  if (id === "background_jobs" || id === "schema") {
    return { href: "/platform/organizations", label: "Review operations" };
  }
  return null;
}

export function PlatformSetupMonitor() {
  const [state, setState] = useState<MonitorState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getPlatformSetupStatus(controller.signal)
      .then((data) => {
        setState({ data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  async function refreshStatus() {
    setState({ status: "loading" });
    try {
      setState({ data: await getPlatformSetupStatus(), status: "ready" });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <section
      className="overview-section platform-setup-monitor"
      aria-labelledby="platform-setup-title"
    >
      <div className="section-heading section-heading--compact platform-setup-monitor__heading">
        <div>
          <p className="eyebrow">Platform setup</p>
          <h2 id="platform-setup-title">Configuration & health</h2>
          <p>
            Safe checks for runtime configuration, the control plane, background work, and the
            Organization fleet. Secrets are never displayed.
          </p>
        </div>
        <button
          className="button button--secondary"
          disabled={state.status === "loading"}
          onClick={() => {
            void refreshStatus();
          }}
          type="button"
        >
          {state.status === "loading" ? "Checking…" : "Refresh status"}
        </button>
      </div>
      {state.status === "loading" ? <p role="status">Checking platform setup…</p> : null}
      {state.status === "error" ? (
        <div className="platform-setup-monitor__error" role="alert">
          <p className="notice notice--error">
            Platform setup status could not be loaded. Verify Platform Administrator MFA, then try
            again.
          </p>
          <a className="button button--secondary" href="/platform/security">
            Verify Platform MFA
          </a>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <>
          <div className="platform-setup-monitor__meta">
            <span>Environment: {state.data.environment}</span>
            <span>Build: {state.data.version}</span>
            {state.data.organizationCount === null ? null : (
              <span>Organizations: {String(state.data.organizationCount)}</span>
            )}
          </div>
          <div className="platform-setup-checks" role="list">
            {state.data.checks.map((check) => {
              const action = checkAction(check.id);
              return (
                <div className="platform-setup-check" key={check.id} role="listitem">
                  <div className="platform-setup-check__copy">
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                  </div>
                  <div className="platform-setup-check__status">
                    <span
                      className={`platform-setup-status platform-setup-status--${check.status}`}
                    >
                      {statusLabel(check.status)}
                    </span>
                    {action && check.status !== "ok" ? (
                      <a href={action.href}>{action.label}</a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <details className="platform-setup-guide">
            <summary>Stripe and Brevo setup instructions</summary>
            <div>
              <p>
                Configure these once per environment with secure Worker secrets. Organization
                administrators see the resulting health status, but never the secret values.
              </p>
              <h3>Stripe payments</h3>
              <ol>
                <li>
                  Store the Stripe platform API secret as <code>STRIPE_SECRET_KEY</code> for this
                  environment.
                </li>
                <li>
                  Point Stripe webhooks at the product webhook endpoint and store the signing secret
                  as <code>STRIPE_WEBHOOK_SECRET</code>.
                </li>
                <li>
                  Have each Organization complete Stripe Connect onboarding from Organization
                  settings.
                </li>
              </ol>
              <p className="field-help">
                This release records Organization connected-account readiness but keeps checkout in
                fake mode until live direct-charge activation and webhook routing are verified.
              </p>
              <h3>Brevo communications</h3>
              <ol>
                <li>Verify a Brevo sender/domain and create an environment-specific API key.</li>
                <li>
                  Store <code>BREVO_API_KEY</code> and <code>BREVO_EMAIL_FROM</code>; optionally add{" "}
                  <code>BREVO_EMAIL_FROM_NAME</code>.
                </li>
                <li>
                  For SMS sandbox tests, add <code>BREVO_SMS_SENDER</code> and the comma-separated{" "}
                  <code>BREVO_SMS_ALLOWED_RECIPIENTS</code> allowlist.
                </li>
                <li>
                  Use sandbox mode, then have an Organization administrator send a test email from
                  Communications → Settings.
                </li>
              </ol>
              <p className="field-help">
                Current staging checkout is simulated and Brevo sandbox email is dropped by the
                provider. A green health check means the required settings are present, not that a
                live payment or message has been sent.
              </p>
            </div>
          </details>
          <p className="field-help">
            Background job failures recorded: {String(state.data.jobDeadLetterCount ?? 0)}. This
            monitor reports platform-level signals; Organization data remains scoped to its own
            hostname.
          </p>
        </>
      ) : null}
    </section>
  );
}
