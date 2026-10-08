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
      {/* 1. Clear member-first hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <h1 id="hero-title">Choir Management</h1>
          <p className="hero__lede">Tools for singers, directors, and community choirs.</p>
          <div className="hero__actions">
            <a className="button button--primary" href={signedIn ? "/account" : "/login"}>
              {signedIn ? "Open your workspace" : "Member sign in"}
            </a>
            <a className="button button--secondary" href="#upcoming-performances">
              Upcoming performances
            </a>
          </div>
          <p className="hero__guidance">
            Have an invitation or practice-player link? Use the unique link provided by your choir.
          </p>
        </div>
      </section>

      {/* 2. Compact member access block */}
      <section className="foundation" id="member-access" aria-labelledby="member-access-title">
        <div className="section-heading">
          <h2 id="member-access-title">Already a member?</h2>
          <p>
            Sign in with the email address associated with your choir. If you’re joining a choir or
            opening a practice player, use the unique link sent by your choir director or
            administrator.
          </p>
        </div>
        <div className="mt-4">
          <a className="button button--secondary" href={signedIn ? "/account" : "/login"}>
            {signedIn ? "Open your workspace" : "Sign in"}
          </a>
        </div>
      </section>

      {/* 3. Live upcoming concert listings & ticket links */}
      <section
        className="foundation"
        id="upcoming-performances"
        aria-labelledby="performances-title"
      >
        <div className="section-heading">
          <h2 id="performances-title">Upcoming performances.</h2>
          <p>
            Performances from participating choirs with online ticketing enabled. Tickets are
            purchased directly through each choir’s site.
          </p>
        </div>

        <div className="mt-8">
          {ticketState.status === "loading" ? (
            <p className="notice notice--info" role="status">
              Checking for upcoming performances…
            </p>
          ) : ticketState.status === "error" ? (
            <p className="notice notice--error" role="alert">
              Performance feed is temporarily unavailable. Check back soon.
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
                        <p className="public-performance-location text-sm">{listing.venueName}</p>
                      ) : null}
                    </div>
                    <div className="public-performance-card__purchase">
                      <a
                        className="button button--primary"
                        href={listing.ticketsUrl}
                        rel="noopener noreferrer"
                      >
                        Tickets &amp; details
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 4. Simple nonprofit inquiry form for community choirs */}
      <section className="foundation" id="community-choirs" aria-labelledby="inquiry-title">
        <div className="section-heading">
          <h2 id="inquiry-title">For community choirs.</h2>
          <p>
            Interested in using Choir Management for your ensemble? Choirs and choral nonprofits in
            or around Fairfield County, Ohio can contact the platform administrators below.
          </p>
        </div>

        <div className="inquiry-form-container mt-8">
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
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void handleInquirySubmit();
              }}
            >
              {formStatus === "error" && formError ? (
                <div className="form-grid__wide">
                  <p className="notice notice--error" role="alert">
                    {formError}
                  </p>
                </div>
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
                  placeholder="e.g. Lancaster, Pickerington, Baltimore"
                  type="text"
                  value={location}
                />
              </label>

              <label className="field form-grid__wide" htmlFor="inquiry-message">
                <span className="field__label-row">
                  <span>Message &amp; details</span>
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

              <div className="form-grid__wide pt-2">
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
