import { publicPageHeading, publicPageNavigationLabel } from "./publicPageLabels";
import type { PublishedOrganizationProjection } from "@choir/contracts";
import { ticketSalesPath } from "@choir/domain";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { getPublishedOrganizationProjection } from "../auth/api";
import { PublicOrganizationBrand } from "./PublicOrganizationBrand";
import { mediaUrl } from "./publicMedia";
import { PublicGraphicImage } from "./PublicGraphicImage";
import { PublicCopy } from "./PublicCopy";
import { PublicWebsiteHero } from "./PublicWebsiteHero";
import { PublicWebsiteFooter } from "./PublicWebsiteFooter";
import { publicWebsiteFontStacks } from "./publicWebsiteFonts";

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

function PerformanceCards({
  linkToDetails = false,
  performances,
  projection,
}: {
  readonly linkToDetails?: boolean;
  readonly performances: PublishedOrganizationProjection["payload"]["performances"];
  readonly projection: PublishedOrganizationProjection;
}) {
  return (
    <div className="public-performance-grid">
      {performances.map((performance) => (
        <article
          className={`public-performance-card${linkToDetails ? " public-performance-card--linked" : ""}`}
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
              {linkToDetails ? (
                <a
                  className="performance-card__link"
                  href={
                    performance.isTicketingEnabled
                      ? ticketSalesPath(performance)
                      : `/performances#performance-${performance.id}`
                  }
                >
                  {performance.title}
                </a>
              ) : (
                performance.title
              )}
            </h3>
            {performance.venueName || performance.location ? (
              <p className="public-performance-location">
                {performance.venueName || performance.location}
              </p>
            ) : null}
            <PublicCopy text={performance.publicDetails} />
            {linkToDetails ? (
              <p aria-hidden="true" className="public-performance-card__destination">
                {performance.isTicketingEnabled ? "View tickets →" : "View performance →"}
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
          {signedIn ? (
            <a className="back-to-workspace" href="/login">
              ← Workspace
            </a>
          ) : (
            <a href="/login">Sign in</a>
          )}
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
  const now = new Date(projection.generatedAt).getTime();
  const upcoming = performances
    .filter(({ startsAt }) => new Date(startsAt).getTime() >= now)
    .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt));
  const past = performances
    .filter(({ startsAt }) => new Date(startsAt).getTime() < now)
    .slice(0, 3);
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
          <h2>Upcoming Performances</h2>
          <PerformanceCards
            linkToDetails
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
          <PerformanceCards performances={past} projection={projection} />
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
  const { contactEmail, enabledNavigation } = projection.payload.settings;

  return (
    <OrganizationLayout pathname={pathname} projection={projection} signedIn={signedIn}>
      <section className="public-section">
        <h1>{publicPageHeading(projection.payload.settings, "performances", "Performances")}</h1>
        {hasPerformances ? (
          <PerformanceCards
            linkToDetails
            performances={projection.payload.performances}
            projection={projection}
          />
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
}: {
  readonly fallback: ReactNode;
  readonly pathname: string;
  readonly signedIn?: boolean | undefined;
}) {
  const [state, setState] = useState<ProjectionState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    getPublishedOrganizationProjection(controller.signal)
      .then((projection) => {
        setState({ projection, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (state.status === "loading") {
    return (
      <main className="auth-layout">
        <p className="notice notice--info" role="status">
          Loading Organization website…
        </p>
      </main>
    );
  }
  if ((state.status === "error" || state.projection === null) && pathname === "/") {
    return fallback;
  }
  if (state.status === "error" || state.projection === null) {
    return (
      <main className="auth-layout">
        <section className="auth-card">
          <h1>Website unavailable</h1>
          <p>This Organization has not published this page yet.</p>
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
