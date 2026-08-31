import type { PublicDomainResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

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

function PlatformDomainSummaryHeader({
  domains,
  status,
}: {
  readonly domains: readonly PublicDomainResponse[] | null;
  readonly status: OrganizationDomainsState["status"];
}) {
  const primaryDomain = domains && domains.length > 0 ? domains[0] : null;
  const hasDomains = Boolean(primaryDomain);

  return (
    <summary className="platform-organization-domains__summary">
      <div className="platform-organization-domains__header">
        <span className="platform-organization-domains__label">Custom domain</span>
        {status === "loading" ? (
          <span className="platform-organization-domains__status-text">Loading…</span>
        ) : null}
        {status === "error" ? (
          <span className="platform-organization-domains__status-text platform-domain-list__error">
            Unable to load
          </span>
        ) : null}
        {status === "ready" && !primaryDomain ? (
          <span className="platform-organization-domains__empty">None configured</span>
        ) : null}
        {primaryDomain && domains ? (
          <div className="platform-organization-domains__preview">
            <strong className="platform-organization-domains__hostname">
              {primaryDomain.hostname}
            </strong>
            <span className={`status-pill status-pill--${primaryDomain.status}`}>
              {primaryDomain.status}
            </span>
            {domains.length > 1 ? (
              <span className="platform-organization-domains__more-count">
                +{domains.length - 1} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="platform-organization-domains__toggle-btn" aria-hidden="true">
        {hasDomains ? "Manage" : "Configure"}
        <svg
          className="platform-organization-domains__chevron"
          fill="currentColor"
          height="14"
          viewBox="0 0 20 20"
          width="14"
        >
          <path
            clipRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            fillRule="evenodd"
          />
        </svg>
      </span>
    </summary>
  );
}

function PlatformDomainItem({
  busy,
  domain,
  onDisable,
  onRemove,
}: {
  readonly busy: boolean;
  readonly domain: PublicDomainResponse;
  readonly onDisable: (domainId: string) => void;
  readonly onRemove: (domainId: string) => void;
}) {
  return (
    <li>
      <div className="platform-domain-list__details">
        <strong>{domain.hostname}</strong>
        <span className="platform-domain-list__statuses">
          <span className={`status-pill status-pill--${domain.status}`}>{domain.status}</span>
          <span className="field-help">Provider: {providerStatusLabel(domain.providerStatus)}</span>
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
              {domain.validationRecords.length > 1 ? "s" : ""} before the certificate can activate:
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
              onDisable(domain.domainId);
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
            onRemove(domain.domainId);
          }}
          type="button"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

export function PlatformOrganizationDomains({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const [hostname, setHostname] = useState("");
  const [state, setState] = useState<OrganizationDomainsState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listPlatformOrganizationPublicDomains(organizationId)
      .then((result) => {
        if (active) {
          setState({ domains: result.domains, status: "ready" });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "error" });
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

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

  const domains = state.status === "ready" ? state.domains : null;

  return (
    <details className="platform-organization-domains">
      <PlatformDomainSummaryHeader domains={domains} status={state.status} />
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
          <div className="platform-organization-domains__error-retry">
            <p className="notice notice--error" role="alert">
              Custom domains could not be loaded.
            </p>
            <button
              className="button button--secondary"
              onClick={() => {
                void loadDomains();
              }}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}
        {domains && domains.length > 0 ? (
          <ul className="platform-domain-list">
            {domains.map((domain) => (
              <PlatformDomainItem
                busy={busy}
                domain={domain}
                key={domain.domainId}
                onDisable={(domainId) => {
                  void disableDomain(domainId);
                }}
                onRemove={(domainId) => {
                  void removeDomain(domainId);
                }}
              />
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
