import type {
  PlatformContextResponse,
  PlatformFleetSchemaStatusResponse,
  PlatformJobDeadLetterActionRequest,
  PlatformJobDeadLetterSummary,
  PlatformOrganizationContextResponse,
  PublicDomainResponse,
  PlatformOrganizationSummary,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  actOnPlatformJobDeadLetter,
  createPlatformElevation,
  getPlatformOrganizationContext,
  getPlatformFleetSchemaStatus,
  disablePlatformOrganizationPublicDomain,
  listPlatformOrganizationPublicDomains,
  listPlatformJobDeadLetters,
  listPlatformOrganizations,
  provisionOrganization,
  registerPlatformOrganizationPublicDomain,
  revokePlatformElevation,
  startPlatformFleetSchemaPreparation,
} from "../auth/api";

type PlatformScope = PlatformContextResponse["scope"];

type DirectoryState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly nextCursor: string | null;
      readonly organizations: readonly PlatformOrganizationSummary[];
      readonly status: "ready";
    };

type DeadLetterState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly deadLetters: readonly PlatformJobDeadLetterSummary[];
      readonly nextCursor: string | null;
      readonly status: "ready";
    };

type DeadLetterAction = PlatformJobDeadLetterActionRequest["action"];

type FleetSchemaState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly result: PlatformFleetSchemaStatusResponse; readonly status: "ready" };

type ElevationState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly context: PlatformOrganizationContextResponse; readonly status: "ready" };

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function schemaStatusMessage(state: FleetSchemaState, running: boolean, upToDate: boolean): string {
  if (state.status !== "ready") return "";
  if (upToDate) {
    return "No action is needed. The latest completed run matches the deployed schema, and new Organizations are prepared automatically.";
  }
  if (running) {
    return "Preparation is in progress. Wait for it to finish before starting another run.";
  }
  if (state.result.preparation?.status === "failed") {
    return "The last preparation did not finish. Review the failure before retrying.";
  }
  return "Run preparation only after a schema-changing deployment requires existing Organizations to be upgraded.";
}

function schemaButtonLabel(state: FleetSchemaState, busy: boolean, running: boolean): string {
  if (busy) return "Starting preparation…";
  if (running) return "Preparation running";
  if (state.status === "ready" && state.result.preparation?.status === "failed") {
    return "Retry preparation";
  }
  return "Prepare schemas";
}

function organizationHref(hostname: string): string {
  const protocol = hostname === "localhost" || hostname.endsWith(".localhost") ? "http:" : "https:";
  return `${protocol}//${hostname}/account`;
}

function organizationAccessHref(hostname: string): string {
  const protocol = hostname === "localhost" || hostname.endsWith(".localhost") ? "http:" : "https:";
  return `${protocol}//${hostname}/platform/access`;
}

function platformControlPlaneHref(pathname: string): string {
  const { hostname, port, protocol } = window.location;
  const isIpv4Address = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  const baseHostname = hostname.endsWith(".localhost")
    ? "localhost"
    : hostname === "localhost" || isIpv4Address
      ? hostname
      : hostname.split(".").slice(1).join(".");
  const authority = baseHostname === "localhost" && port ? `${baseHostname}:${port}` : baseHostname;
  return `${protocol}//${authority}${pathname}`;
}

function platformOrganizationsHref(): string {
  return platformControlPlaneHref("/platform/organizations");
}

function platformQueueFailuresHref(): string {
  return platformControlPlaneHref("/platform/queue-failures");
}

function organizationStatus(organization: PlatformOrganizationSummary): string {
  if (organization.lifecycleState === "suspended") {
    return "Suspended";
  }
  if (organization.lifecycleState !== "active") {
    return "Provisioning";
  }
  if (organization.canonicalStatus !== "active") {
    return "Hostname setup pending";
  }
  return "Ready";
}

type OrganizationDomainsState =
  | { readonly status: "idle" }
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly domains: readonly PublicDomainResponse[]; readonly status: "ready" };

