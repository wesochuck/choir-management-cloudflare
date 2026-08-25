import { useEffect, useState } from "react";

import { publicAuditionSettingsSchema, type DayOfWeek } from "@choir/contracts";
import { areAuditionDatesPassed } from "@choir/domain";
import { responseError } from "../auth/api/client";

interface AuditionSlot {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface PublicAuditionPerformance {
  readonly id: string;
  readonly startsAt: string;
  readonly title: string;
}

interface PublicAuditionVenue {
  readonly address: string;
  readonly name: string;
}

interface PublicAuditionSection {
  readonly code: string;
  readonly name: string;
}

interface PublicAuditionVoicePart {
  readonly fullName: string;
  readonly label: string;
  readonly sectionCode: string;
}

interface RehearsalSession {
  readonly dayOfWeek: DayOfWeek;
  readonly endTime: string;
  readonly locationName: string;
  readonly startTime: string;
  readonly venueId: string | null;
  readonly venue: PublicAuditionVenue | null;
}

interface AuditionDetails {
  readonly id: string;
  readonly createdAt: string;
  readonly name: string;
  readonly performerLabel?: string;
  readonly voicePart?: string;
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
  readonly mode: "audition" | "open_inquiry";
  readonly performerLabel: string;
  readonly performance: PublicAuditionPerformance | null;
  readonly rehearsalNotes: string;
  readonly rehearsalSchedule: readonly RehearsalSession[];
  readonly sections: readonly PublicAuditionSection[];
  readonly slots: readonly AuditionSlot[];
  readonly startDate: string | null;
  readonly timezone: string;
  readonly venue: PublicAuditionVenue | null;
  readonly voiceParts: readonly PublicAuditionVoicePart[];
}

const fallbackPublicAuditionSettings: PublicAuditionSettings = {
  confirmationMessage: "Thank you for your interest. We will be in touch soon.",
  defaultPerformanceId: null,
  enabled: true,
  mode: "audition",
  performerLabel: "Performer",
  performance: null,
  rehearsalNotes: "",
  rehearsalSchedule: [],
  sections: [],
  slots: [],
  startDate: null,
  timezone: "UTC",
  venue: null,
  voiceParts: [],
};

type PageStatus =
  | { type: "loading" }
  | { type: "ready_form"; settings: PublicAuditionSettings }
  | { type: "closed"; message: string }
  | { type: "submitting_inquiry"; settings: PublicAuditionSettings }
  | {
      type: "inquiry_submitted";
      confirmationMessage: string;
      id: string;
      mode: "audition" | "open_inquiry";
    }
  | { type: "inquiry_error"; message: string; settings: PublicAuditionSettings }
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
    "status" in value &&
    (!("performerLabel" in value) ||
      value.performerLabel === undefined ||
      typeof value.performerLabel === "string")
  );
}

function formatAuditionDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    timeZone: timezone,
    timeZoneName: "short",
    weekday: "long",
    year: "numeric",
  };
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: undefined }).format(date);
  }
}

function formatTime12h(timeStr: string): string {
  if (!timeStr) return "";
  const [hoursStr, minutesStr] = timeStr.split(":");
  const hours = parseInt(hoursStr ?? "0", 10);
  const minutes = parseInt(minutesStr ?? "0", 10);
  if (Number.isNaN(hours)) return timeStr;
  const period = hours >= 12 ? "PM" : "AM";
  const formattedHours = String(hours % 12 === 0 ? 12 : hours % 12);
  const formattedMinutes = minutes < 10 ? `0${String(minutes)}` : String(minutes);
  return `${formattedHours}:${formattedMinutes} ${period}`;
}

function capitalizeDay(day: string): string {
  if (!day) return "";
  return day.charAt(0).toUpperCase() + day.slice(1);
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
      const parsed = publicAuditionSettingsSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_settings");
      const normalizedSlots = parsed.data.slots.map((slot) => ({
        ...slot,
        id: slot.id ?? slot.startsAt,
      }));
      return {
        ...parsed.data,
        slots: normalizedSlots,
      };
    });
  });
}

function formatStartDate(dateStr: string): string {
  const date = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  };
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return dateStr;
  }
}

