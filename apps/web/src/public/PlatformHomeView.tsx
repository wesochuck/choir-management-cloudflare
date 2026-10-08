import type { PlatformHomeTicketListing } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getPlatformHomeTickets, submitPlatformInquiry } from "../api";

function formatPerformanceDate(isoDateString: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(isoDateString));
  } catch {
    return new Date(isoDateString).toLocaleString();
  }
}

type TicketFeedState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly listings: readonly PlatformHomeTicketListing[];
      readonly status: "ready";
    };

type InquiryFormStatus = "idle" | "submitting" | "success" | "error";

interface PlatformHomeViewProps {
  readonly signedIn: boolean;
}

export function PlatformHomeView({ signedIn }: PlatformHomeViewProps) {
  const [ticketState, setTicketState] = useState<TicketFeedState>({ status: "loading" });

  // Inquiry form fields
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState("");
  const [websiteHoneypot, setWebsiteHoneypot] = useState("");
  const [formStatus, setFormStatus] = useState<InquiryFormStatus>("idle");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getPlatformHomeTickets(controller.signal)
      .then((listings) => {
        setTicketState({ listings, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setTicketState({ status: "error" });
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  async function handleInquirySubmit() {
    setFormStatus("submitting");
    setFormError(null);

    try {
      await submitPlatformInquiry({
        contactName,
        email,
        location,
        message,
        organizationName: orgName,
        website: websiteHoneypot,
      });
      setFormStatus("success");
    } catch (error: unknown) {
      setFormStatus("error");
      setFormError(
        error instanceof Error
          ? error.message
          : "We could not send your inquiry. Please verify your information and try again.",
      );
    }
  }

  function handleResetForm() {
    setOrgName("");
    setContactName("");
    setEmail("");
    setLocation("");
    setMessage("");
    setWebsiteHoneypot("");
    setFormStatus("idle");
    setFormError(null);
  }

  return (
    <main>
      {/* 1. Grounded platform hero without sales fluff */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <h1 id="hero-title">A calm, practical platform for community choirs.</h1>
          <p className="hero__lede">
            MusicSite is an independent workspace for choral ensembles — coordinating rehearsals,
            music libraries, singer rosters, and concert tickets without sales pitches or commercial
            clutter.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href={signedIn ? "/account" : "/login"}>
              {signedIn ? "Open your workspace" : "Sign in"}
            </a>
            <a className="button button--secondary" href="#member-access">
              How member access works
            </a>
            <a className="button button--secondary" href="#upcoming-tickets">
              Upcoming tickets
            </a>
            <a className="button button--secondary" href="#nonprofit-inquiries">
              Nonprofit inquiries
            </a>
          </div>
        </div>
      </section>

      {/* 2. Member & singer access guidance */}
      <section className="foundation" id="member-access" aria-labelledby="member-access-title">
        <div className="section-heading">
          <h2 id="member-access-title">Accessing your choir’s workspace.</h2>
          <p>
            MusicSite is an ensemble-first platform with no public registration. Membership and
            permissions are granted directly by your ensemble director or administrator.
          </p>
        </div>
        <div className="module-grid">
          <article className="module-card">
            <span className="module-card__index" aria-hidden="true">
              01
            </span>
            <h3>Invitations & Rosters</h3>
            <p>
              Singers join when invited by their choir. If you received an invitation email, click
              the activation link. If your choir director provided a roster invite link, you can
              enroll directly.
            </p>
            <div className="pt-4">
              <a className="button button--secondary" href="/join-roster">
                Join with roster link
              </a>
            </div>
          </article>

          <article className="module-card">
            <span className="module-card__index" aria-hidden="true">
              02
            </span>
            <h3>Passwordless Sign-In</h3>
            <p>
              Enter your email at sign-in to receive an instant, secure 6-digit one-time code. No
              passwords to remember or reset. Once signed in, you can register a Passkey on your
              phone or computer.
            </p>
            <div className="pt-4">
              <a className="button button--secondary" href="/login">
                Go to sign in
              </a>
            </div>
          </article>

          <article className="module-card">
            <span className="module-card__index" aria-hidden="true">
              03
            </span>
            <h3>Music & Practice Tools</h3>
            <p>
              Active members have access to sheet music files, part-specific practice audio,
              rehearsal calendars, attendance RSVP, and section directories for their ensemble.
            </p>
            <div className="pt-4">
              <a className="button button--secondary" href="/player">
                Practice player
              </a>
            </div>
          </article>
        </div>
      </section>

      {/* 3. Live upcoming concert listings & ticket links */}
      <section className="foundation" id="upcoming-tickets" aria-labelledby="tickets-title">
        <div className="section-heading">
          <h2 id="tickets-title">Upcoming concerts & tickets.</h2>
          <p>
            Performances from participating choirs with online ticketing enabled. Tickets are
            purchased directly through each choir’s site.
          </p>
        </div>

        <div className="mt-8">
          {ticketState.status === "loading" ? (
            <p className="notice notice--info" role="status">
              Checking for upcoming concerts…
            </p>
          ) : ticketState.status === "error" ? (
            <p className="notice notice--error" role="alert">
              Ticket feed is temporarily unavailable. Check back soon.
            </p>
          ) : ticketState.listings.length === 0 ? (
            <div className="empty-state">
              <p>
                No public ticketed events are currently scheduled across associated choirs. Check
                back as ensembles publish their upcoming performance dates.
              </p>
            </div>
          ) : (
            <div className="public-performance-grid">
              {ticketState.listings.map((listing) => (
                <article
                  className="public-performance-card public-performance-card--ticket"
                  key={listing.eventId}
                >
                  <div className="public-performance-card__body">
                    <div className="public-performance-card__content">
                      <p className="text-sm font-semibold text-color-accent">
                        {listing.organizationName}
                      </p>
                      <h3>{listing.title}</h3>
                      <p className="text-sm text-color-muted">
                        {formatPerformanceDate(listing.startsAt, listing.timezone)}
                      </p>
                      {listing.venueName ? (
                        <p className="public-performance-location text-sm">
                          📍 {listing.venueName}
                        </p>
                      ) : null}
                    </div>
                    <div className="public-performance-card__purchase">
                      <a
                        className="button button--primary"
                        href={listing.ticketsUrl}
                        rel="noopener noreferrer"
                      >
                        Tickets & Details
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 4. Simple nonprofit inquiry form for Fairfield County, Ohio */}
      <section className="foundation" id="nonprofit-inquiries" aria-labelledby="inquiry-title">
        <div className="section-heading">
          <h2 id="inquiry-title">Fairfield County nonprofit inquiries.</h2>
          <p>
            Are you a community choir, vocal ensemble, or choral nonprofit in or around Fairfield
            County, Ohio interested in using the platform? Tell us about your group below to get in
            touch with the platform administrators.
          </p>
        </div>

        <div className="mt-8 max-w-xl">
          {formStatus === "success" ? (
            <div className="space-y-4">
              <div className="notice notice--success" role="status">
                <p className="font-semibold">
                  Thank you! Your inquiry was sent to the platform administrators.
                </p>
                <p className="text-sm mt-1">
                  We’ll review your details and respond to {email} as soon as possible.
                </p>
              </div>
              <button className="button button--secondary" onClick={handleResetForm} type="button">
                Send another inquiry
              </button>
            </div>
          ) : (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void handleInquirySubmit();
              }}
            >
              {formStatus === "error" && formError ? (
                <p className="notice notice--error" role="alert">
                  {formError}
                </p>
              ) : null}

              <label className="field" htmlFor="inquiry-org-name">
                <span className="field__label-row">
                  <span>Organization Name *</span>
                </span>
                <input
                  id="inquiry-org-name"
                  maxLength={200}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                  }}
                  placeholder="e.g. Lancaster Choral Society"
                  required
                  type="text"
                  value={orgName}
                />
              </label>

              <label className="field" htmlFor="inquiry-contact-name">
                <span className="field__label-row">
                  <span>Contact Name *</span>
                </span>
                <input
                  id="inquiry-contact-name"
                  maxLength={120}
                  onChange={(e) => {
                    setContactName(e.target.value);
                  }}
                  placeholder="Your full name"
                  required
                  type="text"
                  value={contactName}
                />
              </label>

              <label className="field" htmlFor="inquiry-email">
                <span className="field__label-row">
                  <span>Email Address *</span>
                </span>
                <input
                  id="inquiry-email"
                  maxLength={320}
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                  placeholder="name@example.org"
                  required
                  type="email"
                  value={email}
                />
                <span className="field-help">
                  Platform administrators will reply to this email.
                </span>
              </label>

              <label className="field" htmlFor="inquiry-location">
                <span className="field__label-row">
                  <span>Location in Fairfield County / Central Ohio</span>
                  <span className="field-help field-help--inline">(optional)</span>
                </span>
                <input
                  id="inquiry-location"
                  maxLength={120}
                  onChange={(e) => {
                    setLocation(e.target.value);
                  }}
                  placeholder="e.g. Lancaster, Pickerington, Pickerington North, Baltimore"
                  type="text"
                  value={location}
                />
              </label>

              <label className="field" htmlFor="inquiry-message">
                <span className="field__label-row">
                  <span>Message & details</span>
                  <span className="field-help field-help--inline">(optional)</span>
                </span>
                <textarea
                  id="inquiry-message"
                  maxLength={4000}
                  onChange={(e) => {
                    setMessage(e.target.value);
                  }}
                  placeholder="Tell us a bit about your ensemble, how many singers you have, or questions you have."
                  rows={4}
                  value={message}
                />
              </label>

              {/* Honeypot field for bot deterrence: invisible to humans, filled by automated scrapers */}
              <div aria-hidden="true" style={{ display: "none" }}>
                <label htmlFor="inquiry-website">
                  Website
                  <input
                    autoComplete="off"
                    id="inquiry-website"
                    name="website"
                    onChange={(e) => {
                      setWebsiteHoneypot(e.target.value);
                    }}
                    tabIndex={-1}
                    type="text"
                    value={websiteHoneypot}
                  />
                </label>
              </div>

              <div className="pt-2">
                <button
                  className="button button--primary"
                  disabled={formStatus === "submitting"}
                  type="submit"
                >
                  {formStatus === "submitting" ? "Sending inquiry…" : "Send inquiry to admins"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
