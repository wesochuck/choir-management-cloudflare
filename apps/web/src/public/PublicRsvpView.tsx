import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { getPublicRsvpDetails, submitPublicQuickRsvp } from "../api";

interface EventDetails {
  readonly callTime: string;
  readonly details: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: string;
  readonly venueAddress: string;
  readonly venueName: string;
}

export interface RsvpDetails {
  readonly canSubmit: boolean;
  readonly event: EventDetails;
  readonly profileId: string;
  readonly profileName: string;
  readonly rsvp: string;
  readonly rsvpNote: string;
}

type PageStatus =
  | { type: "loading" }
  | { type: "no_token" }
  | { type: "not_found" }
  | { type: "ready"; details: RsvpDetails }
  | { type: "submitting"; details: RsvpDetails }
  | { type: "submit_error"; details: RsvpDetails }
  | { type: "submitted"; details: RsvpDetails };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

async function fetchRsvpDetails(token: string): Promise<RsvpDetails> {
  try {
    return await getPublicRsvpDetails(token);
  } catch {
    throw new Error("not_found");
  }
}

async function submitRsvp(
  token: string,
  rsvpValue: "Yes" | "No" | "Pending",
  note: string,
): Promise<void> {
  try {
    await submitPublicQuickRsvp(token, rsvpValue, note);
  } catch {
    throw new Error("submit_failed");
  }
}

function RsvpClosedNotice({ details }: { readonly details: RsvpDetails }) {
  return (
    <div className="notice notice--warning" role="status">
      <p>
        RSVP responses are closed for this event.
        {details.rsvp !== "Pending" && (
          <>
            {" "}
            Your recorded response is{" "}
            <strong>{details.rsvp === "Yes" ? "Attending" : "Not attending"}</strong>
            {details.rsvpNote ? ` ("${details.rsvpNote}")` : ""}.
          </>
        )}{" "}
        Contact an Organization manager if you need to update your response.
      </p>
    </div>
  );
}

function RsvpDeclineNoteField({
  hasError,
  noteRequired,
  rsvpNote,
  onChange,
}: {
  readonly hasError: boolean;
  readonly noteRequired: boolean;
  readonly rsvpNote: string;
  readonly onChange: (note: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor="public-rsvp-note">
        Decline note{noteRequired ? " (required for rehearsals)" : " (optional)"}
      </label>
      <textarea
        aria-describedby={hasError ? "decline-note-error" : undefined}
        aria-invalid={hasError}
        aria-required={noteRequired}
        className="w-full rounded border p-3 text-sm"
        id="public-rsvp-note"
        maxLength={2000}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={
          noteRequired
            ? "Tell the Organization why you cannot attend..."
            : "Let us know why (optional)..."
        }
        required={noteRequired}
        rows={3}
        value={rsvpNote}
      />
      {hasError ? (
        <p className="field-help field-help--error" id="decline-note-error" role="alert">
          A note explaining your absence is required when declining a rehearsal.
        </p>
      ) : null}
    </div>
  );
}

function getInitialRsvp(status: string): "Yes" | "No" | null {
  if (status === "Yes") return "Yes";
  if (status === "No") return "No";
  return null;
}

function getRsvpSubmitLabel(busy: boolean, currentRsvp: string): string {
  if (busy) return "Submitting...";
  if (currentRsvp !== "Pending") return "Update RSVP";
  return "Submit RSVP";
}

function AttendanceButtons({
  onSelect,
  rsvp,
}: {
  readonly onSelect: (value: "Yes" | "No") => void;
  readonly rsvp: "Yes" | "No" | null;
}) {
  const isAttending = rsvp === "Yes";
  const isDeclining = rsvp === "No";
  const yesRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onSelect("No");
      noRef.current?.focus();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onSelect("Yes");
      yesRef.current?.focus();
    }
  };

  return (
    <fieldset className="space-y-3 border-0 p-0 m-0">
      <legend className="sr-only">Attendance response</legend>
      <div
        aria-label="Attendance response"
        className="flex gap-2"
        onKeyDown={handleKeyDown}
        role="radiogroup"
      >
        <button
          aria-checked={isAttending}
          className={`flex-1 rounded border px-4 py-3 text-center font-medium transition-colors ${
            isAttending ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
          }`}
          onClick={() => {
            onSelect("Yes");
          }}
          ref={yesRef}
          role="radio"
          tabIndex={isDeclining ? -1 : 0}
          type="button"
        >
          I'll be there
        </button>
        <button
          aria-checked={isDeclining}
          className={`flex-1 rounded border px-4 py-3 text-center font-medium transition-colors ${
            isDeclining
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "hover:bg-muted"
          }`}
          onClick={() => {
            onSelect("No");
          }}
          ref={noRef}
          role="radio"
          tabIndex={isDeclining ? 0 : -1}
          type="button"
        >
          Can't make it
        </button>
      </div>
    </fieldset>
  );
}

