import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { getPublicRsvpDetails, submitPublicQuickRsvp } from "../api";
import { getEventVenueDetails } from "../shared/venueDetails";

interface EventDetails {
  readonly callTime: string;
  readonly details: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly startsAt: string;
  readonly timezone: string;
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

function formatDate(iso: string, timezone: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
  });
}

function formatTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  });
}

function formatRsvpCallTime(callTime: string | null | undefined): string {
  if (!callTime) return "";
  const trimmed = callTime.trim();
  if (!trimmed) return "";
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return trimmed;
  const rawHours = match[1];
  const rawMinutes = match[2];
  if (!rawHours || !rawMinutes) return trimmed;
  const hours = parseInt(rawHours, 10);
  const minutes = parseInt(rawMinutes, 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return trimmed;
  const hour12 = hours % 12 || 12;
  const amPm = hours >= 12 ? "PM" : "AM";
  return `${String(hour12)}:${String(minutes).padStart(2, "0")} ${amPm}`;
}

function MapPinIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function DeclineIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
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
    <div className="notice notice--warning mt-5 mb-0" role="status">
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
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-text" htmlFor="public-rsvp-note">
        Decline note{noteRequired ? " (required for rehearsals)" : " (optional)"}
      </label>
      <textarea
        aria-describedby={hasError ? "decline-note-error" : undefined}
        aria-invalid={hasError}
        aria-required={noteRequired}
        className="w-full rounded-control border border-border bg-surface px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
        <p className="field-help field-help--error m-0" id="decline-note-error" role="alert">
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

  const baseChoiceClass =
    "inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-control border-2 px-4 py-3 text-center text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">Attendance response</legend>
      <div
        aria-label="Attendance response"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onKeyDown={handleKeyDown}
        role="radiogroup"
      >
        <button
          aria-checked={isAttending}
          className={`${baseChoiceClass} ${
            isAttending
              ? "border-primary bg-info-surface text-text"
              : "border-border bg-surface text-text hover:border-primary/60"
          }`}
          onClick={() => {
            onSelect("Yes");
          }}
          ref={yesRef}
          role="radio"
          tabIndex={isDeclining ? -1 : 0}
          type="button"
        >
          {isAttending ? <CheckIcon /> : null}
          <span>I'll be there</span>
        </button>
        <button
          aria-checked={isDeclining}
          className={`${baseChoiceClass} ${
            isDeclining
              ? "border-danger bg-danger-surface text-text"
              : "border-border bg-surface text-text hover:border-danger/60"
          }`}
          onClick={() => {
            onSelect("No");
          }}
          ref={noRef}
          role="radio"
          tabIndex={isDeclining ? 0 : -1}
          type="button"
        >
          {isDeclining ? <DeclineIcon /> : null}
          <span>Can't make it</span>
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
    <div className="mt-5 flex flex-col gap-4">
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
        <p className="field-help m-0" id="rsvp-selection-hint">
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

export function RsvpEventBody({ details }: { readonly details: RsvpDetails }) {
  const formattedCallTime = formatRsvpCallTime(details.event.callTime);
  const venueDetails = getEventVenueDetails(details.event);
  const locationLabel = [venueDetails.displayName, venueDetails.venueAddress]
    .filter(Boolean)
    .join(", ");
  const hasSecondaryMeta = Boolean(formattedCallTime || details.event.durationMinutes);

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[length:var(--font-size-hero)] leading-tight" id="rsvp-title">
          {details.event.title}
        </h1>
        <p className="m-0 text-sm font-medium text-text-muted">{details.event.type}</p>
      </header>

      <dl className="m-0 mt-5 grid gap-3.5 rounded-control border border-border bg-surface p-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs font-semibold text-text-muted">Date &amp; time</dt>
          <dd className="m-0 text-sm font-medium text-text">
            {formatDate(details.event.startsAt, details.event.timezone)} at{" "}
            {formatTime(details.event.startsAt, details.event.timezone)}
          </dd>
        </div>

        {hasSecondaryMeta ? (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {formattedCallTime ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-semibold text-text-muted">Call time</dt>
                <dd className="m-0 text-sm font-medium text-text">{formattedCallTime}</dd>
              </div>
            ) : null}
            {details.event.durationMinutes ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-semibold text-text-muted">Duration</dt>
                <dd className="m-0 text-sm font-medium text-text">
                  {details.event.durationMinutes} minutes
                </dd>
              </div>
            ) : null}
          </div>
        ) : null}

        {locationLabel ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-semibold text-text-muted">Location</dt>
            <dd className="m-0 text-sm text-text">
              {venueDetails.googleMapsUrl ? (
                <a
                  aria-label={`${locationLabel} on Google Maps (opens in a new tab)`}
                  className="inline-flex items-start gap-1.5 rounded-sm font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:text-primary-strong hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  href={venueDetails.googleMapsUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <MapPinIcon />
                  <span>{locationLabel}</span>
                </a>
              ) : (
                <span className="font-medium">{locationLabel}</span>
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      {details.event.details ? (
        <p className="mt-4 mb-0 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
          {details.event.details}
        </p>
      ) : null}

      <hr className="my-6 border-0 border-t border-border" />

      <p className="m-0 text-base text-text">
        Hello <strong>{details.profileName}</strong>, please let us know if you can attend.
      </p>

      {details.rsvp !== "Pending" && (
        <div className="notice notice--info mt-4 mb-0">
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
        <section aria-labelledby="rsvp-title" className="auth-card flex flex-col gap-4">
          <h1 className="m-0 text-[length:var(--font-size-hero)] leading-tight" id="rsvp-title">
            RSVP Link Required
          </h1>
          <p className="notice notice--info m-0" role="status">
            Please use the link from your invitation email to access this page.
          </p>
          <a className="button button--secondary w-full" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "loading") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="rsvp-title" className="auth-card flex flex-col gap-4">
          <h1 className="m-0 text-[length:var(--font-size-hero)] leading-tight" id="rsvp-title">
            Loading RSVP...
          </h1>
          <p className="notice notice--info m-0" role="status">
            Loading RSVP details…
          </p>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="rsvp-title" className="auth-card flex flex-col gap-4">
          <h1 className="m-0 text-[length:var(--font-size-hero)] leading-tight" id="rsvp-title">
            Link Not Found
          </h1>
          <p className="notice notice--error m-0" role="alert">
            This RSVP link is invalid or expired. Contact an Organization manager for a new link.
          </p>
          <div className="flex flex-col gap-3">
            <button className="button button--primary w-full" onClick={handleRetry} type="button">
              Retry
            </button>
            <a className="button button--secondary w-full" href="/">
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
        <section aria-labelledby="rsvp-title" className="auth-card flex flex-col gap-4">
          <h1 className="m-0 text-[length:var(--font-size-hero)] leading-tight" id="rsvp-title">
            RSVP Submitted
          </h1>
          <p className="notice notice--success m-0" role="status">
            Thank you, {pageStatus.details.profileName}. Your response has been recorded as{" "}
            <strong>{pageStatus.details.rsvp === "Yes" ? "Attending" : "Not attending"}</strong>.
          </p>
          <div className="flex flex-col gap-3">
            {pageStatus.details.canSubmit && (
              <button
                className="button button--primary w-full"
                onClick={() => {
                  setPageStatus({ type: "ready", details: pageStatus.details });
                }}
                type="button"
              >
                Change response
              </button>
            )}
            <a className="button button--secondary w-full" href="/">
              Return to the Organization site
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section aria-labelledby="rsvp-title" className="auth-card">
        <RsvpEventBody details={pageStatus.details} />
        <RsvpForm
          busy={pageStatus.type === "submitting"}
          details={pageStatus.details}
          onSubmit={handleSubmit}
        />
        {pageStatus.type === "submit_error" && (
          <p className="notice notice--error mt-4 mb-0" role="alert">
            Your RSVP could not be submitted. Please try again.
          </p>
        )}
      </section>
    </main>
  );
}
