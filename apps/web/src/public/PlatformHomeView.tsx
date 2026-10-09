import type { PlatformHomeTicketListing } from "@choir/contracts";
import type { ReactNode } from "react";
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

interface DateTileParts {
  readonly day: string;
  readonly month: string;
}

function performanceDateTile(isoDateString: string, timezone: string): DateTileParts {
  const date = new Date(isoDateString);
  try {
    return {
      day: new Intl.DateTimeFormat(undefined, { day: "numeric", timeZone: timezone }).format(date),
      month: new Intl.DateTimeFormat(undefined, { month: "short", timeZone: timezone }).format(
        date,
      ),
    };
  } catch {
    return {
      day: String(date.getDate()),
      month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
    };
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

/* ------------------------------------------------------------------ */
/* Decorative icons (hidden from assistive technology)                 */
/* ------------------------------------------------------------------ */

function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="platform-icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

const icons = {
  calendar: (
    <Icon>
      <rect height="16" rx="2" width="18" x="3" y="5" />
      <path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" />
    </Icon>
  ),
  globe: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </Icon>
  ),
  key: (
    <Icon>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
    </Icon>
  ),
  message: (
    <Icon>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </Icon>
  ),
  music: (
    <Icon>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </Icon>
  ),
  people: (
    <Icon>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2c2.8.2 5 2.6 5 5.8" />
    </Icon>
  ),
  ticket: (
    <Icon>
      <path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </Icon>
  ),
} as const;

/* ------------------------------------------------------------------ */
/* Hero                                                               */
/* ------------------------------------------------------------------ */

function HeroPreview() {
  return (
    <div aria-hidden="true" className="platform-preview">
      <div className="platform-preview__window">
        <div className="platform-preview__chrome">
          <span />
          <span />
          <span />
        </div>
        <div className="platform-preview__body">
          <p className="platform-preview__title">This week</p>
          <ul className="platform-preview__list">
            <li>
              <span className="platform-preview__day">Tue</span>
              <span>
                <strong>Full rehearsal</strong>
                <small>7:00 PM · Fellowship Hall</small>
              </span>
              <span className="platform-preview__pill">Going</span>
            </li>
            <li>
              <span className="platform-preview__day">Thu</span>
              <span>
                <strong>Tenor sectional</strong>
                <small>6:30 PM · Room 204</small>
              </span>
              <span className="platform-preview__pill platform-preview__pill--muted">RSVP</span>
            </li>
          </ul>
          <div className="platform-preview__track">
            <span className="platform-preview__play" />
            <span className="platform-preview__track-copy">
              <strong>Practice track · Alto</strong>
              <span className="platform-preview__bar">
                <span />
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="platform-preview__ticket">
        {icons.ticket}
        <span>
          <strong>Spring concert</strong>
          <small>Tickets on sale</small>
        </span>
      </div>
    </div>
  );
}

function PlatformHero({ signedIn }: PlatformHomeViewProps) {
  return (
    <section className="platform-hero" aria-labelledby="hero-title">
      <div className="platform-hero__copy">
        <h1 id="hero-title">Choir Management</h1>
        <p className="hero__lede">
          A shared home for community choirs: rehearsal schedules, music and practice tracks, member
          rosters, announcements, and concert tickets, all in one place.
        </p>
        <div className="hero__actions">
          {signedIn ? (
            <a className="button button--primary" href="/account">
              Open your workspace
            </a>
          ) : null}
          <a
            className={`button ${signedIn ? "button--secondary" : "button--primary"}`}
            href="#upcoming-performances"
          >
            Upcoming performances
          </a>
          <a className="button button--secondary" href="#what-it-does">
            How it works
          </a>
        </div>
        <p className="hero__guidance">
          Have an invitation or practice-player link? Use the unique link provided by your choir.
        </p>
      </div>
      <HeroPreview />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Audience routing                                                   */
/* ------------------------------------------------------------------ */

interface AudienceRoute {
  readonly description: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly linkLabel: string;
  readonly title: string;
}

const audienceRoutes: readonly AudienceRoute[] = [
  {
    description: "Sign in to see your schedule, music, and messages from your choir.",
    href: "#signing-in",
    icon: icons.key,
    linkLabel: "How to sign in",
    title: "I sing with a choir",
  },
  {
    description: "Browse upcoming concerts and buy tickets directly from the choir.",
    href: "#upcoming-performances",
    icon: icons.ticket,
    linkLabel: "Find tickets",
    title: "I’m going to a concert",
  },
  {
    description: "Learn how ensembles in and around Fairfield County can get started.",
    href: "#community-choirs",
    icon: icons.people,
    linkLabel: "For community choirs",
    title: "I help run a choir",
  },
];

function AudienceRoutes() {
  return (
    <nav aria-label="Get started" className="platform-routes">
      <ul className="platform-routes__list">
        {audienceRoutes.map((route) => (
          <li className="platform-route" key={route.href}>
            <span className="platform-route__icon">{route.icon}</span>
            <span className="platform-route__copy">
              <strong className="platform-route__title">{route.title}</strong>
              <span className="platform-route__description">{route.description}</span>
              <a className="platform-route__link" href={route.href}>
                {route.linkLabel}
              </a>
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Feature overview                                                   */
/* ------------------------------------------------------------------ */

interface Feature {
  readonly description: string;
  readonly icon: ReactNode;
  readonly title: string;
}

const features: readonly Feature[] = [
  {
    description:
      "Rehearsals, sectionals, and performances on one calendar, with RSVPs and attendance.",
    icon: icons.calendar,
    title: "Schedule & attendance",
  },
  {
    description:
      "A searchable music library, set lists, and practice players singers can open from a link.",
    icon: icons.music,
    title: "Music & practice tracks",
  },
  {
    description: "Rosters, voice parts, and seating charts kept in one place for the whole choir.",
    icon: icons.people,
    title: "Members & voice parts",
  },
  {
    description: "Announcements and reminders sent to the whole choir or to a single section.",
    icon: icons.message,
    title: "Messages",
  },
  {
    description: "Online concert tickets and donations, with tickets checked in at the door.",
    icon: icons.ticket,
    title: "Tickets & donations",
  },
  {
    description: "A simple public site for each choir with its story, history, and performances.",
    icon: icons.globe,
    title: "Public choir website",
  },
];

function FeatureOverview() {
  return (
    <section className="foundation" id="what-it-does" aria-labelledby="features-title">
      <div className="section-heading">
        <h2 id="features-title">What Choir Management does.</h2>
        <p>
          Each choir gets its own private workspace. Directors and administrators keep things
          organized, and singers always know where to be and what to practice.
        </p>
      </div>
      <ul className="platform-features">
        {features.map((feature) => (
          <li className="platform-feature" key={feature.title}>
            <span className="platform-feature__icon">{feature.icon}</span>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Signing in                                                         */
/* ------------------------------------------------------------------ */

const signInSteps: readonly { readonly body: string; readonly title: string }[] = [
  {
    body: "Your choir’s administrators invite you by email. Open the invitation to set up your account.",
    title: "Accept your invitation",
  },
  {
    body: "Sign in with the same email address using an emailed one-time code, a passkey, or your password.",
    title: "Sign in with that email",
  },
  {
    body: "If you sing with more than one choir, switch between them from your workspace.",
    title: "Choose your choir",
  },
];

function SigningInSection({ signedIn }: PlatformHomeViewProps) {
  return (
    <section className="foundation" id="signing-in" aria-labelledby="signing-in-title">
      <div className="platform-signin">
        <div className="platform-signin__intro">
          <h2 id="signing-in-title">Signing in.</h2>
          <p className="platform-signin__lede">
            Accounts are created by each choir. If you sing with a participating choir, here is how
            to get to your schedule, music, and messages.
          </p>
          <div className="platform-signin__actions">
            {signedIn ? (
              <a className="button button--primary" href="/account">
                Go to your account
              </a>
            ) : (
              <>
                <a className="button button--primary" href="/login">
                  Sign in to your account
                </a>
                <a className="platform-text-link" href="/forgot-password">
                  Forgot your password?
                </a>
              </>
            )}
          </div>
        </div>
        <div className="platform-signin__panel">
          <ol className="platform-steps">
            {signInSteps.map((step, index) => (
              <li className="platform-step" key={step.title}>
                <span aria-hidden="true" className="platform-step__number">
                  {index + 1}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="platform-signin__note">
            Practice-player, RSVP, and poll links from your choir open directly, with no sign-in
            needed.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Upcoming performances                                              */
/* ------------------------------------------------------------------ */

function PerformanceCard({ listing }: { readonly listing: PlatformHomeTicketListing }) {
  const tile = performanceDateTile(listing.startsAt, listing.timezone);
  return (
    <article className="platform-performance">
      <div aria-hidden="true" className="platform-performance__date">
        <span className="platform-performance__month">{tile.month}</span>
        <span className="platform-performance__day">{tile.day}</span>
      </div>
      <div className="platform-performance__content">
        <h3>{listing.title}</h3>
        <p className="platform-performance__org">{listing.organizationName}</p>
        <p className="platform-performance__meta">
          {formatPerformanceDate(listing.startsAt, listing.timezone)}
        </p>
        {listing.venueName ? (
          <p className="platform-performance__meta">{listing.venueName}</p>
        ) : null}
      </div>
      <div className="platform-performance__purchase">
        <a className="button button--primary" href={listing.ticketsUrl} rel="noopener noreferrer">
          Tickets &amp; details
        </a>
      </div>
    </article>
  );
}

function PerformanceFeed({ state }: { readonly state: TicketFeedState }) {
  if (state.status === "loading") {
    return (
      <p className="notice notice--info" role="status">
        Checking for upcoming performances…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Performance feed is temporarily unavailable. Check back soon.
      </p>
    );
  }
  if (state.listings.length === 0) {
    return (
      <div className="empty-state">
        <p>
          No public ticketed events are currently scheduled across associated choirs. Check back as
          ensembles publish their upcoming performance dates.
        </p>
      </div>
    );
  }
  return (
    <div className="platform-performances">
      {state.listings.map((listing) => (
        <PerformanceCard key={listing.eventId} listing={listing} />
      ))}
    </div>
  );
}

function PerformancesSection() {
  const [ticketState, setTicketState] = useState<TicketFeedState>({ status: "loading" });

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

  return (
    <section className="foundation" id="upcoming-performances" aria-labelledby="performances-title">
      <div className="section-heading">
        <h2 id="performances-title">Upcoming performances.</h2>
        <p>
          Performances from participating choirs with online ticketing enabled. Tickets are
          purchased directly through each choir’s site.
        </p>
      </div>
      <div className="mt-8">
        <PerformanceFeed state={ticketState} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Community choir inquiry                                            */
/* ------------------------------------------------------------------ */

function InquiryForm() {
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState("");
  const [websiteHoneypot, setWebsiteHoneypot] = useState("");
  const [formStatus, setFormStatus] = useState<InquiryFormStatus>("idle");
  const [formError, setFormError] = useState<string | null>(null);

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

  if (formStatus === "success") {
    return (
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
    );
  }

  return (
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
        <span className="field-help">Platform administrators will reply to this email.</span>
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
  );
}

function CommunityChoirsSection() {
  return (
    <section className="foundation" id="community-choirs" aria-labelledby="inquiry-title">
      <div className="platform-inquiry">
        <div className="section-heading platform-inquiry__intro">
          <h2 id="inquiry-title">For community choirs.</h2>
          <p>
            Interested in using Choir Management for your ensemble? Choirs and choral nonprofits in
            or around Fairfield County, Ohio can contact the platform administrators below.
          </p>
          <ul className="platform-checklist">
            <li>Tell us about your ensemble and roughly how many singers you have.</li>
            <li>An administrator will reply by email to talk through next steps.</li>
            <li>Your choir gets its own private workspace and public site.</li>
          </ul>
        </div>
        <div className="inquiry-form-container platform-inquiry__form">
          <InquiryForm />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export function PlatformHomeView({ signedIn }: PlatformHomeViewProps) {
  return (
    <main className="platform-home">
      <PlatformHero signedIn={signedIn} />
      <AudienceRoutes />
      <FeatureOverview />
      <SigningInSection signedIn={signedIn} />
      <PerformancesSection />
      <CommunityChoirsSection />
    </main>
  );
}
