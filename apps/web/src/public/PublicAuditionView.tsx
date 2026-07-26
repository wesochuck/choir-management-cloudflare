import { useEffect, useState } from "react";

interface AuditionSlot {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface AuditionDetails {
  readonly id: string;
  readonly createdAt: string;
  readonly email: string;
  readonly name: string;
  readonly phone?: string;
  readonly voicePart?: string;
  readonly experience?: string;
  readonly availabilityNotes?: string;
  readonly requestedSlots?: readonly string[];
  readonly scheduledTimeSlot?: string | null;
  readonly status: string;
  readonly slots: AuditionSlot[];
}

interface PublicAuditionSettings {
  readonly confirmationMessage: string;
  readonly defaultPerformanceId: string | null;
  readonly enabled: boolean;
  readonly slots: readonly AuditionSlot[];
}

type PageStatus =
  | { type: "loading" }
  | { type: "ready_form"; settings: PublicAuditionSettings }
  | { type: "closed"; message: string }
  | { type: "submitting_inquiry"; settings: PublicAuditionSettings }
  | { type: "inquiry_submitted"; id: string }
  | { type: "inquiry_error"; settings: PublicAuditionSettings }
  | { type: "not_found" }
  | { type: "ready_details"; details: AuditionDetails }
  | { type: "updating"; details: AuditionDetails }
  | { type: "updated"; details: AuditionDetails }
  | { type: "update_error"; details: AuditionDetails };

function isAuditionDetails(value: unknown): value is AuditionDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "email" in value &&
    "status" in value
  );
}

function isAuditionSlotValue(
  value: unknown,
): value is Omit<AuditionSlot, "id"> & { readonly id?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  if (!("startsAt" in value) || typeof value.startsAt !== "string") return false;
  if (!("endsAt" in value) || typeof value.endsAt !== "string") return false;
  return true;
}

function fetchAuditionDetails(token: string): Promise<AuditionDetails> {
  return fetch("/api/public/audition-details", {
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("not_found");
    return response.json().then((data: unknown) => {
      if (isAuditionDetails(data)) return data;
      throw new Error("invalid_response");
    });
  });
}

function fetchAuditionSettings(): Promise<PublicAuditionSettings> {
  return fetch("/api/public/audition-settings").then((response) => {
    if (!response.ok) throw new Error("settings_failed");
    return response.json().then((data: unknown) => {
      if (typeof data !== "object" || data === null) throw new Error("invalid_settings");
      if (!("enabled" in data) || typeof data.enabled !== "boolean")
        throw new Error("invalid_settings");
      if (
        !("defaultPerformanceId" in data) ||
        (data.defaultPerformanceId !== null && typeof data.defaultPerformanceId !== "string")
      ) {
        throw new Error("invalid_settings");
      }
      const slots = "slots" in data && Array.isArray(data.slots) ? data.slots : [];
      const parsedSlots = slots.filter(isAuditionSlotValue);
      const normalizedSlots = parsedSlots.map((slot) => ({
        ...slot,
        id: "id" in slot && typeof slot.id === "string" ? slot.id : slot.startsAt,
      }));
      return {
        confirmationMessage:
          "confirmationMessage" in data && typeof data.confirmationMessage === "string"
            ? data.confirmationMessage
            : "Thank you for your interest. We will be in touch soon.",
        defaultPerformanceId: data.defaultPerformanceId,
        enabled: data.enabled,
        slots: normalizedSlots,
      };
    });
  });
}

