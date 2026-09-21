import type { PublishedOrganizationProjection } from "@choir/contracts";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { getPublishedOrganizationProjection } from "../auth/api";
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

function mediaUrl(projection: PublishedOrganizationProjection, fileId: string): string {
  return `/api/public/media/${String(projection.version)}/${encodeURIComponent(fileId)}`;
}

function PublicCopy({ text }: { readonly text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="public-copy">
      {text
        .trim()
        .split(/\n{2,}/)
        .map((block, index) => {
          const normalized = block.trim();
          if (normalized.startsWith("### ")) return <h4 key={index}>{normalized.slice(4)}</h4>;
          if (normalized.startsWith("## ")) return <h3 key={index}>{normalized.slice(3)}</h3>;
          if (normalized.startsWith("# ")) return <h2 key={index}>{normalized.slice(2)}</h2>;
          return <p key={index}>{normalized}</p>;
        })}
    </div>
  );
}

function displayDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: timezone,
  }).format(new Date(value));
}

function PerformanceCards({
  performances,
  projection,
}: {
  readonly performances: PublishedOrganizationProjection["payload"]["performances"];
  readonly projection: PublishedOrganizationProjection;
}) {
  return (
    <div className="public-performance-grid">
      {performances.map((performance) => (
        <article className="public-performance-card" key={performance.id}>
          {performance.graphicFileId ? (
            <img
              alt={performance.title}
              loading="lazy"
              src={mediaUrl(projection, performance.graphicFileId)}
            />
          ) : null}
          <div>
            <p>{displayDate(performance.startsAt, projection.payload.timezone)}</p>
            <h3>{performance.title}</h3>
            {performance.venueName || performance.location ? (
              <p className="public-performance-location">
                {performance.venueName || performance.location}
              </p>
            ) : null}
            <PublicCopy text={performance.publicDetails} />
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
  const { settings } = projection.payload;
  const navigation = [
    { href: "/performances", label: "Performances" },
    { href: "/history", label: "History" },
    ...(settings.enabledNavigation.includes("tickets")
      ? [{ href: "/tickets", label: "Tickets" }]
      : []),
    ...(settings.enabledNavigation.includes("donations")
      ? [{ href: "/donate", label: "Donate" }]
      : []),
    ...(settings.enabledNavigation.includes("auditions")
      ? [{ href: "/auditions", label: "Auditions" }]
      : []),
  ];
  return (
    <div className="public-site" style={publicSiteStyle(settings)}>
      <header className="public-site-header">
        <a className="public-site-brand" href="/">
          {settings.logoFileId ? (
            <img alt="" aria-hidden="true" src={mediaUrl(projection, settings.logoFileId)} />
          ) : null}
          <span>{projection.payload.organizationName}</span>
        </a>
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
            <a className="back-to-workspace" href="/dashboard">
              ← Workspace
            </a>
          ) : (
            <a href="/login">Sign in</a>
          )}
        </nav>
      </header>
      <main>{children}</main>
      <footer className="public-site-footer">
        <p>
          © {new Date(projection.generatedAt).getUTCFullYear()}{" "}
          {projection.payload.organizationName}
        </p>
        {settings.contactEmail ? <a href={`mailto:${settings.contactEmail}`}>Contact us</a> : null}
      </footer>
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
        <a className="public-site-brand" href="/">
          {settings.logoFileId ? (
            <img alt="" aria-hidden="true" src={mediaUrl(projection, settings.logoFileId)} />
          ) : null}
          <span>{projection.payload.organizationName}</span>
        </a>
      </header>
      <main>{children}</main>
      <footer className="public-site-footer">
        <p>
          © {new Date(projection.generatedAt).getUTCFullYear()}{" "}
          {projection.payload.organizationName}
        </p>
        {settings.contactEmail ? <a href={`mailto:${settings.contactEmail}`}>Contact us</a> : null}
      </footer>
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
      <section
        className={`public-hero ${settings.heroFileId ? "public-hero--image" : ""}`}
        style={
          settings.heroFileId
            ? { backgroundImage: `url(${mediaUrl(projection, settings.heroFileId)})` }
            : undefined
        }
      >
        <div>
          <h1>{settings.heroHeadline}</h1>
          <p>{settings.heroSubtitle}</p>
        </div>
      </section>
      {upcoming.length > 0 ? (
        <section className="public-section">
          <h2>Upcoming Performances</h2>
          <PerformanceCards performances={upcoming.slice(0, 3)} projection={projection} />
        </section>
      ) : null}
      {settings.aboutUsText ? (
        <section className="public-section public-section--narrow">
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
  return (
    <OrganizationLayout pathname={pathname} projection={projection} signedIn={signedIn}>
      <section className="public-section public-section--narrow">
        <h1>Our History</h1>
        {projection.payload.settings.historyText ? (
          <PublicCopy text={projection.payload.settings.historyText} />
        ) : (
          <p>No history has been published yet.</p>
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
  return (
    <OrganizationLayout pathname={pathname} projection={projection} signedIn={signedIn}>
      <section className="public-section">
        <h1>Performances</h1>
        {projection.payload.performances.length > 0 ? (
          <PerformanceCards
            performances={projection.payload.performances}
            projection={projection}
          />
        ) : (
          <p>No performances have been published yet.</p>
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
  if (state.status === "ready" && state.projection === null && pathname === "/") return fallback;
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
