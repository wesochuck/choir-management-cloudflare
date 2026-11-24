import type {
  OrganizationProfileActivityActor,
  OrganizationProfileActivityEvent,
  OrganizationProfileActivityKind,
  OrganizationProfileActivityResponse,
  OrganizationProfileEmailHealth,
  OrganizationProfilePortalActivity,
} from "@choir/contracts";
import type { ProfileActivityState } from "../types";

export interface ProfileActivityPanelProps {
  readonly state: ProfileActivityState;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function roleLabel(role: "administrator" | "member" | "owner" | null): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "administrator":
      return "Administrator";
    case "member":
      return "Member";
    default:
      return "—";
  }
}

function kindLabel(kind: OrganizationProfileActivityKind): string {
  switch (kind) {
    case "attendance":
      return "Attendance";
    case "dues_payment":
      return "Dues";
    case "poll_response":
      return "Poll";
    case "portal_joined":
      return "Portal";
    case "profile_created":
      return "Profile";
    case "rsvp_change":
      return "RSVP";
    case "status_change":
      return "Status";
  }
}

function actorLabel(actorType: OrganizationProfileActivityActor | null): string | null {
  switch (actorType) {
    case "member":
      return "By member";
    case "administrator":
      return "By administrator";
    case "system":
      return "Automatic";
    default:
      return null;
  }
}

function signInMethodLabels(portal: OrganizationProfilePortalActivity): readonly string[] {
  const methods: string[] = [];
  if (portal.passkeyCount && portal.passkeyCount > 0) {
    methods.push(portal.passkeyCount === 1 ? "Passkey" : `${String(portal.passkeyCount)} passkeys`);
  }
  if (portal.hasPassword) methods.push("Password");
  if (portal.hasGoogleAccount) methods.push("Google");
  if (methods.length === 0) methods.push("Email code only");
  return methods;
}

function portalStatusBadge(portal: OrganizationProfilePortalActivity): {
  readonly className: string;
  readonly label: string;
} {
  if (portal.linked) {
    return { className: "status-pill status-pill--success", label: "Linked" };
  }
  if (portal.pendingInvitation) {
    return { className: "status-pill status-pill--warning", label: "Pending invite" };
  }
  return { className: "status-pill status-pill--neutral", label: "Not linked" };
}

function portalLastActiveText(portal: OrganizationProfilePortalActivity): string {
  if (!portal.linked) return "—";
  return portal.lastActiveAt ? formatDateTime(portal.lastActiveAt) : "Not recorded yet";
}

function portalJoinedOrInviteText(portal: OrganizationProfilePortalActivity): string {
  if (portal.linked) {
    return portal.joinedAt ? formatDate(portal.joinedAt) : "—";
  }
  if (portal.pendingInvitation) {
    return `Sent ${formatDate(portal.pendingInvitation.createdAt)} · expires ${formatDate(portal.pendingInvitation.expiresAt)}`;
  }
  return "No pending invitation";
}

function portalRoleText(portal: OrganizationProfilePortalActivity): string {
  if (portal.linked) return roleLabel(portal.role);
  if (portal.pendingInvitation) return `${roleLabel(portal.pendingInvitation.role)} (invited)`;
  return "—";
}

