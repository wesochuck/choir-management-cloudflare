import type { MemberDashboardResponse } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getMemberDashboard, getMemberPracticeLink, setMyEventRsvp } from "../auth/api";
import { renderCommunicationMarkdownPreview } from "./communicationMarkdown";
import { useOrganizationTerminology } from "./organizationTerminologyContext";
import { AppLink } from "./components/AuthenticatedShell/navigation";
import type { AccessState } from "./components/AuthenticatedShell/types";
import {
  formatCallTime,
  formatEventDateTile,
  formatEventTimeRange,
  formatRsvpDeadline,
} from "./dashboardFormatters";

type DashboardEvent = MemberDashboardResponse["events"][number];
type MemberWorkspaceAccessStatus = AccessState["status"];

function eventTypeLabel(event: DashboardEvent): string {
  if (event.type === "Performance") return "Performance";
  if (event.type === "Other") return "Other";
  return "Rehearsal";
}

function rsvpLabel(value: DashboardEvent["resolvedRsvp"]): string {
  if (value === "Yes") return "Attending";
  if (value === "No") return "Declined";
  return "Needs response";
}

function seatingLabel(event: DashboardEvent): string {
  if (event.seating.status === "available") return "Seating";
  return "Seat not assigned";
}

function bulletinDialogTitle(
  bulletin: MemberDashboardResponse["bulletins"][number] | null,
): string {
  if (!bulletin?.subject.trim()) return "Update";
  return bulletin.subject;
}

function isActionDisabled(event: DashboardEvent): boolean {
  return !event.rsvpSelfServiceOpen || event.inheritedFromParent;
}

function DashboardEventHighlights({ event }: { readonly event: DashboardEvent }) {
  return (
    <>
      {event.attendanceWarning?.status === "warning" ? (
        <p className="notice notice--warning" role="status">
          You have missed {String(event.attendanceWarning.missedRehearsals)} of{" "}
          {String(event.attendanceWarning.totalRehearsals)} linked rehearsals for this performance.
        </p>
      ) : null}
      {event.featuredAssignments.length > 0 ? (
        <div className="member-dashboard__featured">
          <strong>Featured assignment</strong>
          <span>{event.featuredAssignments.map(({ title }) => title).join(", ")}</span>
        </div>
      ) : null}
    </>
  );
}