function RehearsalScheduleCard({ settings }: { readonly settings: PublicAuditionSettings }) {
  if (settings.rehearsalSchedule.length === 0 && !settings.rehearsalNotes && !settings.startDate) {
    return null;
  }
  return (
    <section aria-label="Regular rehearsal schedule" className="audition-event-details">
      {settings.startDate && (
        <div className="audition-event-details__item">
          <span className="audition-event-details__label">Start Date</span>
          <strong className="audition-event-details__value">
            {formatStartDate(settings.startDate)}
          </strong>
        </div>
      )}
      {settings.rehearsalSchedule.length > 0 && (
        <div className="audition-event-details__item">
          <span className="audition-event-details__label">Regular Rehearsals</span>
          <strong className="audition-event-details__value">
            {settings.rehearsalSchedule
              .map((session) => {
                const venueText = session.venue
                  ? ` at ${session.venue.name}${session.venue.address ? `, ${session.venue.address}` : ""}`
                  : session.locationName
                    ? ` (${session.locationName})`
                    : "";
                return `Every ${capitalizeDay(session.dayOfWeek)} from ${formatTime12h(
                  session.startTime,
                )} to ${formatTime12h(session.endTime)}${venueText}`;
              })
              .join("; ")}
          </strong>
        </div>
      )}
      {settings.rehearsalNotes && (
        <div className="audition-event-details__item">
          <span className="audition-event-details__label">Schedule Notes</span>
          <span className="audition-event-details__secondary">{settings.rehearsalNotes}</span>
        </div>
      )}
    </section>
  );
}