function PlatformOrganizationDomains({ organizationId }: { readonly organizationId: string }) {
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
                <span>
                  <strong>{domain.hostname}</strong>
                  <span className={`status-pill status-pill--${domain.status}`}>
                    {domain.status}
                  </span>
                </span>
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
              autoCapitalize="none"
              autoComplete="off"
              id={`platform-domain-${organizationId}`}
              inputMode="url"
              onChange={(event) => {
                setHostname(event.target.value);
              }}
              placeholder="tickets.example.org"
              spellCheck={false}
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

function queueFailureStatusLabel(status: PlatformJobDeadLetterSummary["resolutionStatus"]): string {
  switch (status) {
    case "ignored":
      return "Ignored";
    case "resolved":
      return "Resolved";
    case "retry_queued":
      return "Retry queued";
    case "open":
      return "Needs attention";
  }
}

function QueueFailuresDirectory() {
  const [deadLetters, setDeadLetters] = useState<DeadLetterState>({ status: "loading" });
  const [actionBusy, setActionBusy] = useState<Record<string, DeadLetterAction | undefined>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({});
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notes, setNotes] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    const abortController = new AbortController();
    listPlatformJobDeadLetters(null, abortController.signal)
      .then((result) => {
        setDeadLetters({
          deadLetters: result.deadLetters,
          nextCursor: result.nextCursor,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setDeadLetters({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function loadMore() {
    if (deadLetters.status !== "ready" || !deadLetters.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setListError(null);
    try {
      const result = await listPlatformJobDeadLetters(deadLetters.nextCursor);
      setDeadLetters((current) =>
        current.status === "ready"
          ? {
              deadLetters: [...current.deadLetters, ...result.deadLetters],
              nextCursor: result.nextCursor,
              status: "ready",
            }
          : current,
      );
    } catch {
      setListError("More queue failures could not be loaded. Refresh and try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function act(deadLetter: PlatformJobDeadLetterSummary, action: DeadLetterAction) {
    const note = notes[deadLetter.id]?.trim() ?? "";
    if (note.length < 3) {
      setActionErrors((current) => ({
        ...current,
        [deadLetter.id]: "Add a short operator note before recording this action.",
      }));
      return;
    }
    setActionErrors((current) => ({ ...current, [deadLetter.id]: undefined }));
    setActionBusy((current) => ({ ...current, [deadLetter.id]: action }));
    try {
      const result = await actOnPlatformJobDeadLetter(deadLetter.id, { action, note });
      setDeadLetters((current) =>
        current.status === "ready"
          ? {
              ...current,
              deadLetters: current.deadLetters.map((item) =>
                item.id === result.deadLetter.id ? result.deadLetter : item,
              ),
            }
          : current,
      );
    } catch (error: unknown) {
      setActionErrors((current) => ({
        ...current,
        [deadLetter.id]:
          error instanceof AuthApiError
            ? error.message
            : "The queue failure action could not be completed. Refresh and try again.",
      }));
    } finally {
      setActionBusy((current) => ({ ...current, [deadLetter.id]: undefined }));
    }
  }

  return (
    <div className="platform-directory platform-queue-failures" aria-live="polite">
      <div className="section-heading section-heading--nested">
        <h4>Queue failures</h4>
        <p>
          These are background jobs that exhausted their automatic retries. Fix the underlying
          provider or configuration issue, then retry the stored Organization job. The original
          idempotency key is preserved, and message payloads are never copied into the control
          plane.
        </p>
      </div>
      {deadLetters.status === "loading" ? <p>Loading queue failures…</p> : null}
      {deadLetters.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Queue failures could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.deadLetters.length === 0 ? (
        <p className="empty-state">No queue failures need attention.</p>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.deadLetters.length > 0 ? (
        <ul className="account-list platform-queue-failure-list">
          {/* eslint-disable-next-line complexity -- renders independent metadata and action states for each queue failure. */}
          {deadLetters.deadLetters.map((deadLetter) => {
            const closed =
              deadLetter.resolutionStatus === "resolved" ||
              deadLetter.resolutionStatus === "ignored";
            const retryable =
              deadLetter.messageValid &&
              deadLetter.organizationId !== null &&
              deadLetter.jobId !== null;
            return (
              <li className="platform-queue-failure" key={deadLetter.id}>
                <div className="platform-queue-failure__header">
                  <div>
                    <p className="eyebrow">{deadLetter.jobKind ?? "Invalid queue message"}</p>
                    <h5>
                      {deadLetter.organizationName ??
                        deadLetter.organizationId ??
                        "No validated Organization"}
                    </h5>
                    <p>
                      Observed {displayDate(deadLetter.lastSeenAt)} ·{" "}
                      {deadLetter.observationCount === 1
                        ? "recorded once"
                        : `recorded ${String(deadLetter.observationCount)} times`}
                    </p>
                  </div>
                  <span className={`status-pill status-pill--${deadLetter.resolutionStatus}`}>
                    {queueFailureStatusLabel(deadLetter.resolutionStatus)}
                  </span>
                </div>
                <dl className="platform-queue-failure__metadata">
                  <div>
                    <dt>Organization</dt>
                    <dd>
                      {deadLetter.organizationHostname ? (
                        <a href={organizationAccessHref(deadLetter.organizationHostname)}>
                          {deadLetter.organizationHostname}
                        </a>
                      ) : (
                        "Not available"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Queue</dt>
                    <dd>
                      <code>{deadLetter.queueName}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Attempt</dt>
                    <dd>{String(deadLetter.observedAttempt)}</dd>
                  </div>
                  <div>
                    <dt>Message ID</dt>
                    <dd>
                      <code>{deadLetter.messageId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Stable job key</dt>
                    <dd>
                      <code>{deadLetter.idempotencyKey ?? "Unavailable"}</code>
                    </dd>
                  </div>
                </dl>
                {deadLetter.resolutionStatus === "retry_queued" ? (
                  <p className="field-help">
                    Retry was queued with the same job identity. Verify the source result before
                    marking this record resolved.
                  </p>
                ) : null}
                {closed ? (
                  <p className="field-help">
                    {deadLetter.resolutionNote || "No operator note was recorded."}
                  </p>
                ) : (
                  <div className="platform-queue-failure__actions">
                    <div className="field">
                      <label htmlFor={`queue-failure-note-${deadLetter.id}`}>Operator note</label>
                      <textarea
                        id={`queue-failure-note-${deadLetter.id}`}
                        maxLength={500}
                        onChange={(event) => {
                          setNotes((current) => ({
                            ...current,
                            [deadLetter.id]: event.target.value,
                          }));
                        }}
                        placeholder="What was checked or changed?"
                        rows={2}
                        value={notes[deadLetter.id] ?? ""}
                      />
                    </div>
                    <div className="platform-queue-failure__buttons">
                      {deadLetter.resolutionStatus === "open" ? (
                        <button
                          className="button button--primary"
                          disabled={actionBusy[deadLetter.id] !== undefined || !retryable}
                          onClick={() => {
                            void act(deadLetter, "retry");
                          }}
                          type="button"
                        >
                          {actionBusy[deadLetter.id] === "retry" ? "Queueing retry…" : "Retry job"}
                        </button>
                      ) : null}
                      <button
                        className="button button--secondary"
                        disabled={actionBusy[deadLetter.id] !== undefined}
                        onClick={() => {
                          void act(deadLetter, "resolve");
                        }}
                        type="button"
                      >
                        {actionBusy[deadLetter.id] === "resolve" ? "Saving…" : "Mark resolved"}
                      </button>
                      <button
                        className="button button--danger"
                        disabled={actionBusy[deadLetter.id] !== undefined}
                        onClick={() => {
                          void act(deadLetter, "ignore");
                        }}
                        type="button"
                      >
                        {actionBusy[deadLetter.id] === "ignore" ? "Saving…" : "Ignore"}
                      </button>
                    </div>
                  </div>
                )}
                {actionErrors[deadLetter.id] ? (
                  <p className="notice notice--error" role="alert">
                    {actionErrors[deadLetter.id]}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.nextCursor ? (
        <button
          className="button button--secondary platform-load-more"
          disabled={loadingMore}
          onClick={() => {
            void loadMore();
          }}
          type="button"
        >
          {loadingMore ? "Loading…" : "Load more queue failures"}
        </button>
      ) : null}
      {listError ? (
        <p className="notice notice--error" role="alert">
          {listError}
        </p>
      ) : null}
    </div>
  );
}

function FleetSchemaPreparation() {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<FleetSchemaState>({ status: "loading" });

  useEffect(() => {
    const abortController = new AbortController();
    getPlatformFleetSchemaStatus(abortController.signal)
      .then((result) => {
        setState({ result, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function startPreparation() {
    setBusy(true);
    try {
      setState({ result: await startPlatformFleetSchemaPreparation(), status: "ready" });
    } catch {
      setState({ status: "error" });
    } finally {
      setBusy(false);
    }
  }

  const running = state.status === "ready" && state.result.preparation?.status === "running";
  const upToDate =
    state.status === "ready" &&
    state.result.preparation?.status === "completed" &&
    state.result.preparation.targetVersion >= state.result.currentVersion;
  return (
    <div className="platform-directory" aria-live="polite">
      <h4>Organization schema preparation</h4>
      <p>
        This is an operator-only migration step for a deployed schema change. New Organizations are
        initialized automatically; routine Organization setup does not require this action.
      </p>
      {state.status === "loading" ? <p>Loading schema preparation status…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Schema preparation status could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {state.status === "ready" ? (
        <>
          <p>
            Deployed schema version: {String(state.result.currentVersion)}.{" "}
            {state.result.preparation
              ? `Latest run: ${state.result.preparation.status}; ${String(state.result.preparation.processedCount)} Organizations prepared.`
              : "No fleet preparation has run yet."}
          </p>
          <p className="notice notice--info">{schemaStatusMessage(state, running, upToDate)}</p>
        </>
      ) : null}
      {state.status === "ready" && upToDate ? (
        <span className="status-pill platform-schema-status">All Organizations prepared</span>
      ) : (
        <button
          className="button button--secondary"
          disabled={busy || running || state.status === "loading"}
          onClick={() => {
            void startPreparation();
          }}
          type="button"
        >
          {schemaButtonLabel(state, busy, running)}
        </button>
      )}
    </div>
  );
}

function OrganizationDirectory() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    listPlatformOrganizations(null, abortController.signal)
      .then((result) => {
        setDirectory({
          nextCursor: result.nextCursor,
          organizations: result.organizations,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setDirectory({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function loadMore() {
    if (directory.status !== "ready" || !directory.nextCursor) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await listPlatformOrganizations(directory.nextCursor);
      setDirectory({
        nextCursor: result.nextCursor,
        organizations: [...directory.organizations, ...result.organizations],
        status: "ready",
      });
    } catch {
      setActionError("More Organizations could not be loaded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrganization() {
    const normalizedName = name.trim();
    const normalizedSlug = slug.trim().toLowerCase();
    if (!normalizedName || normalizedName.length > 120) {
      setActionError("Enter an Organization name of at most 120 characters.");
      return;
    }
    if (
      normalizedSlug.length < 2 ||
      normalizedSlug.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalizedSlug)
    ) {
      setActionError(
        "Use 2–63 lowercase letters, numbers, or interior hyphens for the hostname slug.",
      );
      return;
    }

    setBusy(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = await provisionOrganization({ name: normalizedName, slug: normalizedSlug });
      const pendingOrganization: PlatformOrganizationSummary = {
        canonicalHostname: result.canonicalHostname,
        canonicalStatus: result.canonicalStatus,
        lifecycleState: result.lifecycleState,
        name: normalizedName,
        operationalSchemaVersion: 0,
        organizationId: result.organizationId,
        provisionedAt: null,
        slug: normalizedSlug,
      };
      setDirectory((current) =>
        current.status === "ready"
          ? {
              ...current,
              organizations: [
                pendingOrganization,
                ...current.organizations.filter(
                  (organization) => organization.organizationId !== result.organizationId,
                ),
              ],
            }
          : current,
      );
      setName("");
      setSlug("");
      setSuccessMessage(
        result.canonicalStatus === "active"
          ? `${normalizedName} provisioning started.`
          : `${normalizedName} provisioning started. Its canonical hostname remains pending until a managed Cloudflare domain is configured.`,
      );
    } catch (error: unknown) {
      setActionError(
        error instanceof AuthApiError
          ? error.message
          : "Organization provisioning could not be started. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="platform-operations" aria-labelledby="platform-organizations-title">
      <div className="section-heading section-heading--nested platform-operation__heading">
        <h3 id="platform-organizations-title">Organization provisioning</h3>
        <p>
          Create one audited Organization registry and Durable Object at a time. Canonical hostname
          activation stays pending on workers.dev until a managed Cloudflare domain is available.
          Select an Organization below to open it or manage temporary scoped Platform access.
        </p>
      </div>
      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      {successMessage ? (
        <p className="notice notice--success" role="status">
          {successMessage}
        </p>
      ) : null}
      <form
        className="form-stack platform-provisioning-form"
        onSubmit={(event) => {
          event.preventDefault();
          void createOrganization();
        }}
      >
        <div className="field">
          <label htmlFor="platform-organization-name">Organization name</label>
          <input
            autoComplete="organization"
            id="platform-organization-name"
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
            }}
            required
            value={name}
          />
        </div>
        <div className="field">
          <label htmlFor="platform-organization-slug">Hostname slug</label>
          <input
            autoCapitalize="none"
            autoComplete="off"
            id="platform-organization-slug"
            maxLength={63}
            minLength={2}
            onChange={(event) => {
              setSlug(event.target.value.toLowerCase());
            }}
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            required
            value={slug}
          />
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Starting provisioning…" : "Create Organization"}
        </button>
      </form>

      <div className="platform-directory platform-directory--organizations" aria-live="polite">
        <h4>Platform Organizations</h4>
        {directory.status === "loading" ? <p>Loading Organizations…</p> : null}
        {directory.status === "error" ? (
          <p className="notice notice--error" role="alert">
            The Platform Organization directory could not be loaded. Refresh and try again.
          </p>
        ) : null}
        {directory.status === "ready" && directory.organizations.length === 0 ? (
          <p className="empty-state">No Organizations have been provisioned yet.</p>
        ) : null}
        {directory.status === "ready" && directory.organizations.length > 0 ? (
          <ul className="account-list platform-organization-list platform-organization-list--directory">
            {directory.organizations.map((organization) => {
              const ready = organizationStatus(organization) === "Ready";
              return (
                <li key={organization.organizationId}>
                  <div className="platform-organization-card__identity">
                    <h5>{organization.name}</h5>
                    <p>{organization.canonicalHostname}</p>
                    <span className="status-pill">{organizationStatus(organization)}</span>
                  </div>
                  <PlatformOrganizationDomains organizationId={organization.organizationId} />
                  {ready ? (
                    <div className="platform-organization-actions">
                      <a
                        className="button button--secondary"
                        href={organizationHref(organization.canonicalHostname)}
                      >
                        Open {organization.name}
                      </a>
                      <a
                        className="button button--secondary"
                        href={organizationAccessHref(organization.canonicalHostname)}
                      >
                        Manage access
                      </a>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {directory.status === "ready" && directory.nextCursor ? (
          <button
            className="button button--secondary platform-load-more"
            disabled={busy}
            onClick={() => {
              void loadMore();
            }}
            type="button"
          >
            {busy ? "Loading…" : "Load more Organizations"}
          </button>
        ) : null}
      </div>

      <FleetSchemaPreparation />
    </div>
  );
}

function OrganizationElevation({ organizationId }: { readonly organizationId: string }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elevation, setElevation] = useState<ElevationState>({ status: "loading" });
  const [reason, setReason] = useState("");

  useEffect(() => {
    const abortController = new AbortController();
    getPlatformOrganizationContext(abortController.signal)
      .then((context) => {
        setElevation(
          context.organizationId === organizationId
            ? { context, status: "ready" }
            : { status: "error" },
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setElevation({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [organizationId]);

  async function enableEdits() {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      setActionError("Enter a concise reason between 3 and 500 characters.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const context = await createPlatformElevation(normalizedReason);
      if (context.organizationId !== organizationId) {
        setElevation({ status: "error" });
        return;
      }
      setElevation({ context, status: "ready" });
      setReason("");
    } catch (error: unknown) {
      setActionError(
        error instanceof AuthApiError
          ? error.message
          : "Platform edit access could not be enabled. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function endEdits() {
    if (elevation.status !== "ready" || !elevation.context.elevationId) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await revokePlatformElevation(elevation.context.elevationId);
      setElevation({
        context: {
          ...elevation.context,
          canEdit: false,
          elevationExpiresAt: null,
          elevationId: null,
        },
        status: "ready",
      });
    } catch {
      setActionError("Platform edit access could not be ended. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="platform-operations" aria-labelledby="platform-elevation-title">
      <div className="section-heading section-heading--nested platform-operation__heading">
        <h3 id="platform-elevation-title">Organization access</h3>
        <p>
          The validated hostname selected this Organization. Read access does not impersonate a
          member; edits require a short-lived, session-bound reason and retain your identity in the
          audit history.
        </p>
      </div>
      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      {elevation.status === "loading" ? <p>Checking scoped edit access…</p> : null}
      {elevation.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Scoped Platform Administrator access could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {elevation.status === "ready" && elevation.context.canEdit ? (
        <div className="platform-action platform-elevation-active">
          <div className="notice notice--warning" role="status">
            <strong>Platform edits enabled.</strong> Access expires{" "}
            {elevation.context.elevationExpiresAt
              ? displayDate(elevation.context.elevationExpiresAt)
              : "at the end of this short-lived session"}
            .
          </div>
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => {
              void endEdits();
            }}
            type="button"
          >
            {busy ? "Ending edit access…" : "End edit access"}
          </button>
        </div>
      ) : null}
      {elevation.status === "ready" && !elevation.context.canEdit ? (
        <form
          className="form-stack platform-elevation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void enableEdits();
          }}
        >
          <p className="status-pill">Read-only Platform access</p>
          <div className="field">
            <label htmlFor="platform-elevation-reason">Reason for enabling edits</label>
            <textarea
              id="platform-elevation-reason"
              maxLength={500}
              minLength={3}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              required
              rows={3}
              value={reason}
            />
          </div>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Enabling edits…" : "Enable Platform edits for 15 minutes"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export type PlatformOperationsMode = "access" | "organizations" | "queue_failures";

function OrganizationsUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      The Organization directory is available from the platform control-plane host. Open it here to
      provision and monitor Organizations:{" "}
      <a href={platformOrganizationsHref()}>Platform Organizations</a>.
    </p>
  );
}

function QueueFailuresUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      Queue failures are available from the product-base Platform Administrator console. Open them
      here: <a href={platformQueueFailuresHref()}>Queue failures</a>.
    </p>
  );
}

function AccessUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      Scoped Organization access is available after an Organization host has been selected.
    </p>
  );
}

export function PlatformOperations({
  mode,
  scope,
}: {
  readonly mode: PlatformOperationsMode;
  readonly scope: PlatformScope;
}) {
  if (mode === "organizations") {
    return scope.kind === "product_base" ? <OrganizationDirectory /> : <OrganizationsUnavailable />;
  }
  if (mode === "queue_failures") {
    return scope.kind === "product_base" ? (
      <QueueFailuresDirectory />
    ) : (
      <QueueFailuresUnavailable />
    );
  }
  return scope.kind === "organization" ? (
    <OrganizationElevation organizationId={scope.organizationId} />
  ) : (
    <AccessUnavailable />
  );
}