function PortalAccessCard({ portal }: { readonly portal: OrganizationProfilePortalActivity }) {
  const statusPill = portalStatusBadge(portal);

  return (
    <section aria-labelledby="profile-activity-portal-heading" className="profile-editor-card">
      <div className="profile-editor-card__header">
        <h4 className="profile-editor-card__title" id="profile-activity-portal-heading">
          Portal access
        </h4>
        <span className={statusPill.className}>{statusPill.label}</span>
      </div>
      <div className="profile-editor-card__body">
        <dl className="profile-activity__facts">
          <div className="profile-activity__fact">
            <dt>Last active in Organization</dt>
            <dd>{portalLastActiveText(portal)}</dd>
          </div>
          <div className="profile-activity__fact">
            <dt>{portal.linked ? "Joined Organization" : "Invitation"}</dt>
            <dd>{portalJoinedOrInviteText(portal)}</dd>
          </div>
          <div className="profile-activity__fact">
            <dt>Portal role</dt>
            <dd>{portalRoleText(portal)}</dd>
          </div>
        </dl>

        {portal.linked ? (
          <div aria-label="Sign-in readiness" className="profile-activity__pills">
            <span
              className={`status-pill ${portal.emailVerified ? "status-pill--success" : "status-pill--warning"}`}
            >
              {portal.emailVerified ? "Email verified" : "Email unverified"}
            </span>
            {signInMethodLabels(portal).map((label) => (
              <span className="status-pill status-pill--neutral" key={label}>
                {label}
              </span>
            ))}
            <span
              className={`status-pill ${portal.twoFactorEnabled ? "status-pill--success" : "status-pill--neutral"}`}
            >
              {portal.twoFactorEnabled ? "2FA enabled" : "2FA off"}
            </span>
            {portal.joinedViaInviteLink ? (
              <span className="status-pill status-pill--neutral">Joined via invite link</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EmailHealthValue({
  emailHealth,
}: {
  readonly emailHealth: OrganizationProfileEmailHealth;
}) {
  if (emailHealth.providerEmailSuppressed || emailHealth.lastBounceAt) {
    return (
      <span className="profile-activity__email-issue">
        <span className="status-pill status-pill--suppressed">
          {emailHealth.providerEmailSuppressed ? "Suppressed" : "Bounced"}
        </span>
        {emailHealth.lastBounceAt ? ` ${formatDate(emailHealth.lastBounceAt)}` : ""}
        {emailHealth.bounceReason ? ` · ${emailHealth.bounceReason}` : ""}
      </span>
    );
  }
  if (emailHealth.doNotEmail) {
    return <span className="status-pill status-pill--neutral">Do not email</span>;
  }
  if (emailHealth.lastDeliveredAt) {
    return <>Last delivered {formatDate(emailHealth.lastDeliveredAt)}</>;
  }
  return <>No emails delivered yet</>;
}

function formatRecentRehearsals(
  recentRehearsals: OrganizationProfileActivityResponse["attendance"]["recentRehearsals"],
): string {
  if (recentRehearsals.totalCount === 0) return "No rehearsals recorded";
  const parts = [
    `${String(recentRehearsals.presentCount)} present`,
    `${String(recentRehearsals.absentCount)} absent`,
  ];
  if (recentRehearsals.pendingCount > 0) {
    parts.push(`${String(recentRehearsals.pendingCount)} pending`);
  }
  return parts.join(" · ");
}

function EngagementCard({ data }: { readonly data: OrganizationProfileActivityResponse }) {
  const { attendance, emailHealth } = data;
  return (
    <section aria-labelledby="profile-activity-engagement-heading" className="profile-editor-card">
      <div className="profile-editor-card__header">
        <h4 className="profile-editor-card__title" id="profile-activity-engagement-heading">
          Engagement &amp; email
        </h4>
        <span className="profile-editor-card__meta">
          Profile created {formatDate(data.profileCreatedAt)}
        </span>
      </div>
      <div className="profile-editor-card__body">
        <dl className="profile-activity__facts">
          <div className="profile-activity__fact">
            <dt>Last attended</dt>
            <dd>
              {attendance.lastAttendedEvent
                ? `${attendance.lastAttendedEvent.eventTitle} · ${formatDate(attendance.lastAttendedEvent.startsAt)}`
                : "No attendance recorded yet"}
            </dd>
          </div>
          <div className="profile-activity__fact">
            <dt>Recent rehearsals (180 days)</dt>
            <dd>{formatRecentRehearsals(attendance.recentRehearsals)}</dd>
          </div>
          <div className="profile-activity__fact">
            <dt>Last RSVP update</dt>
            <dd>
              {data.lastRsvpResponseAt ? formatDateTime(data.lastRsvpResponseAt) : "None recorded"}
            </dd>
          </div>
          <div className="profile-activity__fact">
            <dt>Last poll response</dt>
            <dd>
              {data.lastPollResponseAt ? formatDateTime(data.lastPollResponseAt) : "None recorded"}
            </dd>
          </div>
          <div className="profile-activity__fact">
            <dt>Email health</dt>
            <dd>
              <EmailHealthValue emailHealth={emailHealth} />
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function TimelineList({
  events,
}: {
  readonly events: readonly OrganizationProfileActivityEvent[];
}) {
  if (events.length === 0) {
    return <p className="field-help">No activity has been recorded for this Profile yet.</p>;
  }
  return (
    <ul className="profile-activity__timeline">
      {events.map((event) => {
        const actor = actorLabel(event.actorType);
        return (
          <li className="profile-activity__timeline-item" key={event.id}>
            <div className="profile-activity__timeline-row">
              <div className="profile-activity__timeline-main">
                <span className="status-pill status-pill--neutral">{kindLabel(event.kind)}</span>
                <strong className="profile-activity__timeline-title">{event.title}</strong>
              </div>
              <time className="profile-activity__timeline-time" dateTime={event.occurredAt}>
                {formatDateTime(event.occurredAt)}
              </time>
            </div>
            {event.detail || actor ? (
              <div className="profile-activity__timeline-meta">
                {event.detail ? <span>{event.detail}</span> : null}
                {actor ? <span className="profile-activity__timeline-actor">{actor}</span> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ProfileActivityPanel({ state }: ProfileActivityPanelProps) {
  if (state.status === "loading") {
    return (
      <p className="notice notice--info" role="status">
        Loading activity…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Profile activity could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;

  const { data } = state;
  const { portal, timeline } = data;

  return (
    <div className="profile-editor-panel profile-editor-panel--activity">
      <div className="profile-editor-panel__header">
        <div className="profile-editor-panel__title-row">
          <h3 className="profile-editor-panel__title">Activity</h3>
        </div>
        <p className="profile-editor-panel__description">
          Organization-scoped portal access, rehearsal attendance, and recent participation for this
          Profile.
        </p>
      </div>

      <div className="profile-activity__summary-grid">
        <PortalAccessCard portal={portal} />
        <EngagementCard data={data} />
      </div>

      <section aria-labelledby="profile-activity-timeline-heading" className="profile-editor-card">
        <div className="profile-editor-card__header">
          <h4 className="profile-editor-card__title" id="profile-activity-timeline-heading">
            Recent activity
          </h4>
          <span className="profile-editor-card__meta">
            {timeline.length} {timeline.length === 1 ? "event" : "events"}
          </span>
        </div>
        <div className="profile-editor-card__body">
          <TimelineList events={timeline} />
        </div>
      </section>
    </div>
  );
}
