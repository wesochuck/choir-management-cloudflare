import type {
  PlatformContextResponse,
  PlatformFleetSchemaStatusResponse,
  PlatformEmailFeedbackDeadLetter,
  PlatformEmailFeedbackView,
  PlatformEmailProviderEvent,
  PlatformJobDeadLetterView,
  PlatformJobDeadLetterSummary,
  PlatformOrganizationContextResponse,
  PublicDomainResponse,
  PlatformOrganizationSummary,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  createPlatformElevation,
  getPlatformOrganizationContext,
  getPlatformFleetSchemaStatus,
  dismissPlatformJobDeadLetter,
  acknowledgePlatformEmailFeedbackDeadLetter,
  acknowledgePlatformEmailProviderEvent,
  disablePlatformOrganizationPublicDomain,
  listPlatformOrganizationPublicDomains,
  listPlatformJobDeadLetters,
  listPlatformEmailFeedbackDeadLetters,
  listPlatformEmailProviderEvents,
  listPlatformOrganizations,
  provisionOrganization,
  registerPlatformOrganizationPublicDomain,
  retryPlatformJobDeadLetter,
  retryPlatformEmailFeedbackDeadLetter,
  retryPlatformEmailProviderEvent,
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
      readonly hasMore: boolean;
      readonly status: "ready";
    };

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
  return `${protocol}//${hostname}/admin`;
}

function organizationAccessHref(hostname: string): string {
  const protocol = hostname === "localhost" || hostname.endsWith(".localhost") ? "http:" : "https:";
  return `${protocol}//${hostname}/platform/access`;
}

function platformProductHref(pathname: string): string {
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
  return platformProductHref("/platform/organizations");
}

function platformDeadLettersHref(): string {
  return platformProductHref("/platform/dead-letters");
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

interface DeadLetterActionTarget {
  readonly action: "dismiss" | "retry";
  readonly deadLetter: PlatformJobDeadLetterSummary;
}

type EmailFeedbackState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly deadLetters: readonly PlatformEmailFeedbackDeadLetter[];
      readonly events: readonly PlatformEmailProviderEvent[];
      readonly hasMoreDeadLetters: boolean;
      readonly hasMoreEvents: boolean;
      readonly status: "ready";
    };

type EmailFeedbackActionTarget =
  | {
      readonly action: "acknowledge-event" | "retry-event";
      readonly event: PlatformEmailProviderEvent;
    }
  | {
      readonly action: "acknowledge-dead-letter" | "retry-dead-letter";
      readonly deadLetter: PlatformEmailFeedbackDeadLetter;
    };

function deadLetterActionLabel(status: PlatformJobDeadLetterSummary["actionStatus"]): string {
  switch (status) {
    case "dismissed":
      return "Dismissed";
    case "retry_failed":
      return "Retry unavailable";
    case "retry_queued":
      return "Retry queued";
    case "retry_requested":
      return "Retry pending";
    case "open":
      return "Needs review";
  }
}

