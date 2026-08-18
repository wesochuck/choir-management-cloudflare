import { publicPollDetailsResponseSchema, type PublicPollDetailsResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

type PollDetails = PublicPollDetailsResponse;

type PageStatus =
  | { type: "loading" }
  | { type: "no_token" }
  | { type: "not_found" }
  | { type: "ready"; details: PollDetails }
  | { type: "submitting"; details: PollDetails }
  | { type: "submit_error"; details: PollDetails }
  | { type: "submitted"; details: PollDetails };

function fetchPollDetails(token: string): Promise<PollDetails> {
  return fetch("/api/public/poll-details", {
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("not_found");
    return response.json().then((data: unknown) => {
      const parsed = publicPollDetailsResponseSchema.safeParse(data);
      if (parsed.success) return parsed.data;
      throw new Error("invalid_response");
    });
  });
}

function submitPollVote(token: string, optionIds: string[]): Promise<void> {
  return fetch("/api/public/poll-vote", {
    body: JSON.stringify({ token, optionIds }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("submit_failed");
  });
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
}

function PollForm({
  details,
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly details: PollDetails;
  readonly onSubmit: (optionIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(details.responseOptionIds);

  function toggleOption(optionId: string) {
    if (!details.canSubmit) return;
    if (details.multipleChoice) {
      setSelected((prev) =>
        prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
      );
    } else {
      setSelected(selected[0] === optionId ? [] : [optionId]);
    }
  }

  const hasExistingVote = details.responseOptionIds.length > 0;

  if (!details.canSubmit) {
    return (
      <div className="mt-4 space-y-3">
        <p className="notice notice--warning" role="status">
          This poll is no longer accepting responses.
        </p>
        {hasExistingVote && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Your recorded vote:</p>
            {details.options
              .filter((opt) => details.responseOptionIds.includes(opt.id))
              .map((option) => (
                <div
                  className="w-full rounded border border-primary bg-primary/10 p-3 text-left font-medium"
                  key={option.id}
                >
                  ✓ {option.label}
                </div>
              ))}
          </div>
        )}
        <a className="button button--secondary w-full" href="/">
          Return to the Organization site
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {hasExistingVote && (
        <p className="notice notice--info" role="status">
          Your vote is currently recorded. You can change your response until{" "}
          {details.expiresAt ? formatExpiry(details.expiresAt) : "the poll closes"}.
        </p>
      )}
      {details.options
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <button
              className={`w-full rounded border px-4 py-3 text-left font-medium transition-colors ${
                isSelected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
              key={option.id}
              onClick={() => {
                toggleOption(option.id);
              }}
              type="button"
            >
              {details.multipleChoice && (
                <span className="mr-2 inline-block h-4 w-4 rounded-sm border border-current">
                  {isSelected && (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16">
                      <path
                        d="M3 8l3 3 7-7"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  )}
                </span>
              )}
              {!details.multipleChoice && (
                <span
                  className={`mr-2 inline-block h-4 w-4 rounded-full border ${
                    isSelected ? "border-current" : ""
                  }`}
                >
                  {isSelected && <span className="block h-full w-full rounded-full bg-current" />}
                </span>
              )}
              {option.label}
            </button>
          );
        })}

      <button
        className={`button button--primary w-full ${busy || selected.length === 0 ? "button--disabled" : ""}`}
        disabled={busy || selected.length === 0}
        onClick={() => {
          onSubmit(selected);
        }}
        type="button"
      >
        {busy ? "Submitting..." : hasExistingVote ? "Update Vote" : "Submit Vote"}
      </button>
    </div>
  );
}

export function PublicPollView() {
  const [token] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("token"),
  );
  const [pageStatus, setPageStatus] = useState<PageStatus>(() => ({
    type: token ? "loading" : "no_token",
  }));

  useEffect(() => {
    window.history.replaceState(null, "", "/poll");
    if (!token) return;
    fetchPollDetails(token)
      .then((details) => {
        setPageStatus({ type: "ready", details });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }, [token]);

  function handleSubmit(optionIds: string[]) {
    if (!token || (pageStatus.type !== "ready" && pageStatus.type !== "submit_error")) {
      return;
    }
    const details = pageStatus.details;
    setPageStatus({ type: "submitting", details });
    submitPollVote(token, optionIds)
      .then(() => {
        const updatedDetails: PollDetails = { ...details, responseOptionIds: optionIds };
        setPageStatus({ type: "submitted", details: updatedDetails });
      })
      .catch(() => {
        setPageStatus({ type: "submit_error", details });
      });
  }

  if (pageStatus.type === "no_token") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="poll-title">
          <h1 id="poll-title">Poll Link Required</h1>
          <p className="notice notice--info" role="status">
            Please use the link from your email to access this poll.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "loading") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="poll-title">
          <h1 id="poll-title">Loading Poll...</h1>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="poll-title">
          <h1 id="poll-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This poll link is invalid or expired. Contact an Organization manager for a new link.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "submitted") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="poll-title">
          <p className="eyebrow">Poll</p>
          <h1 id="poll-title">Vote Submitted</h1>
          <p className="notice notice--success" role="status">
            Thank you, {pageStatus.details.profileName}. Your vote has been recorded.
          </p>
          <div className="flex flex-col gap-2 mt-4">
            {pageStatus.details.canSubmit && (
              <button
                className="button button--primary"
                onClick={() => {
                  setPageStatus({ type: "ready", details: pageStatus.details });
                }}
                type="button"
              >
                Change Vote
              </button>
            )}
            <a className="button button--secondary" href="/">
              Return to the Organization site
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="poll-title">
        <p className="eyebrow">Poll</p>
        <h1 id="poll-title">{pageStatus.details.title}</h1>
        {pageStatus.details.description && (
          <p className="whitespace-pre-wrap text-sm">{pageStatus.details.description}</p>
        )}
        {pageStatus.details.expiresAt && (
          <p className="text-sm text-muted-foreground">
            Closes {formatExpiry(pageStatus.details.expiresAt)}
          </p>
        )}

        <hr className="my-4" />

        <p>
          Hello <strong>{pageStatus.details.profileName}</strong>, please share your vote.
        </p>

        <PollForm
          busy={pageStatus.type === "submitting"}
          details={pageStatus.details}
          onSubmit={handleSubmit}
        />
        {pageStatus.type === "submit_error" && (
          <p className="notice notice--error" role="alert">
            Your vote could not be submitted. Please try again.
          </p>
        )}
      </section>
    </main>
  );
}
