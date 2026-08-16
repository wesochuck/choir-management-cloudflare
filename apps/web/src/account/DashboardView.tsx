import type { MemberDashboardResponse } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getMemberDashboard, getMemberPracticeLink, setMyEventRsvp } from "../auth/api";
import { renderCommunicationMarkdownPreview } from "./communicationMarkdown";
import { AppLink } from "./components/AuthenticatedShell/navigation";
import type { AccessState } from "./components/AuthenticatedShell/types";

type DashboardEvent = MemberDashboardResponse["events"][number];
type MemberWorkspaceAccessStatus = AccessState["status"];

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function eventTypeLabel(event: DashboardEvent): string {
  return event.type === "Performance" ? "Performance" : "Rehearsal";
}

function rsvpLabel(value: DashboardEvent["resolvedRsvp"]): string {
  if (value === "Yes") return "Attending";
  if (value === "No") return "Declined";
  return "Needs response";
}

function practiceLabel(event: DashboardEvent): string {
  if (event.practice.status === "available") return "Practice";
  if (event.practice.status === "not_available") return "Practice tracks not available yet";
  return "Practice tracks not published yet";
}

function seatingLabel(event: DashboardEvent): string {
  if (event.seating.status === "available") return "Seating";
  if (event.seating.status === "not_assigned") return "Seat not assigned yet";
  if (event.seating.status === "declined") return "Seating unavailable after declining";
  return "Seating not published yet";
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
        <p className="notice notice--warning">
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
  return (
    <details className="member-dashboard__set-list">
      <summary>View set list ({String(event.setList.length)} items)</summary>
      <ul>
        {event.setList.map((item, index) => (
          <li key={`${item.title}-${String(index)}`}>{item.title}</li>
        ))}
      </ul>
    </details>
  );
}

