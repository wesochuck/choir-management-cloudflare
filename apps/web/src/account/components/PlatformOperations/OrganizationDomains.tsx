import { useState } from "react";

import {
  AuthApiError,
  disablePlatformOrganizationPublicDomain,
  listPlatformOrganizationPublicDomains,
  registerPlatformOrganizationPublicDomain,
  removePlatformOrganizationPublicDomain,
} from "../../../auth/api";
import type { OrganizationDomainsState } from "./shared";

function providerStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function PlatformOrganizationDomains({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const [hostname, setHostname] = useState("");
  const [state, setState] = useState<OrganizationDomainsState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDomains() {
    setState({ status: "loading" });
    setError(null);
    try {
      const result = await listPlatformOrganizationPublicDomains(organizationId);
      setState({ domains: result.domains, status: "ready" });
    } catch {
      setState({ status: "error" });
    }
  }

  async function registerDomain() {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized.includes(".") || normalized.length > 253) {
      setError("Enter a complete custom hostname, such as tickets.example.org.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const domain = await registerPlatformOrganizationPublicDomain(organizationId, normalized);
      setState((current) => ({
        domains:
          current.status === "ready"
            ? [...current.domains.filter((item) => item.domainId !== domain.domainId), domain]
            : [domain],
        status: "ready",
      }));
      setHostname("");
    } catch (failure: unknown) {
      setError(
        failure instanceof AuthApiError ? failure.message : "The hostname could not be registered.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disableDomain(domainId: string) {
    setBusy(true);
    setError(null);
    try {
      const domain = await disablePlatformOrganizationPublicDomain(organizationId, domainId);
      setState((current) =>
        current.status === "ready"
          ? {
              domains: current.domains.map((item) =>
                item.domainId === domain.domainId ? domain : item,
              ),
              status: "ready",
            }
          : current,
      );
    } catch (failure: unknown) {
      setError(
        failure instanceof AuthApiError ? failure.message : "The hostname could not be disabled.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeDomain(domainId: string) {
    setBusy(true);
    setError(null);
    try {
      await removePlatformOrganizationPublicDomain(organizationId, domainId);
      setState((current) =>
        current.status === "ready"
          ? {
              domains: current.domains.filter((item) => item.domainId !== domainId),
              status: "ready",
            }
          : current,
      );
    } catch (failure: unknown) {
      setError(
        failure instanceof AuthApiError ? failure.message : "The hostname could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="platform-organization-domains"
      onToggle={(event) => {
        if (event.currentTarget.open && state.status === "idle") {
          void loadDomains();
        }
      }}
    >
      <summary>Custom public domain</summary>
      <div className="platform-organization-domains__content">
        <p className="field-help">
          Register a customer-owned hostname for public pages only. It stays pending until
          Cloudflare for SaaS hostname validation and certificate activation are complete.
        </p>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {state.status === "loading" ? <p>Loading custom domains…</p> : null}
        {state.status === "error" ? (
          <p className="notice notice--error" role="alert">
            Custom domains could not be loaded. Try again.
          </p>
        ) : null}
        {state.status === "ready" && state.domains.length > 0 ? (
          <ul className="platform-domain-list">
            {state.domains.map((domain) => (
              <li key={domain.domainId}>
                <div className="platform-domain-list__details">
                  <strong>{domain.hostname}</strong>
                  <span className="platform-domain-list__statuses">
                    <span className={`status-pill status-pill--${domain.status}`}>
                      {domain.status}
                    </span>
                    <span className="field-help">
                      Provider: {providerStatusLabel(domain.providerStatus)}
                    </span>
                  </span>
                  {domain.providerError ? (
                    <span className="field-help platform-domain-list__error" role="alert">
                      {domain.providerError}
                    </span>
                  ) : null}
                  {domain.validationRecords.length > 0 ? (
                    <div className="platform-domain-list__validation">
                      <span className="field-help">
                        Add the following DNS validation record
                        {domain.validationRecords.length > 1 ? "s" : ""} before the certificate can
                        activate:
                      </span>
                      <ul>
                        {domain.validationRecords.map((record) => (
                          <li key={`${record.type}:${record.name}`}>
                            <code>{record.type.toUpperCase()}</code> {record.name} = {record.value}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="platform-domain-list__actions">
                  {domain.status !== "disabled" ? (
                    <button
                      className="button button--secondary"
                      disabled={busy}
                      onClick={() => {
                        void disableDomain(domain.domainId);
                      }}
                      type="button"
                    >
                      Disable
                    </button>
                  ) : null}
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => {
                      void removeDomain(domain.domainId);
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="platform-domain-form"
          onSubmit={(event) => {
            event.preventDefault();
            void registerDomain();
          }}
        >
          <label htmlFor={`platform-domain-${organizationId}`}>Hostname</label>
          <div className="platform-domain-form__controls">
            <input
              id={`platform-domain-${organizationId}`}
              onChange={(event) => {
                setHostname(event.target.value);
              }}
              placeholder="tickets.example.org"
              value={hostname}
            />
            <button className="button button--secondary" disabled={busy} type="submit">
              {busy ? "Saving…" : "Register hostname"}
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
