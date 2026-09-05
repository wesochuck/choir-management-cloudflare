import type { PublicPollDetailsResponse } from "@choir/contracts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getPublicPollDetails, submitPublicPollVote } from "../api";

export type PollDetails = PublicPollDetailsResponse;

type PageStatus =
  | { type: "loading" }
  | { type: "no_token" }
  | { type: "not_found" }
  | { type: "ready"; details: PollDetails }
  | { type: "submitting"; details: PollDetails }
  | { type: "submit_error"; details: PollDetails }
  | { type: "submitted"; details: PollDetails };

async function fetchPollDetails(token: string): Promise<PollDetails> {
  try {
    return await getPublicPollDetails(token);
  } catch {
    throw new Error("not_found");
  }
}

async function submitPollVote(token: string, optionIds: string[]): Promise<void> {
  try {
    await submitPublicPollVote(token, optionIds);
  } catch {
    throw new Error("submit_failed");
  }
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

function getNextRadioIndex(key: string, baseIndex: number, length: number): number | null {
  if (length === 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return baseIndex >= 0 ? (baseIndex + 1) % length : 0;
    case "ArrowUp":
    case "ArrowLeft":
      return baseIndex >= 0 ? (baseIndex - 1 + length) % length : length - 1;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

function PollOptionItem({
  details,
  hasSelection,
  index,
  isSelected,
  onToggle,
  option,
}: {
  readonly details: PollDetails;
  readonly hasSelection: boolean;
  readonly index: number;
  readonly isSelected: boolean;
  readonly onToggle: (optionId: string) => void;
  readonly option: PollDetails["options"][number];
}) {
  const tabIndex = details.multipleChoice
    ? 0
    : isSelected || (!hasSelection && index === 0)
      ? 0
      : -1;

  return (
    <button
      aria-checked={isSelected}
      className={`w-full rounded border px-4 py-3 text-left font-medium transition-colors ${
        isSelected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
      }`}
      onClick={() => {
        onToggle(option.id);
      }}
      role={details.multipleChoice ? "checkbox" : "radio"}
      tabIndex={tabIndex}
      type="button"
    >
      {details.multipleChoice && (
        <span className="mr-2 inline-block h-4 w-4 rounded-sm border border-current">
          {isSelected && (
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
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
}

function ClosedPollView({
  details,
  hasExistingVote,
}: {
  readonly details: PollDetails;
  readonly hasExistingVote: boolean;
}) {
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

function getSubmitButtonLabel(busy: boolean, hasExistingVote: boolean): string {
  if (busy) return "Submitting...";
  if (hasExistingVote) return "Update Vote";
  return "Submit Vote";
}

export function PollForm({
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

  const optionsContainerRef = useRef<HTMLDivElement>(null);
  const sortedOptions = useMemo(
    () => details.options.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [details.options],
  );

  const handleRadioKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (details.multipleChoice) return;
    const radios =
      optionsContainerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    if (!radios || radios.length === 0) return;

    const activeEl = document.activeElement;
    const focusedIndex =
      activeEl instanceof HTMLButtonElement ? Array.from(radios).indexOf(activeEl) : -1;
    const selectedIndex = sortedOptions.findIndex((opt) => selected.includes(opt.id));
    const baseIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;

    const targetIndex = getNextRadioIndex(event.key, baseIndex, sortedOptions.length);
    if (targetIndex === null) return;

    event.preventDefault();
    const targetOption = sortedOptions[targetIndex];
    if (targetOption) {
      setSelected([targetOption.id]);
      radios[targetIndex]?.focus();
    }
  };

  if (details.options.length === 0) {
    return (
      <div className="mt-4 space-y-3">
        <p className="notice notice--info" role="status">
          No options are available for this poll.
        </p>
        <a className="button button--secondary w-full" href="/">
          Return to the Organization site
        </a>
      </div>
    );
  }

  if (!details.canSubmit) {
    return <ClosedPollView details={details} hasExistingVote={hasExistingVote} />;
  }

  const isSubmitDisabled = busy || selected.length === 0;

  return (
    <div className="mt-4 space-y-3">
      {hasExistingVote && (
        <p className="notice notice--info" role="status">
          Your vote is currently recorded. You can change your response until{" "}
          {details.expiresAt ? formatExpiry(details.expiresAt) : "the poll closes"}.
        </p>
      )}
      <fieldset className="border-0 p-0 m-0">
        <legend className="sr-only">
          {details.multipleChoice
            ? "Poll options (select one or more)"
            : "Poll options (select one)"}
        </legend>
        <div
          aria-label={details.multipleChoice ? undefined : "Poll options"}
          className="space-y-2"
          onKeyDown={details.multipleChoice ? undefined : handleRadioKeyDown}
          ref={optionsContainerRef}
          role={details.multipleChoice ? undefined : "radiogroup"}
        >
          {sortedOptions.map((option, index) => (
            <PollOptionItem
              details={details}
              hasSelection={selected.length > 0}
              index={index}
              isSelected={selected.includes(option.id)}
              key={option.id}
              onToggle={toggleOption}
              option={option}
            />
          ))}
        </div>
      </fieldset>

      {selected.length === 0 && (
        <p className="field-help" id="poll-submit-hint">
          Select at least one option to submit your vote.
        </p>
      )}

      <button
        aria-describedby={selected.length === 0 ? "poll-submit-hint" : undefined}
        className={`button button--primary w-full ${isSubmitDisabled ? "button--disabled" : ""}`}
        disabled={isSubmitDisabled}
        onClick={() => {
          onSubmit(selected);
        }}
        type="button"
      >
        {getSubmitButtonLabel(busy, hasExistingVote)}
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

  function handleRetry() {
    if (!token) return;
    setPageStatus({ type: "loading" });
    fetchPollDetails(token)
      .then((details) => {
        setPageStatus({ type: "ready", details });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }

  if (pageStatus.type === "no_token") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="poll-title" className="auth-card">
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
        <section aria-labelledby="poll-title" className="auth-card">
          <h1 id="poll-title">Loading Poll...</h1>
          <p className="notice notice--info" role="status">
            Loading poll options…
          </p>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="poll-title" className="auth-card">
          <h1 id="poll-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This poll link is invalid or expired. Contact an Organization manager for a new link.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button className="button button--primary" onClick={handleRetry} type="button">
              Retry
            </button>
            <a className="button button--secondary" href="/">
              Return to the Organization site
            </a>
          </div>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "submitted") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="poll-title">
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
