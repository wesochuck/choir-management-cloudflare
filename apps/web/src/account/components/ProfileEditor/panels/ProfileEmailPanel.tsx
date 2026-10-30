import type { OrganizationProfile, OrganizationProfileRequest } from "@choir/contracts";
import { ProfileSettingSwitch } from "../ProfileSettingSwitch";

export interface ProfileEmailPanelProps {
  readonly busy: boolean;
  readonly editingProfileRecord?: OrganizationProfile | null | undefined;
  readonly profile: OrganizationProfileRequest;
  readonly setProfile: React.Dispatch<React.SetStateAction<OrganizationProfileRequest>>;
}

export function ProfileEmailPanel({
  busy,
  editingProfileRecord,
  profile,
  setProfile,
}: ProfileEmailPanelProps) {
  const isSuppressed = Boolean(editingProfileRecord?.providerEmailSuppressed);
  const isDoNotEmail = profile.doNotEmail;

  return (
    <div className="profile-editor-panel profile-editor-panel--email">
      <div className="profile-editor-panel__header">
        <div className="profile-editor-panel__title-row">
          <h3 className="profile-editor-panel__title">Email & notifications</h3>
          {isDoNotEmail ? (
            <span className="status-pill status-pill--warning">Email blocked</span>
          ) : isSuppressed ? (
            <span className="status-pill status-pill--suppressed">Suppressed</span>
          ) : (
            <span
              className="status-pill status-pill--success"
              title="Local settings allow email. Provider delivery is not guaranteed."
            >
              Not blocked
            </span>
          )}
        </div>
        <p className="profile-editor-panel__description">
          Choose what messages this member receives. Local settings only; provider delivery is never
          guaranteed.
        </p>
      </div>

      <div className="profile-editor-cards">
        {/* Card 1: Delivery override */}
        <div className="profile-editor-card">
          <div className="profile-editor-card__header">
            <h4 className="profile-editor-card__title">Delivery override</h4>
            <span className="profile-editor-card__meta">Overrides preferences below</span>
          </div>
          <div className="profile-editor-card__body">
            <ProfileSettingSwitch
              accessibleLabel="Do not email"
              checked={profile.doNotEmail}
              description="Block optional alerts and reminders, even when enabled below."
              disabled={busy}
              id="roster-profile-do-not-email"
              onChange={(checked) => {
                setProfile((current) => ({
                  ...current,
                  doNotEmail: checked,
                }));
              }}
              title="Do not email"
            />
            {isSuppressed ? (
              <p className="field-help profile-editor-card__warning" role="status">
                Provider suppression is active for this profile. Changing “Do not email” does not
                release it; a Platform Administrator must review and release the local provider
                suppression after the account issue is resolved. Cloudflare-managed suppression may
                still block delivery.
              </p>
            ) : null}
          </div>
        </div>

        {/* Card 2: Administrative alerts */}
        <div className="profile-editor-card">
          <div className="profile-editor-card__header">
            <h4 className="profile-editor-card__title">Administrative alerts</h4>
            <span className="profile-editor-card__meta">Operational messages</span>
          </div>
          <div className="profile-editor-card__body">
            <ProfileSettingSwitch
              accessibleLabel="Administrator notifications — Receive operational and audition emails"
              checked={profile.receiveAdminNotifications}
              description="Operational and audition-related messages."
              disabled={busy}
              id="roster-profile-admin-notifications"
              onChange={(checked) => {
                setProfile((current) => ({
                  ...current,
                  receiveAdminNotifications: checked,
                }));
              }}
              title="Administrator notifications"
            />
            <ProfileSettingSwitch
              accessibleLabel="RSVP decline notices — Receive alerts when invited members decline"
              checked={profile.receiveRsvpDeclineNotices}
              description="Receive alerts when invited members decline."
              disabled={busy}
              id="roster-profile-rsvp-decline-notices"
              onChange={(checked) => {
                setProfile((current) => ({
                  ...current,
                  receiveRsvpDeclineNotices: checked,
                }));
              }}
              title="RSVP decline notices"
            />
            <ProfileSettingSwitch
              accessibleLabel="Financial alerts — Receive updates about ticket sales, donations, and finances"
              checked={profile.receiveFinancialAlerts}
              description="Updates about ticket sales, donations, and finances."
              disabled={busy}
              id="roster-profile-financial-alerts"
              onChange={(checked) => {
                setProfile((current) => ({
                  ...current,
                  receiveFinancialAlerts: checked,
                }));
              }}
              title="Financial alerts"
            />
          </div>
        </div>

        {/* Card 3: Event reminders */}
        <fieldset className="profile-editor-card" disabled={busy}>
          <legend className="profile-editor-card__header">
            <span className="profile-editor-card__title">Email reminder preferences</span>
            <span className="profile-editor-card__meta">Automatic emails</span>
          </legend>
          <div className="profile-editor-card__body">
            <p className="field-help" id="roster-reminder-preferences-help">
              Choose which automatic event reminders you receive, currently scheduled about 48 hours
              before an event. Turning off a reminder does not change your RSVP or remove the event
              from your schedule. Organization-wide opt-outs, suppressions, and email bounces still
              take precedence.
            </p>
            <ProfileSettingSwitch
              accessibleLabel="Rehearsals — Email me before upcoming rehearsals"
              checked={profile.receiveRehearsalReminders ?? true}
              description="Remind me before upcoming rehearsals."
              disabled={busy}
              id="roster-profile-rehearsal-reminders"
              onChange={(checked) => {
                setProfile((current) => ({
                  ...current,
                  receiveRehearsalReminders: checked,
                }));
              }}
              title="Rehearsals"
            />
            <ProfileSettingSwitch
              accessibleLabel="Performances — Email me before upcoming concerts and performances"
              checked={profile.receivePerformanceReminders ?? true}
              description="Remind me before concerts and performances."
              disabled={busy}
              id="roster-profile-performance-reminders"
              onChange={(checked) => {
                setProfile((current) => ({
                  ...current,
                  receivePerformanceReminders: checked,
                }));
              }}
              title="Performances"
            />
            <ProfileSettingSwitch
              accessibleLabel="Other events — Email me about invited or volunteered events"
              checked={profile.receiveOtherEventReminders ?? true}
              description="Remind me about events where I'm invited or volunteering."
              disabled={busy}
              id="roster-profile-other-event-reminders"
              onChange={(checked) => {
                setProfile((current) => ({
                  ...current,
                  receiveOtherEventReminders: checked,
                }));
              }}
              title="Other events"
            />
          </div>
        </fieldset>
      </div>

      <div className="profile-editor-callout">
        <svg
          aria-hidden="true"
          className="profile-editor-callout__icon"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="18"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <p className="profile-editor-callout__text">
          Reminders are generally sent about 48 hours before an event. Turning them off does not
          change a member's RSVP status.
        </p>
      </div>
    </div>
  );
}
