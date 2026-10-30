import { publicPageHeading, publicPageNavigationLabel } from "./publicPageLabels";
import type { PublishedOrganizationProjection } from "@choir/contracts";
import { prioritizeTicketedPerformances, ticketSalesPath } from "@choir/domain";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { getPublishedOrganizationProjection } from "../auth/api";
import { PublicOrganizationBrand } from "./PublicOrganizationBrand";
import { mediaUrl } from "./publicMedia";
import { PublicGraphicImage } from "./PublicGraphicImage";
import { PublicCopy } from "./PublicCopy";
import { PublicWebsiteHero } from "./PublicWebsiteHero";
import { PublicWebsiteFooter } from "./PublicWebsiteFooter";
import { publicWebsiteFontStacks } from "./publicWebsiteFonts";
import { getEventVenueDetails, type EventVenueInput } from "./venueDetails";

type ProjectionState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly projection: PublishedOrganizationProjection | null; readonly status: "ready" };

interface PublicSiteStyle extends CSSProperties {
  "--public-body-font": string;
  "--public-heading-font": string;
}

function publicSiteStyle(
  settings: PublishedOrganizationProjection["payload"]["settings"],
): PublicSiteStyle {
  return {
    "--public-body-font": publicWebsiteFontStacks[settings.bodyFont],
    "--public-heading-font": publicWebsiteFontStacks[settings.headerFont],
  };
}

function displayDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: timezone,
  }).format(new Date(value));
}

function usePerformanceSchedule(
  performances: PublishedOrganizationProjection["payload"]["performances"],
) {
  const [now] = useState(Date.now);
  const dated = performances.map((performance) => ({
    performance,
    startsAt: Date.parse(performance.startsAt),
  }));
  return {
    upcoming: prioritizeTicketedPerformances(
      dated.filter(({ startsAt }) => startsAt >= now).map(({ performance }) => performance),
    ),
    past: dated
      .filter(({ startsAt }) => startsAt < now)
      .sort((left, right) => right.startsAt - left.startsAt)
      .map(({ performance }) => performance),
  };
}