function AuditionEventDetails({ settings }: { readonly settings: PublicAuditionSettings }) {
  if (!settings.performance && !settings.venue) return null;
  return (
    <section aria-label="Audition details" className="audition-event-details">
      {settings.venue ? (
        <div className="audition-event-details__item">
          <span className="audition-event-details__label">Audition location</span>
          <strong className="audition-event-details__value">{settings.venue.name}</strong>
          {settings.venue.address ? (
            <span className="audition-event-details__secondary">{settings.venue.address}</span>
          ) : null}
        </div>
      ) : null}
      {settings.performance ? (
        <div className="audition-event-details__item">
          <span className="audition-event-details__label">Concert</span>
          <strong className="audition-event-details__value">{settings.performance.title}</strong>
          <span className="audition-event-details__secondary">
            {formatAuditionDate(settings.performance.startsAt, settings.timezone)}
          </span>
        </div>
      ) : null}
    </section>
  );
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
  }).then(async (response) => {
    if (!response.ok) throw await responseError(response);
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

  const isAuditionMode = settings.mode === "audition";

  return (
    <div className="form-stack audition-form">
      <label className="field" htmlFor="audition-name">
        Name *
        <input
          id="audition-name"
          onChange={(e) => {
            setName(e.target.value);
          }}
          required
          type="text"
          value={name}
        />
      </label>
      <label className="field" htmlFor="audition-email">
        Email *
        <input
          id="audition-email"
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          required
          type="email"
          value={email}
        />
      </label>
      <label className="field" htmlFor="audition-phone">
        Phone
        <input
          id="audition-phone"
          onChange={(e) => {
            setPhone(e.target.value);
          }}
          type="tel"
          value={phone}
        />
      </label>
      <label className="field" htmlFor="audition-voice-part">
        Section
        <select
          id="audition-voice-part"
          onChange={(e) => {
            setVoicePart(e.target.value);
          }}
          value={voicePart}
        >
          <option value="">Unsure / Placement needed</option>
          {settings.sections.map((section) => (
            <option key={section.code} value={section.name}>
              {section.name}
            </option>
          ))}
        </select>
        <span className="field-help">
          Select your preferred section, or choose Unsure if you need placement help.
        </span>
      </label>
      <label className="field" htmlFor="audition-experience">
        Musical experience
        <textarea
          id="audition-experience"
          maxLength={5000}
          onChange={(e) => {
            setExperience(e.target.value);
          }}
          placeholder="Tell us about your singing or musical background..."
          rows={4}
          value={experience}
        />
      </label>
      {isAuditionMode && settings.slots.length > 0 && (
        <fieldset className="audition-slot-picker">
          <legend>Preferred audition times</legend>
          <p className="audition-slot-picker__hint">Select any times that work for you.</p>
          <div className="audition-slot-options">
            {settings.slots.map((slot) => {
              const selected = requestedSlots.includes(slot.startsAt);
              return (
                <label className="audition-slot-option" key={slot.id}>
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
                  <span>{formatAuditionDate(slot.startsAt, settings.timezone)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      <button
        className={`button button--primary audition-form__submit ${busy || !name || !email ? "button--disabled" : ""}`}
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
        {busy ? "Submitting..." : isAuditionMode ? "Submit Audition Request" : "Submit Inquiry"}
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
          Section
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
        className={`button button--primary w-full ${submitting ? "button--disabled" : ""}`}
        disabled={submitting}
        onClick={handleUpdate}
        type="button"
      >
        {submitting ? "Saving..." : "Update Information"}
      </button>
    </div>
  );
}

function PublicAuditionStatusCard({
  onRetry,
  pageStatus,
  retrySettings,
}: {
  readonly onRetry: () => void;
  readonly pageStatus: PageStatus;
  readonly retrySettings: PublicAuditionSettings;
}) {
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
          <p className="eyebrow">Intake</p>
          <h1 id="audition-title">Inquiries are currently closed</h1>
          <p className="notice">{pageStatus.message}</p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "inquiry_submitted") {
    const isOpenInquiry = pageStatus.mode === "open_inquiry";
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <p className="eyebrow">{isOpenInquiry ? "Join Us" : "Audition"}</p>
          <h1 id="audition-title">Inquiry Received</h1>
          <p className="notice notice--success" role="status">
            {pageStatus.confirmationMessage ||
              (isOpenInquiry
                ? "Thank you for your interest! Your inquiry has been received. The organization will be in touch with rehearsal details."
                : "Thank you for your interest! Your audition inquiry has been received. The organization will reach out to you with next steps.")}
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "inquiry_error") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="audition-title">
          <p className="eyebrow">
            {retrySettings.mode === "open_inquiry" ? "Join Us" : "Audition"}
          </p>
          <h1 id="audition-title">Submission Error</h1>
          <p className="notice notice--error" role="alert">
            {pageStatus.message}
          </p>
          <button className="button button--secondary" onClick={onRetry} type="button">
            Try again
          </button>
        </section>
      </main>
    );
  }

  return null;
}

export function PublicAuditionView() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    type: "loading",
  });

  useEffect(() => {
    const currentPath = window.location.pathname === "/join" ? "/join" : "/auditions";
    window.history.replaceState(null, "", currentPath);
    if (!token) {
      fetchAuditionSettings()
        .then((settings) => {
          const isClosed =
            !settings.enabled ||
            (settings.mode === "audition" &&
              (!settings.defaultPerformanceId ||
                settings.slots.length === 0 ||
                areAuditionDatesPassed(settings)));

          if (isClosed) {
            setPageStatus({
              type: "closed",
              message:
                settings.mode === "open_inquiry"
                  ? "Join inquiries are not currently open. Please check back later."
                  : "Audition requests are not currently open. Please check back later.",
            });
            return;
          }
          setPageStatus({ settings, type: "ready_form" });
        })
        .catch(() => {
          setPageStatus({ settings: fallbackPublicAuditionSettings, type: "ready_form" });
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
        : fallbackPublicAuditionSettings;
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
        setPageStatus({
          confirmationMessage: settings.confirmationMessage,
          id,
          mode: settings.mode,
          type: "inquiry_submitted",
        });
      })
      .catch((failure: unknown) => {
        setPageStatus({
          message:
            failure instanceof Error
              ? failure.message
              : "Your inquiry could not be submitted. Please try again later.",
          settings,
          type: "inquiry_error",
        });
      });
  }

  const formSettings =
    pageStatus.type === "ready_form" || pageStatus.type === "submitting_inquiry"
      ? pageStatus.settings
      : fallbackPublicAuditionSettings;

  if (
    pageStatus.type === "loading" ||
    pageStatus.type === "not_found" ||
    pageStatus.type === "closed" ||
    pageStatus.type === "inquiry_submitted" ||
    pageStatus.type === "inquiry_error"
  ) {
    return (
      <PublicAuditionStatusCard
        onRetry={() => {
          setPageStatus({ settings: formSettings, type: "ready_form" });
        }}
        pageStatus={pageStatus}
        retrySettings={formSettings}
      />
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

  const isOpenInquiry = formSettings.mode === "open_inquiry";

  return (
    <main className="auth-layout">
      <section className="auth-card public-audition-card" aria-labelledby="audition-title">
        <p className="eyebrow">{isOpenInquiry ? "Join Us" : "Audition"}</p>
        <h1 id="audition-title">{isOpenInquiry ? "Join Inquiry" : "Audition Inquiry"}</h1>
        <p className="auth-card__intro">
          {isOpenInquiry
            ? "Interested in singing with us? Fill out the form below and we will be in touch with rehearsal details."
            : "Interested in joining? Fill out the form below and select your preferred audition times."}
        </p>
        {isOpenInquiry ? (
          <RehearsalScheduleCard settings={formSettings} />
        ) : (
          <AuditionEventDetails settings={formSettings} />
        )}
        <AuditionForm
          busy={pageStatus.type === "submitting_inquiry"}
          onSubmit={handleInquirySubmit}
          settings={formSettings}
        />
      </section>
    </main>
  );
}
