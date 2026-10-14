import type { PublicPollDetailsResponse } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import { getPublicPollDetails, submitPublicPollVote } from "../api";
import { PollForm } from "../public/PublicPollView";

type PollDetails = PublicPollDetailsResponse;

type ViewStatus =
  | { type: "loading" }
  | { type: "no_token" }
  | { type: "not_found"; message?: string }
  | { type: "ready"; details: PollDetails }
  | { type: "submitting"; details: PollDetails }
  | { type: "submit_error"; details: PollDetails; errorMessage: string }
  | { type: "submitted"; details: PollDetails };

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
}

export function MemberPollVoteView({
  enabled,
  navigate,
  pollId,
  search,
}: {
  readonly enabled: boolean;
  readonly navigate: (href: string) => void;
  readonly pollId: string;
  readonly search: string;
}) {
  const token = useMemo(() => {
    const rawSearch = search ? search : typeof window !== "undefined" ? window.location.search : "";
    return new URLSearchParams(rawSearch).get("token")?.trim() ?? null;
  }, [search]);

  const [status, setStatus] = useState<ViewStatus>(() => ({
    type: token ? "loading" : "no_token",
  }));

  useEffect(() => {
    if (!enabled || !token) return;
    const controller = new AbortController();
    getPublicPollDetails(token, controller.signal)
      .then((details) => {
        if (pollId && details.pollId !== pollId) {
          setStatus({
            message: "The poll link does not match the requested poll ID.",
            type: "not_found",
          });
          return;
        }
        setStatus({ details, type: "ready" });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus({ type: "not_found" });
      });

    return () => {
      controller.abort();
    };
  }, [enabled, pollId, token]);

  const handleRetry = () => {
    if (!token) return;
    setStatus({ type: "loading" });
    getPublicPollDetails(token)
      .then((details) => {
        if (pollId && details.pollId !== pollId) {
          setStatus({
            message: "The poll link does not match the requested poll ID.",
            type: "not_found",
          });
          return;
        }
        setStatus({ details, type: "ready" });
      })
      .catch(() => {
        setStatus({ type: "not_found" });
      });
  };

  const handleSubmit = (optionIds: string[]) => {
    if (!token || (status.type !== "ready" && status.type !== "submit_error")) {
      return;
    }
    const details = status.details;
    setStatus({ details, type: "submitting" });
    submitPublicPollVote(token, optionIds)
      .then(() => {
        setStatus({
          details: { ...details, responseOptionIds: optionIds },
          type: "submitted",
        });
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Your vote could not be submitted. Please try again.";
        setStatus({
          details,
          errorMessage: message,
          type: "submit_error",
        });
      });
  };

  if (!enabled) return null;

  const currentStatus: ViewStatus = !token ? { type: "no_token" } : status;

  return (
    <section aria-labelledby="member-poll-title" className="account-section">
      <div className="mb-4">
        <button
          className="button button--secondary"
          onClick={() => {
            navigate("/dashboard");
          }}
          type="button"
        >
          ← Back to Dashboard
        </button>
      </div>

      {currentStatus.type === "no_token" ? (
        <div className="card space-y-4">
          <h1 id="member-poll-title">Poll Link Required</h1>
          <p className="notice notice--info" role="status">
            A valid poll link token is required to vote. Please open this poll from your Member
            Dashboard or invitation email.
          </p>
          <div>
            <button
              className="button button--primary"
              onClick={() => {
                navigate("/dashboard");
              }}
              type="button"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      ) : null}

      {currentStatus.type === "loading" ? (
        <div className="card space-y-4">
          <h1 id="member-poll-title">Loading Poll…</h1>
          <p className="notice notice--info" role="status">
            Loading poll options…
          </p>
        </div>
      ) : null}

      {currentStatus.type === "not_found" ? (
        <div className="card space-y-4">
          <h1 id="member-poll-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            {currentStatus.message ??
              "This poll link is invalid or expired. Contact an Organization manager for a new link."}
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button className="button button--primary" onClick={handleRetry} type="button">
              Retry
            </button>
            <button
              className="button button--secondary"
              onClick={() => {
                navigate("/dashboard");
              }}
              type="button"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      ) : null}

      {currentStatus.type === "submitted" ? (
        <div className="card space-y-4">
          <h1 id="member-poll-title">Vote Submitted</h1>
          <p className="notice notice--success" role="status">
            Thank you, {currentStatus.details.profileName}. Your vote has been recorded.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {currentStatus.details.canSubmit ? (
              <button
                className="button button--primary"
                onClick={() => {
                  setStatus({ details: currentStatus.details, type: "ready" });
                }}
                type="button"
              >
                Change Vote
              </button>
            ) : null}
            <button
              className="button button--secondary"
              onClick={() => {
                navigate("/dashboard");
              }}
              type="button"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      ) : null}

      {currentStatus.type === "ready" ||
      currentStatus.type === "submitting" ||
      currentStatus.type === "submit_error" ? (
        <div className="card space-y-4">
          <h1 id="member-poll-title">{currentStatus.details.title}</h1>
          {currentStatus.details.description ? (
            <p className="whitespace-pre-wrap text-sm">{currentStatus.details.description}</p>
          ) : null}
          {currentStatus.details.expiresAt ? (
            <p className="text-sm text-muted-foreground">
              Closes {formatExpiry(currentStatus.details.expiresAt)}
            </p>
          ) : null}

          <hr className="my-4" />

          <p>
            Hello <strong>{currentStatus.details.profileName}</strong>, please share your vote.
          </p>

          <PollForm
            backLabel="Return to Dashboard"
            busy={currentStatus.type === "submitting"}
            details={currentStatus.details}
            onBack={() => {
              navigate("/dashboard");
            }}
            onSubmit={handleSubmit}
          />
          {currentStatus.type === "submit_error" ? (
            <p className="notice notice--error" role="alert">
              {currentStatus.errorMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
