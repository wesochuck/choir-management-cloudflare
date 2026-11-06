import type { MemberDashboardResponse } from "@choir/contracts";

import { getEventVenueDetails } from "../../../shared/venueDetails";
import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";

import { calculateConcertCountdown, formatConcertDateTime } from "./concertHeroUtils";

type DashboardEvent = MemberDashboardResponse["events"][number];

export interface MemberConcertHeroProps {
  readonly busyEventId: string | null;
  readonly concert: DashboardEvent;
  readonly now?: Date;
  readonly onOpenPractice: (event: DashboardEvent) => void;
  readonly rehearsalsRemainingCount: number;
  readonly timezone: string;
}

function hasPublishedConcertPractice(concert: DashboardEvent): boolean {
  return concert.practice.status === "available" && concert.practice.sourceEventId === concert.id;
}

export function MemberConcertHero({
  busyEventId,
  concert,
  now = new Date(),
  onOpenPractice,
  rehearsalsRemainingCount,
  timezone,
}: MemberConcertHeroProps) {
  const concertDate = new Date(concert.startsAt);
  const { dateFormatted, timeFormatted } = formatConcertDateTime(concert.startsAt, timezone);
  const { weeks, days, rehearsalsRemaining, totalSegments } = calculateConcertCountdown(
    now,
    concertDate,
    rehearsalsRemainingCount,
    concert.attendanceWarning?.totalRehearsals,
  );

  const busy = busyEventId === concert.id;
  const hasGraphic = Boolean(concert.publicGraphicFileId);
  const backgroundImageUrl = hasGraphic
    ? `/api/organization/files/${encodeURIComponent(concert.publicGraphicFileId ?? "")}`
    : null;

  const heroStyle = backgroundImageUrl
    ? {
        backgroundImage: `linear-gradient(to right, rgba(7, 17, 30, 0.95) 0%, rgba(7, 17, 30, 0.88) 45%, rgba(7, 17, 30, 0.35) 100%), url("${backgroundImageUrl}")`,
      }
    : undefined;

  const hasConcertPractice = hasPublishedConcertPractice(concert);

  return (
    <section
      aria-label={`Featured performance: ${concert.title}`}
      className={`member-concert-hero ${hasGraphic ? "member-concert-hero--has-image" : "member-concert-hero--generic"}`}
      style={heroStyle}
    >
      <div className="member-concert-hero__left">
        <h2 className="member-concert-hero__title">{concert.title}</h2>
        <p className="member-concert-hero__description">Next Performance</p>
        <div className="member-concert-hero__meta">
          <div className="member-concert-hero__meta-row">
            <svg
              aria-hidden="true"
              className="member-concert-hero__meta-icon"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
              <line x1="16" x2="16" y1="2" y2="6" />
              <line x1="8" x2="8" y1="2" y2="6" />
              <line x1="3" x2="21" y1="10" y2="10" />
            </svg>
            <span>
              {dateFormatted}
              {timeFormatted ? ` • ${timeFormatted}` : ""}
            </span>
          </div>
          <HeroVenueMetaRow concert={concert} />
        </div>
        {hasConcertPractice ? (
          <div className="member-concert-hero__actions">
            <button
              aria-busy={busy}
              aria-label={`Open Practice Player for ${concert.title}`}
              className="member-concert-hero__button"
              disabled={busy}
              onClick={() => {
                onOpenPractice(concert);
              }}
              type="button"
            >
              <OrganizationFeatureIcon
                className="member-concert-hero__button-icon"
                iconId="headphones"
              />
              <span>{busy ? "Opening…" : "Open Practice Player"}</span>
            </button>
          </div>
        ) : null}
      </div>

      <div aria-hidden="true" className="member-concert-hero__divider" />

      <div className="member-concert-hero__right">
        <h3 className="member-concert-hero__countdown-title">Rehearsals Remaining</h3>
        <div className="member-concert-hero__stats">
          <div className="member-concert-hero__stat-card">
            <span className="member-concert-hero__stat-value">{weeks}</span>
            <span className="member-concert-hero__stat-label">
              {weeks === 1 ? "Week" : "Weeks"}
            </span>
          </div>
          <div className="member-concert-hero__stat-card">
            <span className="member-concert-hero__stat-value">{days}</span>
            <span className="member-concert-hero__stat-label">{days === 1 ? "Day" : "Days"}</span>
          </div>
          <div className="member-concert-hero__stat-card">
            <span className="member-concert-hero__stat-value">{rehearsalsRemaining}</span>
            <span className="member-concert-hero__stat-label">
              {rehearsalsRemaining === 1 ? "Rehearsal" : "Rehearsals"}
            </span>
          </div>
        </div>
        <div
          aria-label="Rehearsals remaining progress"
          aria-valuemax={totalSegments}
          aria-valuemin={0}
          aria-valuenow={rehearsalsRemaining}
          className="member-concert-hero__progress"
          role="progressbar"
        >
          {Array.from({ length: totalSegments }).map((_, idx) => (
            <span
              className={`member-concert-hero__progress-segment${idx < rehearsalsRemaining ? " is-active" : ""}`}
              key={idx}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroVenueMetaRow({ concert }: { readonly concert: DashboardEvent }) {
  const venueDisplay =
    concert.venueName ||
    concert.location ||
    (concert.venueAddress ? concert.venueAddress : "Location to be announced");
  const venueDetails = getEventVenueDetails(concert);

  return (
    <div className="member-concert-hero__meta-row">
      <svg
        aria-hidden="true"
        className="member-concert-hero__meta-icon"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      {venueDetails.googleMapsUrl ? (
        <a
          aria-label={`${venueDisplay} on Google Maps (opens in a new tab)`}
          className="member-concert-hero__meta-link"
          href={venueDetails.googleMapsUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {venueDisplay}
        </a>
      ) : (
        <span>{venueDisplay}</span>
      )}
    </div>
  );
}