export function RsvpForm({
  details,
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly details: RsvpDetails;
  readonly onSubmit: (rsvpValue: "Yes" | "No", rsvpNote: string) => void;
}) {
  const [rsvp, setRsvp] = useState<"Yes" | "No" | null>(() => getInitialRsvp(details.rsvp));
  const [rsvpNote, setRsvpNote] = useState(details.rsvpNote);
  const noteRequired = details.event.type === "Rehearsal" && rsvp === "No";
  const noteMissing = noteRequired && !rsvpNote.trim();
  const isDisabled = busy || rsvp === null || noteMissing;

  if (!details.canSubmit) {
    return <RsvpClosedNotice details={details} />;
  }

  return (
    <div className="mt-4 space-y-3">
      <AttendanceButtons onSelect={setRsvp} rsvp={rsvp} />

      {rsvp === "No" && (
        <RsvpDeclineNoteField
          hasError={noteMissing}
          noteRequired={noteRequired}
          onChange={setRsvpNote}
          rsvpNote={rsvpNote}
        />
      )}

      {rsvp === null ? (
        <p className="field-help" id="rsvp-selection-hint">
          Please select whether you will be attending before submitting.
        </p>
      ) : null}

      <button
        aria-describedby={rsvp === null ? "rsvp-selection-hint" : undefined}
        className={`button button--primary w-full ${isDisabled ? "button--disabled" : ""}`}
        disabled={isDisabled}
        onClick={() => {
          if (rsvp !== null) {
            onSubmit(rsvp, rsvpNote);
          }
        }}
        type="button"
      >
        {getRsvpSubmitLabel(busy, details.rsvp)}
      </button>
    </div>
  );
}

function RsvpEventBody({ details }: { readonly details: RsvpDetails }) {
  return (
    <>
      <h1 id="rsvp-title">{details.event.title}</h1>
      <p className="text-sm text-muted-foreground">
        {details.event.type} &middot; {formatDate(details.event.startsAt)} at{" "}
        {formatTime(details.event.startsAt)}
      </p>
      {details.event.venueName && (
        <p className="text-sm text-muted-foreground">
          {details.event.venueName}
          {details.event.venueAddress ? `, ${details.event.venueAddress}` : ""}
        </p>
      )}
      {details.event.durationMinutes && (
        <p className="text-sm text-muted-foreground">
          Duration: {details.event.durationMinutes} minutes
        </p>
      )}
      {details.event.callTime && (
        <p className="text-sm text-muted-foreground">Call time: {details.event.callTime}</p>
      )}
      {details.event.details && (
        <p className="whitespace-pre-wrap text-sm">{details.event.details}</p>
      )}

      <hr className="my-4" />

      <p>
        Hello <strong>{details.profileName}</strong>, please let us know if you can attend.
      </p>

      {details.rsvp !== "Pending" && (
        <div className="notice notice--info my-2">
          <p>
            Your current response:{" "}
            <strong>{details.rsvp === "Yes" ? "Attending" : "Not attending"}</strong>
            {details.rsvpNote ? ` — "${details.rsvpNote}"` : ""}
          </p>
        </div>
      )}
    </>
  );
}

export function PublicRsvpView() {
  const [token] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("token"),
  );
  const [pageStatus, setPageStatus] = useState<PageStatus>(() => ({
    type: token ? "loading" : "no_token",
  }));

  useEffect(() => {
    if (!token) return;
    fetchRsvpDetails(token)
      .then((details) => {
        setPageStatus({ type: "ready", details });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }, [token]);

  function handleSubmit(rsvpValue: "Yes" | "No", rsvpNote: string) {
    if (!token || (pageStatus.type !== "ready" && pageStatus.type !== "submit_error")) {
      return;
    }
    const details = pageStatus.details;
    setPageStatus({ type: "submitting", details });
    submitRsvp(token, rsvpValue, rsvpNote)
      .then(() => {
        const updatedDetails: RsvpDetails = { ...details, rsvp: rsvpValue, rsvpNote };
        setPageStatus({ type: "submitted", details: updatedDetails });
      })
      .catch(() => {
        setPageStatus({ type: "submit_error", details });
      });
  }

  function handleRetry() {
    if (!token) return;
    setPageStatus({ type: "loading" });
    fetchRsvpDetails(token)
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
        <section aria-labelledby="rsvp-title" className="auth-card">
          <h1 id="rsvp-title">RSVP Link Required</h1>
          <p className="notice notice--info" role="status">
            Please use the link from your invitation email to access this page.
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
        <section aria-labelledby="rsvp-title" className="auth-card">
          <h1 id="rsvp-title">Loading RSVP...</h1>
          <p className="notice notice--info" role="status">
            Loading RSVP details…
          </p>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="rsvp-title" className="auth-card">
          <h1 id="rsvp-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This RSVP link is invalid or expired. Contact an Organization manager for a new link.
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
        <section className="auth-card" aria-labelledby="rsvp-title">
          <h1 id="rsvp-title">RSVP Submitted</h1>
          <p className="notice notice--success" role="status">
            Thank you, {pageStatus.details.profileName}. Your response has been recorded as{" "}
            <strong>{pageStatus.details.rsvp === "Yes" ? "Attending" : "Not attending"}</strong>.
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
                Change response
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
      <section className="auth-card" aria-labelledby="rsvp-title">
        <RsvpEventBody details={pageStatus.details} />
        <RsvpForm
          busy={pageStatus.type === "submitting"}
          details={pageStatus.details}
          onSubmit={handleSubmit}
        />
        {pageStatus.type === "submit_error" && (
          <p className="notice notice--error" role="alert">
            Your RSVP could not be submitted. Please try again.
          </p>
        )}
      </section>
    </main>
  );
}