// eslint-disable-next-line complexity -- the panel keeps loading, action confirmation, and five operator states together.
function QueueDeadLetterDirectory() {
  const [deadLetters, setDeadLetters] = useState<DeadLetterState>({ status: "loading" });
  const [view, setView] = useState<PlatformJobDeadLetterView>("open");
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionTarget, setActionTarget] = useState<DeadLetterActionTarget | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    listPlatformJobDeadLetters(null, abortController.signal, view)
      .then((result) => {
        setDeadLetters({
          deadLetters: result.deadLetters,
          hasMore: result.nextCursor !== null,
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
  }, [refreshKey, view]);

  function openAction(
    action: DeadLetterActionTarget["action"],
    deadLetter: PlatformJobDeadLetterSummary,
  ) {
    setActionTarget({ action, deadLetter });
    setActionError(null);
    setActionReason("");
  }

  function closeAction(): void {
    if (actionBusy) return;
    setActionTarget(null);
    setActionError(null);
    setActionReason("");
  }

  async function submitAction(): Promise<void> {
    if (!actionTarget) return;
    const reason = actionReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setActionError("Enter a reason between 3 and 500 characters.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const result =
        actionTarget.action === "retry"
          ? await retryPlatformJobDeadLetter(actionTarget.deadLetter.id, reason)
          : await dismissPlatformJobDeadLetter(actionTarget.deadLetter.id, reason);
      setSuccess(
        result.actionStatus === "retry_queued"
          ? "The job was reset and a fresh queue attempt was created."
          : "The dead-letter record was dismissed. The originating job was not deleted.",
      );
      setDeadLetters({ status: "loading" });
      setActionTarget(null);
      setActionReason("");
      setRefreshKey((current) => current + 1);
    } catch (failure: unknown) {
      setActionError(
        failure instanceof AuthApiError
          ? failure.message
          : "The queue failure action could not be completed. Refresh and try again.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="platform-directory" aria-live="polite">
      <h4>Queue dead letters</h4>
      <p>
        These are final queue-failure records, not a second inbox. The original queue message has
        already been acknowledged and its payload is not stored here. Retry creates a fresh attempt
        from the originating record; dismiss only clears this incident from the needs-review list.
      </p>
      <div className="platform-dead-letter-toolbar">
        <label className="field" htmlFor="platform-dead-letter-view">
          <span>Show</span>
          <select
            id="platform-dead-letter-view"
            onChange={(event) => {
              setSuccess(null);
              setDeadLetters({ status: "loading" });
              setView(event.target.value === "all" ? "all" : "open");
            }}
            value={view}
          >
            <option value="open">Needs review</option>
            <option value="all">All records</option>
          </select>
        </label>
        <button
          className="button button--secondary"
          disabled={deadLetters.status === "loading"}
          onClick={() => {
            setSuccess(null);
            setRefreshKey((current) => current + 1);
          }}
          type="button"
        >
          {deadLetters.status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {deadLetters.status === "loading" ? <p>Loading queue failures…</p> : null}
      {deadLetters.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Queue dead-letter visibility could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.deadLetters.length === 0 ? (
        <p className="empty-state">No jobs have reached the dead-letter queue.</p>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.deadLetters.length > 0 ? (
        <ul className="account-list platform-dead-letter-list">
          {/* eslint-disable-next-line complexity -- each row intentionally reflects its operator state. */}
          {deadLetters.deadLetters.map((deadLetter) => (
            <li key={`${deadLetter.queueName}:${deadLetter.messageId}`}>
              <div className="platform-dead-letter-list__copy">
                <h5>{deadLetter.jobKind ?? "Invalid queue message"}</h5>
                <p>
                  {deadLetter.organizationId ?? "No validated Organization"} · observed{" "}
                  {displayDate(deadLetter.lastSeenAt)}
                </p>
                <p className="platform-dead-letter-list__meta">
                  Message {deadLetter.messageId} · queue attempt{" "}
                  {String(deadLetter.observedAttempt)}
                </p>
                <span className="status-pill">
                  {deadLetterActionLabel(deadLetter.actionStatus)} ·{" "}
                  {deadLetter.observationCount === 1
                    ? "recorded once"
                    : `recorded ${String(deadLetter.observationCount)} times`}
                </span>
                {deadLetter.actionError ? (
                  <p className="notice notice--warning">{deadLetter.actionError}</p>
                ) : null}
                {deadLetter.actionStatus !== "open" && deadLetter.actionAt ? (
                  <p className="platform-dead-letter-list__meta">
                    {deadLetterActionLabel(deadLetter.actionStatus)}{" "}
                    {displayDate(deadLetter.actionAt)}
                    {deadLetter.actionReason ? ` · ${deadLetter.actionReason}` : ""}
                  </p>
                ) : null}
                {deadLetter.actionStatus === "retry_queued" ? (
                  <p className="platform-dead-letter-list__hint">
                    The new attempt is in the normal job queue. Check the originating notification
                    for its result.
                  </p>
                ) : null}
              </div>
              {deadLetter.actionStatus !== "dismissed" ? (
                <div className="platform-dead-letter-list__actions">
                  {(deadLetter.actionStatus === "open" ||
                    deadLetter.actionStatus === "retry_failed") &&
                  deadLetter.messageValid &&
                  deadLetter.organizationId &&
                  deadLetter.jobId &&
                  deadLetter.jobKind &&
                  deadLetter.idempotencyKey &&
                  deadLetter.observedAttempt < 10 ? (
                    <button
                      className="button button--primary"
                      onClick={() => {
                        openAction("retry", deadLetter);
                      }}
                      type="button"
                    >
                      {deadLetter.actionStatus === "retry_failed" ? "Try retry again" : "Retry job"}
                    </button>
                  ) : null}
                  <button
                    className="button button--secondary"
                    onClick={() => {
                      openAction("dismiss", deadLetter);
                    }}
                    type="button"
                  >
                    Dismiss record
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {deadLetters.status === "ready" && deadLetters.hasMore ? (
        <p>Showing the 25 most recent queue failures.</p>
      ) : null}
      <Dialog
        description={
          actionTarget?.action === "retry"
            ? "Retry only after fixing or confirming the cause. A retry can send the message again."
            : "Dismissal keeps the audit record and does not delete or resend the originating job."
        }
        onClose={closeAction}
        open={actionTarget !== null}
        title={
          actionTarget?.action === "retry" ? "Retry queue job?" : "Dismiss dead-letter record?"
        }
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAction();
          }}
        >
          {actionError ? (
            <p className="notice notice--error" role="alert">
              {actionError}
            </p>
          ) : null}
          <p>
            {actionTarget?.action === "retry"
              ? `Create a new attempt for ${actionTarget.deadLetter.jobKind ?? "this job"}?`
              : "Remove this incident from the needs-review list?"}
          </p>
          <label className="field" htmlFor="platform-dead-letter-action-reason">
            <span>Reason</span>
            <textarea
              autoFocus
              id="platform-dead-letter-action-reason"
              maxLength={500}
              minLength={3}
              onChange={(event) => {
                setActionReason(event.target.value);
              }}
              required
              rows={3}
              value={actionReason}
            />
          </label>
          <div className="dialog__actions">
            <button className="button button--secondary" onClick={closeAction} type="button">
              Cancel
            </button>
            <button className="button button--primary" disabled={actionBusy} type="submit">
              {actionBusy
                ? "Saving…"
                : actionTarget?.action === "retry"
                  ? "Create retry"
                  : "Dismiss record"}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function emailFeedbackActionLabel(action: EmailFeedbackActionTarget["action"]): string {
  switch (action) {
    case "retry-event":
    case "retry-dead-letter":
      return "Retry provider event";
    case "acknowledge-event":
    case "acknowledge-dead-letter":
      return "Acknowledge record";
  }
}

function providerEventStatusLabel(event: PlatformEmailProviderEvent): string {
  return `${event.eventType} · ${event.state} · ${event.operatorStatus}`;
}

// eslint-disable-next-line complexity -- this operator view keeps normalized events and queue dead letters together.
function EmailProviderFeedbackDirectory() {
  const [feedback, setFeedback] = useState<EmailFeedbackState>({ status: "loading" });
  const [view, setView] = useState<PlatformEmailFeedbackView>("open");
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionTarget, setActionTarget] = useState<EmailFeedbackActionTarget | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    Promise.all([
      listPlatformEmailProviderEvents(null, abortController.signal, view),
      listPlatformEmailFeedbackDeadLetters(null, abortController.signal, view),
    ])
      .then(([events, deadLetters]) => {
        setFeedback({
          deadLetters: deadLetters.deadLetters,
          events: events.events,
          hasMoreDeadLetters: deadLetters.nextCursor !== null,
          hasMoreEvents: events.nextCursor !== null,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFeedback({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [refreshKey, view]);

  function openAction(target: EmailFeedbackActionTarget): void {
    setActionTarget(target);
    setActionError(null);
    setActionReason("");
  }

  function closeAction(): void {
    if (actionBusy) return;
    setActionTarget(null);
    setActionError(null);
    setActionReason("");
  }

  async function submitAction(): Promise<void> {
    if (!actionTarget) return;
    const reason = actionReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setActionError("Enter a reason between 3 and 500 characters.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      let result;
      if (actionTarget.action === "retry-event") {
        result = await retryPlatformEmailProviderEvent(actionTarget.event.eventId, reason);
      } else if (actionTarget.action === "acknowledge-event") {
        result = await acknowledgePlatformEmailProviderEvent(actionTarget.event.eventId, reason);
      } else if (actionTarget.action === "retry-dead-letter") {
        result = await retryPlatformEmailFeedbackDeadLetter(actionTarget.deadLetter.id, reason);
      } else if ("deadLetter" in actionTarget) {
        result = await acknowledgePlatformEmailFeedbackDeadLetter(
          actionTarget.deadLetter.id,
          reason,
        );
      } else {
        return;
      }
      setSuccess(
        result.actionStatus === "retry_requested"
          ? "The normalized provider event was queued for another correlation attempt."
          : result.actionStatus === "retry_unavailable"
            ? "This record cannot be retried. Malformed queue messages are acknowledge-only."
            : "The provider feedback record was acknowledged. Its audit history was retained.",
      );
      setFeedback({ status: "loading" });
      setActionTarget(null);
      setActionReason("");
      setRefreshKey((current) => current + 1);
    } catch (failure: unknown) {
      setActionError(
        failure instanceof AuthApiError
          ? failure.message
          : "The provider feedback action could not be completed. Refresh and try again.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="platform-directory" aria-live="polite">
      <h4>Email provider feedback</h4>
      <p>
        Cloudflare Email Sending events are normalized and correlated to the originating
        notification. Retry acts on the stored normalized event only; raw provider payloads and
        email bodies are not retained. Queue dead letters below are acknowledge-only when the
        original message was malformed.
      </p>
      <div className="platform-dead-letter-toolbar">
        <label className="field" htmlFor="platform-email-feedback-view">
          <span>Show</span>
          <select
            id="platform-email-feedback-view"
            onChange={(event) => {
              setSuccess(null);
              setFeedback({ status: "loading" });
              setView(event.target.value === "all" ? "all" : "open");
            }}
            value={view}
          >
            <option value="open">Needs review</option>
            <option value="all">All records</option>
          </select>
        </label>
        <button
          className="button button--secondary"
          disabled={feedback.status === "loading"}
          onClick={() => {
            setSuccess(null);
            setRefreshKey((current) => current + 1);
          }}
          type="button"
        >
          {feedback.status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {feedback.status === "loading" ? <p>Loading email feedback…</p> : null}
      {feedback.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Email provider feedback could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {feedback.status === "ready" ? (
        <>
          <h5>Normalized provider events</h5>
          {feedback.events.length === 0 ? (
            <p className="empty-state">No provider events need review.</p>
          ) : (
            <ul className="account-list platform-dead-letter-list">
              {feedback.events.map((event) => (
                <li key={event.eventId}>
                  <div className="platform-dead-letter-list__copy">
                    <h5>{event.recipient}</h5>
                    <p>{providerEventStatusLabel(event)}</p>
                    <p className="platform-dead-letter-list__meta">
                      {event.organizationId ?? "Unmatched Organization"} · message {event.messageId}
                    </p>
                    <p className="platform-dead-letter-list__meta">
                      {event.sourceKind ?? "Unmatched route"} · updated{" "}
                      {displayDate(event.updatedAt)}
                    </p>
                    {event.lastError ? (
                      <p className="notice notice--warning">{event.lastError}</p>
                    ) : null}
                    {event.operatorStatus === "acknowledged" && event.operatorReason ? (
                      <p className="platform-dead-letter-list__meta">
                        Acknowledged: {event.operatorReason}
                      </p>
                    ) : null}
                  </div>
                  {event.state !== "processed" ? (
                    <div className="platform-dead-letter-list__actions">
                      <button
                        className="button button--primary"
                        onClick={() => {
                          openAction({ action: "retry-event", event });
                        }}
                        type="button"
                      >
                        Retry correlation
                      </button>
                      <button
                        className="button button--secondary"
                        onClick={() => {
                          openAction({ action: "acknowledge-event", event });
                        }}
                        type="button"
                      >
                        Acknowledge
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {feedback.hasMoreEvents ? <p>Showing the 25 most recent provider events.</p> : null}
          <h5>Queue dead letters</h5>
          {feedback.deadLetters.length === 0 ? (
            <p className="empty-state">No email feedback queue dead letters need review.</p>
          ) : (
            <ul className="account-list platform-dead-letter-list">
              {feedback.deadLetters.map((deadLetter) => (
                <li key={deadLetter.id}>
                  <div className="platform-dead-letter-list__copy">
                    <h5>{deadLetter.queueName}</h5>
                    <p>
                      {deadLetter.eventId ? `Event ${deadLetter.eventId}` : "Malformed message"} ·
                      observed {displayDate(deadLetter.lastSeenAt)}
                    </p>
                    <p className="platform-dead-letter-list__meta">
                      {deadLetter.reason} · message {deadLetter.messageId} · attempt{" "}
                      {String(deadLetter.observedAttempt)}
                    </p>
                    <span className="status-pill">
                      {deadLetter.actionStatus === "acknowledged" ? "Acknowledged" : "Needs review"}
                    </span>
                    {!deadLetter.retryable ? (
                      <p className="platform-dead-letter-list__hint">
                        This message was malformed and cannot be replayed. Acknowledge it after
                        recording the operator decision.
                      </p>
                    ) : null}
                  </div>
                  {deadLetter.actionStatus === "open" ? (
                    <div className="platform-dead-letter-list__actions">
                      {deadLetter.retryable ? (
                        <button
                          className="button button--primary"
                          onClick={() => {
                            openAction({ action: "retry-dead-letter", deadLetter });
                          }}
                          type="button"
                        >
                          Retry event
                        </button>
                      ) : null}
                      <button
                        className="button button--secondary"
                        onClick={() => {
                          openAction({ action: "acknowledge-dead-letter", deadLetter });
                        }}
                        type="button"
                      >
                        Acknowledge
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {feedback.hasMoreDeadLetters ? (
            <p>Showing the 25 most recent email queue dead letters.</p>
          ) : null}
        </>
      ) : null}
      <Dialog
        description={
          actionTarget?.action.startsWith("retry")
            ? "Retry only after reviewing the correlation or queue failure. The action is recorded with your reason."
            : "Acknowledgement removes this record from the needs-review view but never deletes its audit history."
        }
        onClose={closeAction}
        open={actionTarget !== null}
        title={
          actionTarget
            ? `${emailFeedbackActionLabel(actionTarget.action)}?`
            : "Provider feedback action"
        }
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAction();
          }}
        >
          {actionError ? (
            <p className="notice notice--error" role="alert">
              {actionError}
            </p>
          ) : null}
          <label className="field" htmlFor="platform-email-feedback-action-reason">
            <span>Reason</span>
            <textarea
              autoFocus
              id="platform-email-feedback-action-reason"
              maxLength={500}
              minLength={3}
              onChange={(event) => {
                setActionReason(event.target.value);
              }}
              required
              rows={3}
              value={actionReason}
            />
          </label>
          <div className="dialog__actions">
            <button className="button button--secondary" onClick={closeAction} type="button">
              Cancel
            </button>
            <button className="button button--primary" disabled={actionBusy} type="submit">
              {actionBusy
                ? "Saving…"
                : emailFeedbackActionLabel(actionTarget?.action ?? "acknowledge-event")}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

type PlatformDeadLetterTab = "email-provider" | "queue";

function PlatformDeadLetterWorkspace() {
  const [tab, setTab] = useState<PlatformDeadLetterTab>("queue");
  return (
    <>
      <nav aria-label="Dead-letter sections" className="ticketing-tabs" role="tablist">
        <button
          aria-controls="platform-email-provider-events-panel"
          aria-selected={tab === "email-provider"}
          className={tab === "email-provider" ? "is-active" : undefined}
          id="platform-email-provider-events-tab"
          onClick={() => {
            setTab("email-provider");
          }}
          role="tab"
          type="button"
        >
          Email provider events
        </button>
        <button
          aria-controls="platform-queue-dead-letters-panel"
          aria-selected={tab === "queue"}
          className={tab === "queue" ? "is-active" : undefined}
          id="platform-queue-dead-letters-tab"
          onClick={() => {
            setTab("queue");
          }}
          role="tab"
          type="button"
        >
          Queue DLQ
        </button>
      </nav>
      {tab === "email-provider" ? (
        <div
          aria-labelledby="platform-email-provider-events-tab"
          id="platform-email-provider-events-panel"
          role="tabpanel"
        >
          <EmailProviderFeedbackDirectory />
        </div>
      ) : (
        <div
          aria-labelledby="platform-queue-dead-letters-tab"
          id="platform-queue-dead-letters-panel"
          role="tabpanel"
        >
          <QueueDeadLetterDirectory />
        </div>
      )}
    </>
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

function OrganizationsUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      The Organization directory is available from the platform control-plane host. Open it here to
      provision and monitor Organizations:{" "}
      <a href={platformOrganizationsHref()}>Platform Organizations</a>.
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

function DeadLettersUnavailable() {
  return (
    <p className="notice notice--warning" role="status">
      Queue dead letters are available from the platform control-plane host. Open them here:{" "}
      <a href={platformDeadLettersHref()}>Queue dead letters</a>
    </p>
  );
}

export type PlatformOperationsMode = "access" | "dead-letters" | "organizations";

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
  if (mode === "dead-letters") {
    return scope.kind === "product_base" ? (
      <PlatformDeadLetterWorkspace />
    ) : (
      <DeadLettersUnavailable />
    );
  }
  return scope.kind === "organization" ? (
    <OrganizationElevation organizationId={scope.organizationId} />
  ) : (
    <AccessUnavailable />
  );
}
