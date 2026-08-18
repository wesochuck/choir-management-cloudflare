import { useEffect, useState } from "react";

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

interface RsvpDetails {
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

function isRsvpDetails(value: unknown): value is RsvpDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "canSubmit" in value &&
    "event" in value &&
    "profileId" in value &&
    "profileName" in value
  );
}

function fetchRsvpDetails(token: string): Promise<RsvpDetails> {
  return fetch("/api/public/rsvp-details", {
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("not_found");
    return response.json().then((data: unknown) => {
      if (isRsvpDetails(data)) return data;
      throw new Error("invalid_response");
    });
  });
}

function submitRsvp(
  token: string,
  rsvpValue: "Yes" | "No" | "Pending",
  note: string,
): Promise<void> {
  return fetch("/api/public/quick-rsvp", {
    body: JSON.stringify({ rsvp: rsvpValue, rsvpNote: note, token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("submit_failed");
  });
}

function RsvpForm({
  details,
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly details: RsvpDetails;
  readonly onSubmit: (rsvpValue: "Yes" | "No" | "Pending", rsvpNote: string) => void;
}) {
  const initialRsvp = details.rsvp === "Yes" ? "Yes" : details.rsvp === "No" ? "No" : "Yes";
  const [rsvp, setRsvp] = useState<"Yes" | "No" | "Pending">(initialRsvp);
  const [rsvpNote, setRsvpNote] = useState(details.rsvpNote);
  const noteRequired = details.event.type === "Rehearsal" && rsvp === "No";

  if (!details.canSubmit) {
    return (
      <p className="notice notice--warning" role="status">
        RSVP responses are closed for this event. Contact an Organization manager if you need to
        update your response.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex gap-2">
        <button
          className={`flex-1 rounded border px-4 py-3 text-center font-medium transition-colors ${
            rsvp === "Yes" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
          }`}
          onClick={() => {
            setRsvp("Yes");
          }}
          type="button"
        >
          I'll be there
        </button>
        <button
          className={`flex-1 rounded border px-4 py-3 text-center font-medium transition-colors ${
            rsvp === "No"
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "hover:bg-muted"
          }`}
          onClick={() => {
            setRsvp("No");
          }}
          type="button"
        >
          Can't make it
        </button>
      </div>

      {rsvp === "No" && (
        <div className="space-y-1">
          <label htmlFor="public-rsvp-note">
            Decline note{noteRequired ? " (required for rehearsals)" : " (optional)"}
          </label>
          <textarea
            aria-required={noteRequired}
            className="w-full rounded border p-3 text-sm"
            id="public-rsvp-note"
            maxLength={2000}
            onChange={(e) => {
              setRsvpNote(e.target.value);
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
        </div>
      )}

      <button
        className={`button button--primary w-full ${busy ? "button--disabled" : ""}`}
        disabled={busy || (noteRequired && !rsvpNote.trim())}
        onClick={() => {
          onSubmit(rsvp, rsvpNote);
        }}
        type="button"
      >
        {busy ? "Submitting..." : "Submit RSVP"}
      </button>
    </div>
  );
}

function RsvpEventBody({ details }: { readonly details: RsvpDetails }) {
  return (
    <>
      <p className="eyebrow">RSVP</p>
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
        <p className="text-sm text-muted-foreground">
          Your current response:{" "}
          <strong>{details.rsvp === "Yes" ? "Attending" : "Not attending"}</strong>
        </p>
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
    window.history.replaceState(null, "", "/rsvp");
    if (!token) return;
    fetchRsvpDetails(token)
      .then((details) => {
        setPageStatus({ type: "ready", details });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }, [token]);

  function handleSubmit(rsvpValue: "Yes" | "No" | "Pending", rsvpNote: string) {
    if (!token || (pageStatus.type !== "ready" && pageStatus.type !== "submit_error")) {
      return;
    }
    const details = pageStatus.details;
    setPageStatus({ type: "submitting", details });
    submitRsvp(token, rsvpValue, rsvpNote)
      .then(() => {
        setPageStatus({ type: "submitted", details });
      })
      .catch(() => {
        setPageStatus({ type: "submit_error", details });
      });
  }

  if (pageStatus.type === "no_token") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="rsvp-title">
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
        <section className="auth-card" aria-labelledby="rsvp-title">
          <h1 id="rsvp-title">Loading RSVP...</h1>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="rsvp-title">
          <h1 id="rsvp-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This RSVP link is invalid or expired. Contact an Organization manager for a new link.
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
        <section className="auth-card" aria-labelledby="rsvp-title">
          <p className="eyebrow">RSVP</p>
          <h1 id="rsvp-title">RSVP Submitted</h1>
          <p className="notice notice--success" role="status">
            Thank you, {pageStatus.details.profileName}. Your response has been recorded.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
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