function DashboardEventSetList({ event }: { readonly event: DashboardEvent }) {
  if (event.setList.length === 0) return null;
  const hasScores = event.setList.some((item) => Boolean(item.pieceId && item.scoreAvailable));
  return (
    <details className="member-dashboard__set-list">
      <summary>View set list ({String(event.setList.length)} items)</summary>
      <ul>
        {event.setList.map((item, index) => (
          <li key={`${item.title}-${String(index)}`}>
            <span>{item.title}</span>
            {item.pieceId && item.scoreAvailable ? (
              <a
                className="member-dashboard__score-link"
                href={`/api/singer/pieces/${encodeURIComponent(item.pieceId)}/score`}
                rel="noreferrer"
                target="_blank"
              >
                Score (PDF)
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {hasScores ? (
        <div className="member-dashboard__set-list-actions">
          <a
            className="button button--secondary button--small"
            download
            href={`/api/singer/events/${encodeURIComponent(event.id)}/scores/bundle`}
          >
            Download all scores (ZIP)
          </a>
        </div>
      ) : null}
    </details>
  );
}

function DashboardEventPracticeStrip({
  busy,
  event,
  onOpenPractice,
  userVoicePart,
}: {
  readonly busy: boolean;
  readonly event: DashboardEvent;
  readonly onOpenPractice: (event: DashboardEvent) => void;
  readonly userVoicePart?: string | null | undefined;
}) {
  const trackCount = event.practice.trackCount;
  const countLabel =
    trackCount > 0
      ? `${String(trackCount)} ${trackCount === 1 ? "track" : "tracks"} available`
      : "Practice tracks available";
  const trimmedPart = userVoicePart?.trim();
  const { partLabel } = useOrganizationTerminology();

  return (
    <div className="member-dashboard__practice-strip">
      <div className="member-dashboard__practice-strip-icon" aria-hidden="true">
        <svg
          fill="none"
          height="20"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="20"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
      <div className="member-dashboard__practice-strip-info">
        <strong className="member-dashboard__practice-strip-title">Practice music</strong>
        <div className="member-dashboard__practice-strip-meta">
          <span>{countLabel}</span>
          {trimmedPart ? (
            <>
              <span aria-hidden="true">•</span>
              <span className="member-dashboard__practice-strip-voice-part">
                Your {partLabel.toLowerCase()}: {trimmedPart}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <button
        aria-busy={busy}
        className="button button--secondary member-dashboard__practice-cta"
        disabled={busy}
        onClick={() => {
          onOpenPractice(event);
        }}
        type="button"
      >
        {busy ? "Opening…" : "Open practice player"}
      </button>
    </div>
  );
}

function DashboardEventActions({
  event,
  busyEventId,
  navigate,
  onDeclineRehearsal,
  onRsvp,
}: {
  readonly event: DashboardEvent;
  readonly busyEventId: string | null;
  readonly navigate: (href: string) => void;
  readonly onDeclineRehearsal: (event: DashboardEvent) => void;
  readonly onRsvp: (event: DashboardEvent, rsvp: "No" | "Yes") => void;
}) {
  const seatingEnabled =
    event.type === "Performance" &&
    event.seating.status !== "not_published" &&
    event.seating.status !== "declined";
  const actionDisabled = isActionDisabled(event);
  const busy = busyEventId === event.id;
  return (
    <div className="member-dashboard__event-actions">
      {seatingEnabled ? (
        <div className="member-dashboard__secondary-actions">
          <AppLink href={`/seating/${event.id}`} onNavigate={navigate}>
            {seatingLabel(event)}
          </AppLink>
        </div>
      ) : (
        <div className="member-dashboard__secondary-actions" />
      )}
      <div className="member-dashboard__rsvp-actions" aria-label={`${event.title} RSVP`}>
        <button
          className={
            event.resolvedRsvp === "Yes" ? "button button--primary" : "button button--secondary"
          }
          aria-busy={busy}
          disabled={actionDisabled || busy}
          onClick={() => {
            onRsvp(event, "Yes");
          }}
          type="button"
        >
          {busy ? "Updating…" : "Attend"}
        </button>
        <button
          className={
            event.resolvedRsvp === "No" ? "button button--danger" : "button button--secondary"
          }
          aria-busy={busy}
          disabled={actionDisabled || busy}
          onClick={() => {
            if (event.type === "Rehearsal") {
              onDeclineRehearsal(event);
            } else {
              onRsvp(event, "No");
            }
          }}
          type="button"
        >
          {busy ? "Updating…" : "Decline"}
        </button>
      </div>
    </div>
  );
}

function DashboardEventFooter({ event }: { readonly event: DashboardEvent }) {
  if (event.inheritedFromParent) {
    return (
      <small className="field-help">
        This rehearsal follows your RSVP for the linked performance.
      </small>
    );
  }
  if (!event.rsvpSelfServiceOpen) {
    return <small className="field-help">RSVP changes are closed for this event.</small>;
  }
  return null;
}

function DashboardEventCard({
  busyEventId,
  event,
  isNextUp = false,
  navigate,
  onDeclineRehearsal,
  onOpenPractice,
  onRsvp,
  timezone,
  userVoicePart,
}: {
  readonly busyEventId: string | null;
  readonly event: DashboardEvent;
  readonly isNextUp?: boolean;
  readonly navigate: (href: string) => void;
  readonly onDeclineRehearsal: (event: DashboardEvent) => void;
  readonly onOpenPractice: (event: DashboardEvent) => void;
  readonly onRsvp: (event: DashboardEvent, rsvp: "No" | "Yes") => void;
  readonly timezone: string;
  readonly userVoicePart?: string | null | undefined;
}) {
  const dateTile = formatEventDateTile(event.startsAt, timezone);
  const timeRange = formatEventTimeRange(event.startsAt, event.durationMinutes, timezone);
  const callTimeFormatted = formatCallTime(event.callTime);
  const rsvpDeadlineFormatted = formatRsvpDeadline(event.rsvpDeadlineDate);
  const practiceEnabled = event.practice.status === "available";

  return (
    <fieldset className="member-dashboard__event-card">
      <legend className="member-dashboard__event-legend">
        <span className="member-dashboard__event-legend-left">
          {isNextUp ? <span className="member-dashboard__next-badge">Next up</span> : null}
          <strong className="member-dashboard__event-title">{event.title}</strong>
        </span>
        <span className={`rsvp-status-badge rsvp-status-badge--${event.resolvedRsvp}`}>
          {rsvpLabel(event.resolvedRsvp)}
        </span>
      </legend>
      <div className="member-dashboard__event-main">
        <time
          className="member-dashboard__date-tile"
          dateTime={event.startsAt}
          aria-label={dateTile.fullLabel}
        >
          <span className="member-dashboard__date-tile-weekday">{dateTile.weekday}</span>
          <span className="member-dashboard__date-tile-day">{dateTile.day}</span>
          <span className="member-dashboard__date-tile-month">{dateTile.month}</span>
        </time>
        <div className="member-dashboard__event-details-column">
          <div className="member-dashboard__event-time-row">
            <span className="member-dashboard__event-type">{eventTypeLabel(event)}</span>
            <span aria-hidden="true" className="member-dashboard__event-dot">
              •
            </span>
            <span className="member-dashboard__event-time-range">{timeRange}</span>
          </div>
          <div className="member-dashboard__event-details">
            <span>{event.venueName || event.location || "Location to be announced"}</span>
            {callTimeFormatted ? <span>Call {callTimeFormatted}</span> : null}
            {rsvpDeadlineFormatted && event.resolvedRsvp === "Pending" ? (
              <span>RSVP by {rsvpDeadlineFormatted}</span>
            ) : null}
          </div>
          <DashboardEventHighlights event={event} />
          <DashboardEventSetList event={event} />
        </div>
      </div>
      {practiceEnabled ? (
        <DashboardEventPracticeStrip
          busy={busyEventId === event.id}
          event={event}
          onOpenPractice={onOpenPractice}
          userVoicePart={userVoicePart}
        />
      ) : null}
      <DashboardEventActions
        busyEventId={busyEventId}
        event={event}
        navigate={navigate}
        onDeclineRehearsal={onDeclineRehearsal}
        onRsvp={onRsvp}
      />
      <DashboardEventFooter event={event} />
    </fieldset>
  );
}

function DashboardSchedule({
  busyEventId,
  dashboard,
  navigate,
  onDeclineRehearsal,
  onOpenPractice,
  onRsvp,
}: {
  readonly busyEventId: string | null;
  readonly dashboard: MemberDashboardResponse;
  readonly navigate: (href: string) => void;
  readonly onDeclineRehearsal: (event: DashboardEvent) => void;
  readonly onOpenPractice: (event: DashboardEvent) => void;
  readonly onRsvp: (event: DashboardEvent, rsvp: "No" | "Yes") => void;
}) {
  const nextEvent = dashboard.events[0] ?? null;
  const remainingEvents = dashboard.events.slice(1);
  const userVoicePart = dashboard.profile?.voicePart ?? null;
  return (
    <fieldset className="member-dashboard__events">
      <legend className="member-dashboard__section-legend">Upcoming events</legend>
      {dashboard.events.length === 0 ? (
        <p className="empty-state">No upcoming events.</p>
      ) : (
        <div className="member-dashboard__event-list">
          {nextEvent ? (
            <DashboardEventCard
              busyEventId={busyEventId}
              event={nextEvent}
              isNextUp
              navigate={navigate}
              onDeclineRehearsal={onDeclineRehearsal}
              onOpenPractice={onOpenPractice}
              onRsvp={onRsvp}
              timezone={dashboard.timezone}
              userVoicePart={userVoicePart}
            />
          ) : null}
          {remainingEvents.map((event) => (
            <DashboardEventCard
              busyEventId={busyEventId}
              event={event}
              key={event.id}
              navigate={navigate}
              onDeclineRehearsal={onDeclineRehearsal}
              onOpenPractice={onOpenPractice}
              onRsvp={onRsvp}
              timezone={dashboard.timezone}
              userVoicePart={userVoicePart}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}

function DashboardWidgets({
  activeSeasonLabel,
  dashboard,
  navigate,
  onSelectBulletin,
}: {
  readonly activeSeasonLabel: string;
  readonly dashboard: MemberDashboardResponse;
  readonly navigate: (href: string) => void;
  readonly onSelectBulletin: (id: string) => void;
}) {
  return (
    <aside className="member-dashboard__widgets" aria-label="Member updates">
      {dashboard.activeSeasonState === "unavailable" ? (
        <fieldset className="member-dashboard__widget">
          <legend className="member-dashboard__widget-legend">Season dues</legend>
          <p className="notice notice--warning" role="status">
            Season dues are temporarily unavailable.
          </p>
        </fieldset>
      ) : dashboard.activeSeason ? (
        <fieldset className="member-dashboard__widget">
          <legend className="member-dashboard__widget-legend">Season dues</legend>
          <div className="member-dashboard__widget-dues">
            <span className="member-dashboard__widget-dues-name">
              {dashboard.activeSeason.season.name}
            </span>
            <span className="member-dashboard__widget-status">{activeSeasonLabel}</span>
          </div>
          <AppLink href="/dues" onNavigate={navigate}>
            View dues details
          </AppLink>
        </fieldset>
      ) : null}
      {dashboard.pollsState === "unavailable" ? (
        <fieldset className="member-dashboard__widget">
          <legend className="member-dashboard__widget-legend">Polls</legend>
          <p className="notice notice--warning" role="status">
            Polls are temporarily unavailable.
          </p>
        </fieldset>
      ) : dashboard.polls.length > 0 ? (
        <fieldset className="member-dashboard__widget">
          <legend className="member-dashboard__widget-legend">Active polls</legend>
          <ul className="member-dashboard__link-list">
            {dashboard.polls.map((poll) => (
              <li key={poll.id}>
                <AppLink
                  href={`/member/polls/${encodeURIComponent(poll.id)}?token=${encodeURIComponent(poll.linkToken)}`}
                  onNavigate={navigate}
                >
                  {poll.title}
                </AppLink>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      <fieldset className="member-dashboard__widget">
        <legend className="member-dashboard__widget-legend">Bulletins</legend>
        {dashboard.bulletinsState === "unavailable" ? (
          <p className="notice notice--warning" role="status">
            Updates are temporarily unavailable.
          </p>
        ) : dashboard.bulletins.length === 0 ? (
          <p className="empty-state">No recent updates.</p>
        ) : (
          <ul className="member-dashboard__bulletin-list">
            {dashboard.bulletins.map((bulletin) => (
              <li key={bulletin.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectBulletin(bulletin.id);
                  }}
                >
                  <strong>{bulletin.subject || "Update"}</strong>
                  <span>{bulletin.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset className="member-dashboard__widget">
        <legend className="member-dashboard__widget-legend">Resources</legend>
        {dashboard.resourcesState === "unavailable" ? (
          <p className="notice notice--warning" role="status">
            Resources are temporarily unavailable.
          </p>
        ) : dashboard.resources.length === 0 ? (
          <p className="empty-state">No resources available.</p>
        ) : (
          <ul className="member-dashboard__link-list">
            {dashboard.resources.map((resource) => (
              <li key={resource.id}>
                <a
                  href={
                    resource.fileId
                      ? `/api/organization/files/${encodeURIComponent(resource.fileId)}`
                      : (resource.url ?? "#")
                  }
                >
                  {resource.title}
                </a>
              </li>
            ))}
          </ul>
        )}
        <AppLink href="/member/resources" onNavigate={navigate}>
          View all resources
        </AppLink>
      </fieldset>
    </aside>
  );
}

function DashboardDialogs({
  actionError,
  busyEventId,
  declineEvent,
  declineNote,
  onChangeDeclineNote,
  onCloseBulletin,
  onCloseDecline,
  onDecline,
  selectedBulletin,
}: {
  readonly actionError: string | null;
  readonly busyEventId: string | null;
  readonly declineEvent: DashboardEvent | null;
  readonly declineNote: string;
  readonly onChangeDeclineNote: (value: string) => void;
  readonly onCloseBulletin: () => void;
  readonly onCloseDecline: () => void;
  readonly onDecline: () => void;
  readonly selectedBulletin: MemberDashboardResponse["bulletins"][number] | null;
}) {
  return (
    <>
      <Dialog
        description="Please add a note so the Organization knows why you cannot attend."
        onClose={onCloseDecline}
        open={declineEvent !== null}
        title="Decline rehearsal"
      >
        <form
          className="form-stack"
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            onDecline();
          }}
        >
          {actionError ? (
            <p className="notice notice--error" role="alert">
              {actionError}
            </p>
          ) : null}
          {busyEventId === declineEvent?.id ? (
            <p className="notice notice--info" role="status">
              Saving your RSVP…
            </p>
          ) : null}
          <div className="field">
            <label htmlFor="decline-rehearsal-note">Note</label>
            <textarea
              aria-describedby="decline-rehearsal-note-help"
              aria-required="true"
              id="decline-rehearsal-note"
              maxLength={2_000}
              onChange={(event) => {
                onChangeDeclineNote(event.target.value);
              }}
              required
              value={declineNote}
            />
            <small className="field-help" id="decline-rehearsal-note-help">
              Required for rehearsals. {String(declineNote.length)} of 2,000 characters.
            </small>
          </div>
          <div className="dialog__actions">
            <DialogClose asChild>
              <button
                className="button button--secondary"
                disabled={busyEventId === declineEvent?.id}
                type="button"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              className="button button--danger"
              disabled={!declineNote.trim() || busyEventId === declineEvent?.id}
              type="submit"
            >
              {busyEventId === declineEvent?.id ? "Saving…" : "Decline rehearsal"}
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog
        onClose={onCloseBulletin}
        open={selectedBulletin !== null}
        title={bulletinDialogTitle(selectedBulletin)}
      >
        {selectedBulletin ? (
          <div
            className="communication-markdown-content"
            dangerouslySetInnerHTML={{
              __html: renderCommunicationMarkdownPreview(selectedBulletin.contentMarkdown),
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function DashboardInitialState({
  error,
  loading,
  onRetry,
}: {
  readonly error: string | null;
  readonly loading: boolean;
  readonly onRetry: () => void;
}) {
  if (loading) {
    return (
      <p className="notice notice--info" role="status">
        Loading your dashboard…
      </p>
    );
  }
  if (!error) return null;
  return (
    <section className="account-layout member-dashboard">
      <p className="notice notice--error" role="alert">
        {error}
      </p>
      <button className="button button--primary" onClick={onRetry} type="button">
        Try again
      </button>
    </section>
  );
}

function MemberDashboardAccessState({
  accessStatus,
  navigate,
}: {
  readonly accessStatus: MemberWorkspaceAccessStatus;
  readonly navigate: (href: string) => void;
}) {
  if (accessStatus === "loading") {
    return (
      <p className="notice notice--info" role="status">
        Loading your member workspace…
      </p>
    );
  }

  const content =
    accessStatus === "none"
      ? {
          heading: "Choose an Organization to get started",
          message:
            "Your member workspace shows schedules, RSVPs, practice tracks, and Organization updates after you open an active Organization Membership.",
        }
      : accessStatus === "error"
        ? {
            heading: "We couldn’t verify your Organization access",
            message:
              "Open your account to choose an active Organization Membership, then return here to see your member workspace.",
          }
        : {
            heading: "Your member workspace is not ready yet",
            message:
              "Your Organization access needs to be verified before your schedule and updates can appear here. Ask an Organization Administrator for help.",
          };

  return (
    <section
      aria-labelledby="member-dashboard-access-title"
      className="surface-card empty-page member-dashboard__access-state"
    >
      <h2 id="member-dashboard-access-title">{content.heading}</h2>
      <p>{content.message}</p>
      <button
        className="button button--primary"
        onClick={() => {
          navigate("/account/organizations");
        }}
        type="button"
      >
        View your Organizations
      </button>
    </section>
  );
}

export function DashboardView({
  accessStatus,
  enabled,
  navigate,
}: {
  readonly accessStatus: MemberWorkspaceAccessStatus;
  readonly enabled: boolean;
  readonly navigate: (href: string) => void;
}) {
  const [dashboard, setDashboard] = useState<MemberDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [declineEvent, setDeclineEvent] = useState<DashboardEvent | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [selectedBulletinId, setSelectedBulletinId] = useState<string | null>(null);

  const loadDashboard = useCallback(
    async (showLoading = false): Promise<void> => {
      if (!enabled) return;
      if (showLoading) setLoading(true);
      try {
        const result = await getMemberDashboard();
        setDashboard(result);
        setError(null);
      } catch {
        setError("Your member dashboard could not be loaded. Try again.");
      } finally {
        setLoading(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getMemberDashboard().then(
      (result) => {
        if (!active) return;
        setDashboard(result);
        setError(null);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setError("Your member dashboard could not be loaded. Try again.");
        setLoading(false);
      },
    );
    function refreshOnFocus(): void {
      void loadDashboard();
    }
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [enabled, loadDashboard]);

  async function updateRsvp(
    event: DashboardEvent,
    rsvp: "No" | "Yes",
    rsvpNote = "",
  ): Promise<boolean> {
    setBusyEventId(event.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await setMyEventRsvp(event.id, rsvp, rsvpNote);
      await loadDashboard();
      setActionMessage("Your RSVP was updated.");
      return true;
    } catch {
      setActionError("Your RSVP could not be updated. Please try again.");
      return false;
    } finally {
      setBusyEventId(null);
    }
  }

  async function openPractice(event: DashboardEvent): Promise<void> {
    if (!event.practice.sourceEventId) return;
    setBusyEventId(event.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const href = await getMemberPracticeLink(event.practice.sourceEventId);
      window.location.assign(href);
    } catch {
      setActionError("The practice player could not be opened.");
      setBusyEventId(null);
    }
  }

  const selectedBulletin = dashboard?.bulletins.find(({ id }) => id === selectedBulletinId) ?? null;
  const activeSeasonLabel = useMemo(() => {
    const status = dashboard?.activeSeason?.duesStatus;
    if (!status) return "Not paid";
    if (status === "paid") return "Paid";
    if (status === "pending") return "Payment pending";
    if (status === "refunded") return "Refunded";
    return "Payment expired";
  }, [dashboard?.activeSeason?.duesStatus]);

  if (!enabled) {
    return <MemberDashboardAccessState accessStatus={accessStatus} navigate={navigate} />;
  }
  if (!dashboard) {
    return (
      <DashboardInitialState
        error={error}
        loading={loading}
        onRetry={() => {
          void loadDashboard(true);
        }}
      />
    );
  }
  return (
    <main className="account-layout member-dashboard">
      {error ? (
        <p className="notice notice--warning" role="status">
          {error}
        </p>
      ) : null}
      {dashboard.profileLinkRequired ? (
        <section className="notice notice--info" aria-labelledby="member-dashboard-profile-title">
          <strong id="member-dashboard-profile-title">
            Your member profile is not linked yet.
          </strong>
          <p>
            Ask an Organization Owner or Administrator to link your membership so your events,
            RSVPs, dues, and updates can appear here.
          </p>
        </section>
      ) : null}
      {actionError ? (
        <p className="notice notice--error" role="alert" hidden={declineEvent !== null}>
          {actionError}
        </p>
      ) : null}
      {actionMessage ? (
        <p className="notice notice--success" role="status">
          {actionMessage}
        </p>
      ) : null}
      <div className="member-dashboard__layout">
        <DashboardSchedule
          busyEventId={busyEventId}
          dashboard={dashboard}
          navigate={navigate}
          onDeclineRehearsal={(event) => {
            setDeclineEvent(event);
            setDeclineNote("");
            setActionError(null);
            setActionMessage(null);
          }}
          onOpenPractice={(event) => {
            void openPractice(event);
          }}
          onRsvp={(event, rsvp) => {
            void updateRsvp(event, rsvp);
          }}
        />
        <DashboardWidgets
          activeSeasonLabel={activeSeasonLabel}
          dashboard={dashboard}
          navigate={navigate}
          onSelectBulletin={setSelectedBulletinId}
        />
      </div>
      <DashboardDialogs
        actionError={actionError}
        busyEventId={busyEventId}
        declineEvent={declineEvent}
        declineNote={declineNote}
        onChangeDeclineNote={setDeclineNote}
        onCloseBulletin={() => {
          setSelectedBulletinId(null);
        }}
        onCloseDecline={() => {
          if (busyEventId === null) {
            setDeclineEvent(null);
            setDeclineNote("");
            setActionError(null);
          }
        }}
        onDecline={() => {
          if (!declineEvent) return;
          void updateRsvp(declineEvent, "No", declineNote.trim()).then((succeeded) => {
            if (!succeeded) return;
            setDeclineEvent(null);
            setDeclineNote("");
          });
        }}
        selectedBulletin={selectedBulletin}
      />
    </main>
  );
}
