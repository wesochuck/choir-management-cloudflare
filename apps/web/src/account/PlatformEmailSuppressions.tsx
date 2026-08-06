import type { PlatformEmailSuppression } from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  listPlatformEmailSuppressions,
  releasePlatformEmailSuppression,
} from "../auth/api";

type FilterStatus = "active" | "all";
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

  return (
    <div className="platform-email-suppressions">
      <p className="platform-email-suppressions__intro">
        This is the application-wide suppression list checked before native Cloudflare Email Sending
        requests. It is separate from Cloudflare&apos;s provider-managed suppression state.
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
    </div>
  );
}