function DashboardEventActions({
  event,
  busyEventId,
  navigate,
  onDeclineRehearsal,
  onOpenPractice,
  onRsvp,
}: {
  readonly event: DashboardEvent;
  readonly busyEventId: string | null;
  readonly navigate: (href: string) => void;
  readonly onDeclineRehearsal: (event: DashboardEvent) => void;
  readonly onOpenPractice: (event: DashboardEvent) => void;
  readonly onRsvp: (event: DashboardEvent, rsvp: "No" | "Yes") => void;
}) {
  const practiceEnabled = event.practice.status === "available";
  const seatingEnabled =
    event.type === "Performance" &&
    event.seating.status !== "not_published" &&
    event.seating.status !== "declined";
  const actionDisabled = isActionDisabled(event);
  const busy = busyEventId === event.id;
  return (
    <div className="member-dashboard__event-actions">
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
      <div className="member-dashboard__secondary-actions">
        <button
          className="button button--secondary"
          disabled={!practiceEnabled}
          onClick={() => {
            onOpenPractice(event);
          }}
          type="button"
        >
          {practiceLabel(event)}
        </button>
        {seatingEnabled ? (
          <AppLink href={`/seating/${event.id}`} onNavigate={navigate}>
            {seatingLabel(event)}
          </AppLink>
        ) : event.type === "Performance" ? (
          <button className="button button--secondary" disabled type="button">
            {seatingLabel(event)}
          </button>
        ) : null}
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
  onDeclineRehearsal,
  onOpenPractice,
  onRsvp,
  navigate,
  timezone,
}: {
  readonly busyEventId: string | null;
  readonly event: DashboardEvent;
  readonly navigate: (href: string) => void;
  readonly onDeclineRehearsal: (event: DashboardEvent) => void;
  readonly onOpenPractice: (event: DashboardEvent) => void;
  readonly onRsvp: (event: DashboardEvent, rsvp: "No" | "Yes") => void;
  readonly timezone: string;
}) {
  return (
    <article className="member-dashboard__event-card">
      <div className="member-dashboard__event-heading">
        <div>
          <p className="eyebrow">{eventTypeLabel(event)}</p>
          <h3>{event.title}</h3>
          <p className="member-dashboard__event-date">{formatDate(event.startsAt, timezone)}</p>
        </div>
        <span className={`rsvp-status-badge rsvp-status-badge--${event.resolvedRsvp}`}>
          {rsvpLabel(event.resolvedRsvp)}
        </span>
      </div>
      <div className="member-dashboard__event-details">
        <span>{event.venueName || event.location || "Location to be announced"}</span>
        {event.callTime ? <span>Call {event.callTime}</span> : null}
        {event.rsvpDeadlineDate && event.resolvedRsvp === "Pending" ? (
          <span>RSVP by {event.rsvpDeadlineDate}</span>
        ) : null}
      </div>
      <DashboardEventHighlights event={event} />
      <DashboardEventSetList event={event} />
      <DashboardEventActions
        busyEventId={busyEventId}
        event={event}
        navigate={navigate}
        onDeclineRehearsal={onDeclineRehearsal}
        onOpenPractice={onOpenPractice}
        onRsvp={onRsvp}
      />
      <DashboardEventFooter event={event} />
    </article>
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
  return (
    <section className="member-dashboard__events" aria-labelledby="member-dashboard-events-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Your schedule</p>
        <h2 id="member-dashboard-events-title">Upcoming events</h2>
      </div>
      {dashboard.events.length === 0 ? (
        <p className="empty-state">No upcoming events.</p>
      ) : (
        <div className="member-dashboard__event-list">
          {nextEvent ? (
            <div className="member-dashboard__next-up">
              <p className="eyebrow">Next up</p>
              <DashboardEventCard
                busyEventId={busyEventId}
                event={nextEvent}
                navigate={navigate}
                onDeclineRehearsal={onDeclineRehearsal}
                onOpenPractice={onOpenPractice}
                onRsvp={onRsvp}
                timezone={dashboard.timezone}
              />
            </div>
          ) : null}
          {remainingEvents.length > 0 ? (
            <div className="member-dashboard__more-events">
              <div className="section-heading section-heading--compact">
                <h3>More upcoming events</h3>
              </div>
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
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
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
        <section className="member-dashboard__widget">
          <p className="eyebrow">Season dues</p>
          <h2>Season dues</h2>
          <p className="notice notice--warning">Season dues are temporarily unavailable.</p>
        </section>
      ) : dashboard.activeSeason ? (
        <section className="member-dashboard__widget">
          <p className="eyebrow">Season dues</p>
          <h2>{dashboard.activeSeason.season.name}</h2>
          <p className="member-dashboard__widget-status">{activeSeasonLabel}</p>
          <AppLink href="/dues" onNavigate={navigate}>
            View dues details
          </AppLink>
        </section>
      ) : null}
      {dashboard.pollsState === "unavailable" ? (
        <section className="member-dashboard__widget">
          <h2>Polls</h2>
          <p className="notice notice--warning">Polls are temporarily unavailable.</p>
        </section>
      ) : dashboard.polls.length > 0 ? (
        <section className="member-dashboard__widget">
          <p className="eyebrow">Your input</p>
          <h2>Active polls</h2>
          <ul className="member-dashboard__link-list">
            {dashboard.polls.map((poll) => (
              <li key={poll.id}>
                <a href={`/poll?token=${encodeURIComponent(poll.linkToken)}`}>{poll.title}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="member-dashboard__widget">
        <p className="eyebrow">Updates</p>
        <h2>Bulletins</h2>
        {dashboard.bulletinsState === "unavailable" ? (
          <p className="notice notice--warning">Updates are temporarily unavailable.</p>
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
      </section>
      <section className="member-dashboard__widget">
        <p className="eyebrow">Shared by your Organization</p>
        <h2>Resources</h2>
        {dashboard.resourcesState === "unavailable" ? (
          <p className="notice notice--warning">Resources are temporarily unavailable.</p>
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
      </section>
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
            <button
              className="button button--secondary"
              disabled={busyEventId === declineEvent?.id}
              onClick={onCloseDecline}
              type="button"
            >
              Cancel
            </button>
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
          <>
            <p className="eyebrow">Bulletin</p>
            <div
              dangerouslySetInnerHTML={{
                __html: renderCommunicationMarkdownPreview(selectedBulletin.contentMarkdown),
              }}
            />
          </>
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
      <p className="eyebrow">Member workspace</p>
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
  const [refreshing, setRefreshing] = useState(false);
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
      else setRefreshing(true);
      try {
        const result = await getMemberDashboard();
        setDashboard(result);
        setError(null);
      } catch {
        setError("Your member dashboard could not be loaded. Try again.");
      } finally {
        setLoading(false);
        setRefreshing(false);
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
      <div className="member-dashboard__header">
        <div>
          <p className="eyebrow">{dashboard.performerLabel} dashboard</p>
          <h1>Welcome back{dashboard.profile ? `, ${dashboard.profile.displayName}` : ""}</h1>
          <p>Here’s what’s coming up for {dashboard.organizationName}.</p>
        </div>
        <button
          className="button button--secondary"
          disabled={refreshing}
          onClick={() => void loadDashboard()}
          type="button"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
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
