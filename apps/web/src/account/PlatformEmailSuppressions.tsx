import type { PlatformEmailSuppression } from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  listPlatformEmailSuppressions,
  releaseLocalPlatformEmailSuppression,
  releasePlatformEmailSuppression,
} from "../auth/api";

type FilterStatus = "active" | "all";
type LocalSuppression = PlatformEmailSuppression["localSuppressions"][number];
type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly rows: readonly PlatformEmailSuppression[];
      readonly status: "ready";
      readonly nextCursor: string | null;
    };

function reasonLabel(reason: PlatformEmailSuppression["reason"]): string {
  switch (reason) {
    case "bounce":
      return "Bounce";
    case "complaint":
      return "Complaint";
    case "provider_rejected":
      return "Provider rejection";
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function PlatformEmailSuppressions() {
  const [draftQuery, setDraftQuery] = useState("");
  const [draftStatus, setDraftStatus] = useState<FilterStatus>("active");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<PlatformEmailSuppression | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [localReleaseTarget, setLocalReleaseTarget] = useState<{
    readonly local: LocalSuppression;
    readonly row: PlatformEmailSuppression;
  } | null>(null);
  const [localReleaseReason, setLocalReleaseReason] = useState("");
  const [localReleaseError, setLocalReleaseError] = useState<string | null>(null);
  const [localReleasing, setLocalReleasing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listPlatformEmailSuppressions({
      query,
      signal: controller.signal,
      status: statusFilter,
    })
      .then((response) => {
        setState({
          nextCursor: response.nextCursor,
          rows: response.suppressions,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [query, statusFilter]);

  async function loadMore(): Promise<void> {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadMoreError(false);
    setLoadingMore(true);
    try {
      const response = await listPlatformEmailSuppressions({
        cursor: state.nextCursor,
        query,
        status: statusFilter,
      });
      setState({
        nextCursor: response.nextCursor,
        rows: [...state.rows, ...response.suppressions],
        status: "ready",
      });
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  function applyFilters(): void {
    setLoadMoreError(false);
    setSuccess(null);
    setState({ status: "loading" });
    setQuery(draftQuery.trim());
    setStatusFilter(draftStatus);
  }

  function clearFilters(): void {
    setLoadMoreError(false);
    setSuccess(null);
    setState({ status: "loading" });
    setDraftQuery("");
    setDraftStatus("active");
    setQuery("");
    setStatusFilter("active");
  }

  function openReleaseDialog(row: PlatformEmailSuppression): void {
    setReleaseTarget(row);
    setReleaseReason("");
    setReleaseError(null);
  }

  function closeReleaseDialog(): void {
    if (releasing) return;
    setReleaseTarget(null);
    setReleaseReason("");
    setReleaseError(null);
  }

  async function releaseSuppression(): Promise<void> {
    if (!releaseTarget || releasing) return;
    const reason = releaseReason.trim();
    if (reason.length < 3) {
      setReleaseError(
        "Enter at least three characters explaining why this address is safe to release.",
      );
      return;
    }
    setReleaseError(null);
    setReleasing(true);
    try {
      const response = await releasePlatformEmailSuppression(releaseTarget.email, reason);
      setState((current) => {
        if (current.status !== "ready") return current;
        const rows = current.rows
          .map((row) =>
            row.email === response.email
              ? { ...row, active: false, updatedAt: response.updatedAt }
              : row,
          )
          .filter((row) => statusFilter !== "active" || row.active);
        return { ...current, rows };
      });
      setSuccess(`Application suppression released for ${response.email}.`);
      setReleaseTarget(null);
      setReleaseReason("");
      setReleaseError(null);
    } catch (error: unknown) {
      setReleaseError(
        error instanceof AuthApiError
          ? error.message
          : "The suppression could not be released. Refresh and try again.",
      );
    } finally {
      setReleasing(false);
    }
  }

  function openLocalReleaseDialog(row: PlatformEmailSuppression, local: LocalSuppression): void {
    setLocalReleaseTarget({ local, row });
    setLocalReleaseReason("");
    setLocalReleaseError(null);
  }

  function closeLocalReleaseDialog(): void {
    if (localReleasing) return;
    setLocalReleaseTarget(null);
    setLocalReleaseReason("");
    setLocalReleaseError(null);
  }

  async function releaseLocalSuppression(): Promise<void> {
    if (!localReleaseTarget || localReleasing) return;
    const reason = localReleaseReason.trim();
    if (reason.length < 3) {
      setLocalReleaseError(
        "Enter at least three characters explaining why this local block is safe to release.",
      );
      return;
    }
    setLocalReleaseError(null);
    setLocalReleasing(true);
    try {
      const response = await releaseLocalPlatformEmailSuppression({
        email: localReleaseTarget.row.email,
        organizationId: localReleaseTarget.local.organizationId,
        profileId: localReleaseTarget.local.profileId,
        reason,
      });
      setState((current) => {
        if (current.status !== "ready") return current;
        return {
          ...current,
          rows: current.rows.map((row) =>
            row.email === response.email
              ? {
                  ...row,
                  localSuppressions: row.localSuppressions.map((local) =>
                    local.organizationId === response.organizationId &&
                    local.profileId === response.profileId
                      ? { ...local, active: false, updatedAt: response.updatedAt }
                      : local,
                  ),
                }
              : row,
          ),
        };
      });
      setSuccess(
        `Local provider suppression released for ${localReleaseTarget.row.email} in ${localReleaseTarget.local.organizationName}. Manual or Cloudflare-managed suppression may still block delivery.`,
      );
      setLocalReleaseTarget(null);
      setLocalReleaseReason("");
      setLocalReleaseError(null);
    } catch (error: unknown) {
      setLocalReleaseError(
        error instanceof AuthApiError
          ? error.message
          : "The local provider suppression could not be released. Refresh and try again.",
      );
    } finally {
      setLocalReleasing(false);
    }
  }

  return (
    <div className="platform-email-suppressions">
      <p className="platform-email-suppressions__intro">
        This is the application-wide suppression list checked before native Cloudflare Email Sending
        requests. The Organization rows below are separate from this global layer, user or manager
        “do not email” choices, and Cloudflare&apos;s provider-managed suppression state.
      </p>
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      <form
        className="platform-email-suppressions__filters"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label className="field" htmlFor="platform-suppression-search">
          <span>Search recipient</span>
          <input
            id="platform-suppression-search"
            maxLength={320}
            onChange={(event) => {
              setDraftQuery(event.target.value);
            }}
            placeholder="name@example.com"
            type="search"
            value={draftQuery}
          />
        </label>
        <label className="field" htmlFor="platform-suppression-status">
          <span>Records</span>
          <select
            id="platform-suppression-status"
            onChange={(event) => {
              setDraftStatus(event.target.value === "all" ? "all" : "active");
            }}
            value={draftStatus}
          >
            <option value="active">Active only</option>
            <option value="all">All records</option>
          </select>
        </label>
        <div className="platform-email-suppressions__filter-actions">
          <button className="button button--primary" type="submit">
            Apply filters
          </button>
          <button className="button button--secondary" onClick={clearFilters} type="button">
            Clear
          </button>
        </div>
      </form>
      {state.status === "loading" ? <p role="status">Loading suppressions…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Global email suppressions could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {state.status === "ready" ? (
        <>
          <DataTable
            columns={[
              {
                header: "Recipient",
                id: "email",
                render: (row) => <strong>{row.email}</strong>,
                sortValue: (row) => row.email,
              },
              {
                header: "Status",
                id: "status",
                render: (row) => (
                  <span className="status-pill">{row.active ? "Active" : "Inactive"}</span>
                ),
                sortValue: (row) => row.active,
              },
              {
                header: "Reason",
                id: "reason",
                render: (row) => reasonLabel(row.reason),
                sortValue: (row) => reasonLabel(row.reason),
              },
              {
                header: "Provider detail",
                id: "detail",
                render: (row) => (
                  <span className="platform-email-suppressions__detail">
                    <span>{row.detail || "No additional detail recorded."}</span>
                    <small>Event: {row.sourceEventId}</small>
                    <small>Provider message: {row.providerMessageId}</small>
                    {row.localSuppressions.length > 0 ? (
                      <span>
                        <strong>Organization provider suppressions</strong>
                        {row.localSuppressions.map((local) => (
                          <span key={`${local.organizationId}:${local.profileId}`}>
                            {local.organizationName} · {local.active ? "active" : "released"} ·{" "}
                            {local.active ? (
                              <button
                                className="text-button"
                                onClick={() => {
                                  openLocalReleaseDialog(row, local);
                                }}
                                type="button"
                              >
                                Release local block
                              </button>
                            ) : (
                              "local release recorded"
                            )}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                header: "Updated",
                id: "updated",
                render: (row) => formatDate(row.updatedAt),
                sortValue: (row) => row.updatedAt,
              },
              {
                header: "Actions",
                id: "actions",
                mobileLabel: "Manage",
                render: (row) =>
                  row.active ? (
                    <button
                      className="text-button"
                      onClick={() => {
                        openReleaseDialog(row);
                      }}
                      type="button"
                    >
                      Release block
                    </button>
                  ) : (
                    <span>Released</span>
                  ),
              },
            ]}
            emptyMessage={
              query.length > 0
                ? "No suppressions match this recipient search."
                : "No email suppressions are recorded."
            }
            initialSort={{ columnId: "updated", direction: "desc" }}
            keySelector={(row) => row.email}
            rows={state.rows}
          />
          {loadMoreError ? (
            <p className="notice notice--error" role="alert">
              The next page could not be loaded. Try again.
            </p>
          ) : null}
          {state.nextCursor ? (
            <div className="platform-load-more">
              <button
                className="button button--secondary"
                disabled={loadingMore}
                onClick={() => {
                  void loadMore();
                }}
                type="button"
              >
                {loadingMore ? "Loading…" : "Load more suppressions"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <Dialog
        description="Use this only after confirming that the recipient mailbox issue has been resolved."
        onClose={closeReleaseDialog}
        open={releaseTarget !== null}
        title="Release suppression?"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void releaseSuppression();
          }}
        >
          {releaseError ? (
            <p className="notice notice--error" role="alert">
              {releaseError}
            </p>
          ) : null}
          <p>
            {releaseTarget
              ? `Release the application block for ${releaseTarget.email}?`
              : "Release this application block?"}
          </p>
          <p className="notice notice--warning">
            This clears only the application-wide block. Cloudflare may still reject delivery while
            its provider-managed suppression remains. A new bounce or complaint will re-suppress the
            address.
          </p>
          <label className="field" htmlFor="platform-suppression-release-reason">
            <span>Reason for release</span>
            <textarea
              autoFocus
              id="platform-suppression-release-reason"
              maxLength={500}
              minLength={3}
              onChange={(event) => {
                setReleaseReason(event.target.value);
              }}
              required
              rows={3}
              value={releaseReason}
            />
          </label>
          <div className="dialog__actions">
            <button className="button button--secondary" onClick={closeReleaseDialog} type="button">
              Cancel
            </button>
            <button className="button button--primary" disabled={releasing} type="submit">
              {releasing ? "Releasing…" : "Release suppression"}
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog
        description="This clears only the application’s local Organization provider suppression. It does not remove Cloudflare-managed suppression and does not change a user or manager do-not-email choice."
        onClose={closeLocalReleaseDialog}
        open={localReleaseTarget !== null}
        title="Release local provider suppression?"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void releaseLocalSuppression();
          }}
        >
          {localReleaseError ? (
            <p className="notice notice--error" role="alert">
              {localReleaseError}
            </p>
          ) : null}
          <p>
            {localReleaseTarget
              ? `Release the local provider block for ${localReleaseTarget.row.email} in ${localReleaseTarget.local.organizationName}?`
              : "Release this local provider block?"}
          </p>
          <p className="notice notice--warning">
            Confirm the mailbox or account issue is resolved first. The global application block,
            explicit user or manager opt-out, and Cloudflare-managed suppression remain separate.
          </p>
          <label className="field" htmlFor="platform-local-suppression-release-reason">
            <span>Reason for local release</span>
            <textarea
              autoFocus
              id="platform-local-suppression-release-reason"
              maxLength={500}
              minLength={3}
              onChange={(event) => {
                setLocalReleaseReason(event.target.value);
              }}
              required
              rows={3}
              value={localReleaseReason}
            />
          </label>
          <div className="dialog__actions">
            <button
              className="button button--secondary"
              onClick={closeLocalReleaseDialog}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={localReleasing} type="submit">
              {localReleasing ? "Releasing…" : "Release local block"}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