function submitInquiry(
  name: string,
  email: string,
  phone: string,
  voicePart: string,
  experience: string,
  availabilityNotes: string,
  requestedSlots: readonly string[],
): Promise<string> {
  return fetch("/api/public/audition-inquiry", {
    body: JSON.stringify({
      availabilityNotes,
      email,
      experience,
      name,
      phone,
      requestedSlots,
      voicePart,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("submit_failed");
    return response.json().then((data: unknown) => {
      if (typeof data !== "object" || data === null) throw new Error("invalid_response");
      if (!("id" in data)) throw new Error("invalid_response");
      const id = data.id;
      if (typeof id === "string") return id;
      throw new Error("invalid_response");
    });
  });
}

function submitAuditionUpdate(
  token: string,
  voicePart: string,
  availabilityNotes: string,
): Promise<void> {
  return fetch("/api/public/audition-submit", {
    body: JSON.stringify({ availabilityNotes, token, voicePart }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("update_failed");
  });
}

function AuditionForm({
  onSubmit,
  busy,
  settings,
}: {
  readonly busy: boolean;
  readonly settings: PublicAuditionSettings;
  readonly onSubmit: (data: {
    availabilityNotes: string;
    email: string;
    experience: string;
    name: string;
    phone: string;
    requestedSlots: readonly string[];
    voicePart: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [voicePart, setVoicePart] = useState("");
  const [experience, setExperience] = useState("");
  const [requestedSlots, setRequestedSlots] = useState<readonly string[]>([]);

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label className="block text-sm font-medium" htmlFor="audition-name">
          Name *
        </label>
        <input
          className="mt-1 w-full rounded border p-2"
          id="audition-name"
          onChange={(e) => {
            setName(e.target.value);
          }}
          required
          type="text"
          value={name}
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="audition-email">
          Email *
        </label>
        <input
          className="mt-1 w-full rounded border p-2"
          id="audition-email"
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          required
          type="email"
          value={email}
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="audition-phone">
          Phone
        </label>
        <input
          className="mt-1 w-full rounded border p-2"
          id="audition-phone"
          onChange={(e) => {
            setPhone(e.target.value);
          }}
          type="tel"
          value={phone}
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="audition-voice-part">
          Voice Part
        </label>
        <input
          className="mt-1 w-full rounded border p-2"
          id="audition-voice-part"
          onChange={(e) => {
            setVoicePart(e.target.value);
          }}
          placeholder="e.g. Soprano, Alto, Tenor, Bass"
          type="text"
          value={voicePart}
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="audition-experience">
          Musical Experience
        </label>
        <textarea
          className="mt-1 w-full rounded border p-2 text-sm"
          id="audition-experience"
          maxLength={5000}
          onChange={(e) => {
            setExperience(e.target.value);
          }}
          placeholder="Tell us about your singing or musical background..."
          rows={4}
          value={experience}
        />
      </div>
      {settings.slots.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Preferred audition times</legend>
          <p className="text-sm text-muted-foreground">Select any times that work for you.</p>
          <div className="space-y-2">
            {settings.slots.map((slot) => {
              const selected = requestedSlots.includes(slot.startsAt);
              return (
                <label className="flex items-center gap-2 text-sm" key={slot.id}>
                  <input
                    checked={selected}
                    onChange={() => {
                      setRequestedSlots((current) =>
                        selected
                          ? current.filter((value) => value !== slot.startsAt)
                          : [...current, slot.startsAt],
                      );
                    }}
                    type="checkbox"
                  />
                  {new Date(slot.startsAt).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      <button
        className={`button w-full ${busy || !name || !email ? "button--disabled" : ""}`}
        disabled={busy || !name || !email}
        onClick={() => {
          onSubmit({
            availabilityNotes: "",
            email,
            experience,
            name,
            phone,
            requestedSlots,
            voicePart,
          });
        }}
        type="button"
      >
        {busy ? "Submitting..." : "Submit Inquiry"}
      </button>
    </div>
  );
}

function AuditionDetailView({
  details,
  token,
}: {
  readonly details: AuditionDetails;
  readonly token: string;
}) {
  const [voicePart, setVoicePart] = useState(details.voicePart ?? "");
  const [availabilityNotes, setAvailabilityNotes] = useState(details.availabilityNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleUpdate() {
    setSubmitting(true);
    submitAuditionUpdate(token, voicePart, availabilityNotes)
      .then(() => {
        setSubmitted(true);
        setSubmitting(false);
      })
      .catch(() => {
        setSubmitting(false);
      });
  }

  const statusLabel: Record<string, string> = {
    cancelled: "Cancelled",
    completed: "Completed",
    no_show: "No Show",
    pending: "Pending Review",
    scheduled: "Scheduled",
  };

  if (submitted) {
    return (
      <p className="notice notice--success" role="status">
        Your information has been updated. Thank you!
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded border p-4">
        <p className="text-sm text-muted-foreground">
          Status: <strong>{statusLabel[details.status] ?? details.status}</strong>
        </p>
        <p className="text-sm text-muted-foreground">
          Submitted: {new Date(details.createdAt).toLocaleDateString()}
        </p>
        {details.scheduledTimeSlot && (
          <p className="text-sm text-muted-foreground">
            Scheduled audition: {new Date(details.scheduledTimeSlot).toLocaleString()}
          </p>
        )}
        {details.requestedSlots && details.requestedSlots.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Preferred times:{" "}
            {details.requestedSlots.map((slot) => new Date(slot).toLocaleString()).join(", ")}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="update-voice-part">
          Voice Part
        </label>
        <input
          className="mt-1 w-full rounded border p-2"
          id="update-voice-part"
          onChange={(e) => {
            setVoicePart(e.target.value);
          }}
          type="text"
          value={voicePart}
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="update-availability">
          Availability Notes
        </label>
        <textarea
          className="mt-1 w-full rounded border p-2 text-sm"
          id="update-availability"
          maxLength={5000}
          onChange={(e) => {
            setAvailabilityNotes(e.target.value);
          }}
          rows={4}
          value={availabilityNotes}
        />
      </div>
      <button
        className={`button w-full ${submitting ? "button--disabled" : ""}`}
        disabled={submitting}
        onClick={handleUpdate}
        type="button"
      >
        {submitting ? "Saving..." : "Update Information"}
      </button>
    </div>
  );
}

export function PublicAuditionView() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    type: "loading",
  });

  useEffect(() => {
    window.history.replaceState(null, "", "/auditions");
    if (!token) {
      fetchAuditionSettings()
        .then((settings) => {
          if (!settings.enabled || !settings.defaultPerformanceId || settings.slots.length === 0) {
            setPageStatus({
              type: "closed",
              message: "Audition requests are not currently open. Please check back later.",
            });
            return;
          }
          setPageStatus({ settings, type: "ready_form" });
        })
        .catch(() => {
          setPageStatus({
            settings: {
              confirmationMessage: "Thank you for your interest. We will be in touch soon.",
              defaultPerformanceId: "legacy-fallback",
              enabled: true,
              slots: [],
            },
            type: "ready_form",
          });
        });
      return;
    }
    fetchAuditionDetails(token)
      .then((details) => {
        setPageStatus({ type: "ready_details", details });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }, [token]);

  function handleInquirySubmit(data: {
    availabilityNotes: string;
    email: string;
    experience: string;
    name: string;
    phone: string;
    requestedSlots: readonly string[];
    voicePart: string;
  }) {
    const settings =
      pageStatus.type === "ready_form" || pageStatus.type === "submitting_inquiry"
        ? pageStatus.settings
        : {
            confirmationMessage: "",
            defaultPerformanceId: null,
            enabled: true,
            slots: [],
          };
    setPageStatus({ settings, type: "submitting_inquiry" });
    submitInquiry(
      data.name,
      data.email,
      data.phone,
      data.voicePart,
      data.experience,
      data.availabilityNotes,
      data.requestedSlots,
    )
      .then((id) => {
        setPageStatus({ type: "inquiry_submitted", id });
      })
      .catch(() => {
        setPageStatus({ settings, type: "inquiry_error" });
      });
  }

  if (pageStatus.type === "loading") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <h1 id="audition-title">Loading...</h1>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <h1 id="audition-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This audition link is invalid or expired. Contact the organization for a new link.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "closed") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <p className="eyebrow">Audition</p>
          <h1 id="audition-title">Auditions are currently closed</h1>
          <p className="notice">{pageStatus.message}</p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "inquiry_submitted") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <p className="eyebrow">Audition</p>
          <h1 id="audition-title">Inquiry Received</h1>
          <p className="notice notice--success" role="status">
            Thank you for your interest! Your audition inquiry has been received. The organization
            will reach out to you with next steps.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "inquiry_error") {
    const retrySettings = pageStatus.settings;
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <p className="eyebrow">Audition</p>
          <h1 id="audition-title">Submission Error</h1>
          <p className="notice notice--error" role="alert">
            Your inquiry could not be submitted. Please try again later.
          </p>
          <button
            className="button button--secondary"
            onClick={() => {
              setPageStatus({ settings: retrySettings, type: "ready_form" });
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "ready_details") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <p className="eyebrow">Audition</p>
          <h1 id="audition-title">Your Audition</h1>
          <p>
            Welcome, <strong>{pageStatus.details.name}</strong>.
          </p>
          <hr className="my-4" />
          <AuditionDetailView details={pageStatus.details} token={token ?? ""} />
        </section>
      </main>
    );
  }

  const formSettings =
    pageStatus.type === "ready_form" || pageStatus.type === "submitting_inquiry"
      ? pageStatus.settings
      : {
          confirmationMessage: "",
          defaultPerformanceId: null,
          enabled: true,
          slots: [],
        };
  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="audition-title">
        <p className="eyebrow">Audition</p>
        <h1 id="audition-title">Audition Inquiry</h1>
        <p>Interested in joining? Fill out the form below and we will be in touch.</p>
        <p className="notice">{formSettings.confirmationMessage}</p>
        <hr className="my-4" />
        <AuditionForm
          busy={pageStatus.type === "submitting_inquiry"}
          settings={formSettings}
          onSubmit={handleInquirySubmit}
        />
      </section>
    </main>
  );
}