function PerformanceVenue({ performance }: { readonly performance: EventVenueInput }) {
  const venue = getEventVenueDetails(performance);
  if (!venue.googleMapsUrl) return null;
  const label = venue.displayName || venue.venueAddress;
  return (
    <p className="public-performance-location">
      <a
        aria-label={`${label} on Google Maps (opens in a new tab)`}
        className="public-performance-map-link"
        href={venue.googleMapsUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        {label}
      </a>
    </p>
  );
}

function PerformanceCards({
  linkToTickets = false,
  performances,
  projection,
}: {
  readonly linkToTickets?: boolean;
  readonly performances: PublishedOrganizationProjection["payload"]["performances"];
  readonly projection: PublishedOrganizationProjection;
}) {
  return (
    <div className="public-performance-grid">
      {performances.map((performance) => (
        <article
          className={`public-performance-card${linkToTickets && performance.isTicketingEnabled ? " public-performance-card--linked" : ""}`}
          id={`performance-${performance.id}`}
          key={performance.id}
        >
          {performance.graphicFileId ? (
            <PublicGraphicImage
              alt={performance.title}
              src={mediaUrl(projection, performance.graphicFileId)}
            />
          ) : null}
          <div>
            <p>{displayDate(performance.startsAt, projection.payload.timezone)}</p>
            <h3>
              {linkToTickets && performance.isTicketingEnabled ? (
                <a className="performance-card__link" href={ticketSalesPath(performance)}>
                  {performance.title}
                </a>
              ) : (
                performance.title
              )}
            </h3>
            <PerformanceVenue performance={performance} />
            <PublicCopy text={performance.publicDetails} />
            {linkToTickets && performance.isTicketingEnabled ? (
              <p aria-hidden="true" className="public-performance-card__destination">
                View tickets →
              </p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function OrganizationLayout({
  children,
  pathname = "/",
  projection,
  signedIn = false,
}: {
  readonly children: ReactNode;
  readonly pathname?: string | undefined;
  readonly projection: PublishedOrganizationProjection;
  readonly signedIn?: boolean | undefined;
}) {
  const { performances, settings } = projection.payload;
  const hasPerformances = performances.length > 0;
  const hasHistory = Boolean(settings.historyText.trim());

  const navigation = [
    ...(hasPerformances
      ? [
          {
            href: "/performances",
            label: publicPageNavigationLabel(settings, "performances"),
          },
        ]
      : []),
    ...(hasHistory
      ? [{ href: "/history", label: publicPageNavigationLabel(settings, "history") }]
      : []),
    ...(settings.enabledNavigation.includes("tickets")
      ? [{ href: "/tickets", label: publicPageNavigationLabel(settings, "tickets") }]
      : []),
    ...(settings.enabledNavigation.includes("donations")
      ? [{ href: "/donate", label: publicPageNavigationLabel(settings, "donations") }]
      : []),
    ...(settings.enabledNavigation.includes("auditions")
      ? [
          {
            href: "/auditions",
            label: publicPageNavigationLabel(settings, "auditions"),
          },
        ]
      : []),
  ];
  return (
    <div className="public-site" style={publicSiteStyle(settings)}>
      <header className="public-site-header">
        <PublicOrganizationBrand
          organizationName={projection.payload.organizationName}
          publishedLogoUrl={settings.logoFileId ? mediaUrl(projection, settings.logoFileId) : null}
        />
        <nav aria-label="Public website">
          {navigation.map((item) => {
            const isCurrent =
              pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
            return (
              <a
                aria-current={isCurrent ? "page" : undefined}
                className={isCurrent ? "is-active" : undefined}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </a>
            );
          })}
          <a className="public-site-account-link" href="/login">
            {signedIn ? (
              <svg
                aria-hidden="true"
                fill="none"
                height="18"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="18"
              >
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            ) : null}
            {signedIn
              ? "My dashboard"
              : `${projection.payload.performerLabel ?? "Performer"} login`}
          </a>
        </nav>
      </header>
      <main>{children}</main>
      <PublicWebsiteFooter
        settings={settings}
        organizationName={projection.payload.organizationName}
        year={new Date(projection.generatedAt).getUTCFullYear()}
      />
    </div>
  );
}

export function PublicTransactionLayout({
  children,
  projection,
}: {
  readonly children: ReactNode;
  readonly projection: PublishedOrganizationProjection;
}) {
  const { settings } = projection.payload;
  return (
    <div className="public-site" style={publicSiteStyle(settings)}>
      <header className="public-site-header">
        <PublicOrganizationBrand
          organizationName={projection.payload.organizationName}
          publishedLogoUrl={settings.logoFileId ? mediaUrl(projection, settings.logoFileId) : null}
        />
      </header>
      <main>{children}</main>
      <PublicWebsiteFooter
        settings={settings}
        organizationName={projection.payload.organizationName}
        year={new Date(projection.generatedAt).getUTCFullYear()}
      />
    </div>
  );
}

function OrganizationHome({
  pathname,
  projection,
  signedIn,
}: {
  readonly pathname: string;
  readonly projection: PublishedOrganizationProjection;
  readonly signedIn?: boolean | undefined;
}) {
  const { performances, settings } = projection.payload;
  const { upcoming, past } = usePerformanceSchedule(performances);
  return (
    <OrganizationLayout pathname={pathname} projection={projection} signedIn={signedIn}>
      <PublicWebsiteHero
        position={settings.heroPosition}
        headline={settings.heroHeadline}
        subtitle={settings.heroSubtitle}
        imageUrl={settings.heroFileId ? mediaUrl(projection, settings.heroFileId) : null}
        organizationName={projection.payload.organizationName}
      />
      {upcoming.length > 0 ? (
        <section className="public-section">
          <div className="public-section-heading">
            <h2>Upcoming Performances</h2>
            <a href="/performances">
              View all performances <span aria-hidden="true">→</span>
            </a>
          </div>
          <PerformanceCards
            linkToTickets
            performances={upcoming.slice(0, 3)}
            projection={projection}
          />
        </section>
      ) : null}
      {settings.aboutUsText ? (
        <section className="public-section public-section--narrow" id="about-us">
          <h2>About Us</h2>
          <PublicCopy text={settings.aboutUsText} />
        </section>
      ) : null}
      {past.length > 0 ? (
        <section className="public-section">
          <div className="public-section-heading">
            <h2>Past Performances</h2>
            <a href="/performances">See all</a>
          </div>
          <PerformanceCards performances={past.slice(0, 3)} projection={projection} />
        </section>
      ) : null}
      {upcoming.length === 0 && past.length === 0 && !settings.aboutUsText ? (
        <section className="public-section public-section--narrow">
          <div className="empty-state">
            <p>Welcome! Our public schedule and choir story are currently being updated.</p>
            {settings.contactEmail ? (
              <p>
                Interested in getting in touch?{" "}
                <a href={`mailto:${settings.contactEmail}`}>Contact us directly</a>.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </OrganizationLayout>
  );
}

function OrganizationHistory({
  pathname,
  projection,
  signedIn,
}: {
  readonly pathname: string;
  readonly projection: PublishedOrganizationProjection;
  readonly signedIn?: boolean | undefined;
}) {
  const historyText = projection.payload.settings.historyText.trim();
  const { aboutUsText, contactEmail } = projection.payload.settings;

  return (
    <OrganizationLayout pathname={pathname} projection={projection} signedIn={signedIn}>
      <section className="public-section public-section--narrow">
        <h1>{publicPageHeading(projection.payload.settings, "history", "Our History")}</h1>
        {historyText ? (
          <PublicCopy text={historyText} />
        ) : (
          <div className="empty-state" aria-label="Unpublished history notice">
            <p>Our history has not been published yet.</p>
            {aboutUsText.trim() ? (
              <p>
                Learn more about our mission and choir on the{" "}
                <a href="/#about-us">About Us section</a> of our home page.
              </p>
            ) : null}
            {contactEmail ? (
              <p>
                Have questions or stories to share?{" "}
                <a href={`mailto:${contactEmail}`}>Contact us directly</a>.
              </p>
            ) : null}
            <div className="button-row">
              <a className="button button--secondary" href="/">
                Return to home page
              </a>
            </div>
          </div>
        )}
      </section>
    </OrganizationLayout>
  );
}

function OrganizationPerformances({
  pathname,
  projection,
  signedIn,
}: {
  readonly pathname: string;
  readonly projection: PublishedOrganizationProjection;
  readonly signedIn?: boolean | undefined;
}) {
  const hasPerformances = projection.payload.performances.length > 0;
  const { upcoming, past } = usePerformanceSchedule(projection.payload.performances);
  const { contactEmail, enabledNavigation } = projection.payload.settings;

  return (
    <OrganizationLayout pathname={pathname} projection={projection} signedIn={signedIn}>
      <section className="public-section">
        <h1>{publicPageHeading(projection.payload.settings, "performances", "Performances")}</h1>
        <p className="public-performances-intro">
          Join us at an upcoming event, or explore performances from past seasons.
        </p>
        {hasPerformances ? (
          <>
            <section
              aria-labelledby="upcoming-performances-title"
              className="public-performance-schedule"
            >
              <h2 id="upcoming-performances-title">Upcoming performances</h2>
              {upcoming.length > 0 ? (
                <PerformanceCards linkToTickets performances={upcoming} projection={projection} />
              ) : (
                <p>
                  No upcoming performances are currently published. Explore our past performances
                  below.
                </p>
              )}
            </section>
            {past.length > 0 ? (
              <section
                aria-labelledby="past-performances-title"
                className="public-performance-schedule public-past-performances"
              >
                <h2 id="past-performances-title">Past performances</h2>
                <p>A look back at concerts and community appearances.</p>
                <PerformanceCards performances={past} projection={projection} />
              </section>
            ) : null}
          </>
        ) : (
          <div className="empty-state" aria-label="No published performances notice">
            <p>No performances are currently published on our schedule.</p>
            <p>Check back soon for upcoming concerts, appearances, and season announcements.</p>
            {enabledNavigation.includes("tickets") ? (
              <p>
                Browse available tickets or passes on our <a href="/tickets">Tickets page</a>.
              </p>
            ) : null}
            {contactEmail ? (
              <p>
                For booking inquiries or performance questions,{" "}
                <a href={`mailto:${contactEmail}`}>reach out to our team</a>.
              </p>
            ) : null}
            <div className="button-row">
              <a className="button button--secondary" href="/">
                Return to home page
              </a>
            </div>
          </div>
        )}
      </section>
    </OrganizationLayout>
  );
}

export function PublicOrganizationSite({
  fallback,
  pathname,
  signedIn,
  initialProjection,
  onProjectionChange,
}: {
  readonly fallback: ReactNode;
  readonly pathname: string;
  readonly signedIn?: boolean | undefined;
  readonly initialProjection?: PublishedOrganizationProjection | null | undefined;
  readonly onProjectionChange?:
    ((projection: PublishedOrganizationProjection | null) => void) | undefined;
}) {
  const [retryState, setRetryState] = useState<ProjectionState | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [standaloneState, setStandaloneState] = useState<ProjectionState | null>(null);

  useEffect(() => {
    if (initialProjection !== undefined || onProjectionChange) return;
    const controller = new AbortController();
    getPublishedOrganizationProjection(controller.signal)
      .then((projection) => {
        setStandaloneState({ projection, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStandaloneState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [initialProjection, onProjectionChange]);

  useEffect(() => {
    if (retryCount === 0) return;
    const controller = new AbortController();
    getPublishedOrganizationProjection(controller.signal, { bypassCache: true })
      .then((projection) => {
        setRetryState({ projection, status: "ready" });
        onProjectionChange?.(projection);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setRetryState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [onProjectionChange, retryCount]);

  const state: ProjectionState = useMemo(() => {
    if (retryState) return retryState;
    if (initialProjection !== undefined) return { projection: initialProjection, status: "ready" };
    return standaloneState ?? { status: "loading" };
  }, [initialProjection, retryState, standaloneState]);

  useEffect(() => {
    if (state.status !== "ready" || !state.projection) return;
    const orgName = state.projection.payload.organizationName;
    if (!orgName) return;
    const pageLabel =
      pathname === "/history"
        ? publicPageNavigationLabel(state.projection.payload.settings, "history")
        : pathname === "/performances"
          ? publicPageNavigationLabel(state.projection.payload.settings, "performances")
          : null;
    const previousTitle = document.title;
    document.title = pageLabel ? `${pageLabel} · ${orgName}` : orgName;
    return () => {
      document.title = previousTitle;
    };
  }, [pathname, state]);

  if (state.status === "loading") {
    return (
      <main className="auth-layout">
        <p className="notice notice--info" role="status">
          Loading Organization website…
        </p>
      </main>
    );
  }
  if (
    state.status === "ready" &&
    state.projection === null &&
    pathname === "/" &&
    fallback != null
  ) {
    return fallback;
  }
  if (state.status === "error" || state.projection === null) {
    return (
      <main className="auth-layout">
        <section className="auth-card">
          <h1>Website unavailable</h1>
          <p role="status">
            {state.status === "error"
              ? "The public website could not be loaded. Please try again."
              : "This public website is not available on this address yet."}
          </p>
          <button
            className="button button--primary"
            onClick={() => {
              setRetryState({ status: "loading" });
              setRetryCount((current) => current + 1);
            }}
            type="button"
          >
            Retry website
          </button>
          <a className="button button--secondary" href="/">
            Return home
          </a>
        </section>
      </main>
    );
  }
  if (pathname === "/history") {
    return (
      <OrganizationHistory pathname={pathname} projection={state.projection} signedIn={signedIn} />
    );
  }
  if (pathname === "/performances") {
    return (
      <OrganizationPerformances
        pathname={pathname}
        projection={state.projection}
        signedIn={signedIn}
      />
    );
  }
  return <OrganizationHome pathname={pathname} projection={state.projection} signedIn={signedIn} />;
}
