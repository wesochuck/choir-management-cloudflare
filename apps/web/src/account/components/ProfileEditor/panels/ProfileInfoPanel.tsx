import type {
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { getAssignableVoiceParts } from "@choir/domain";
import { ProfilePhotoEditor } from "../../../MemberProfileDirectory";
import { formatProfileTransitionDate, statusLabel } from "../../RosterPage/utils";
import type { ProfileStatusHistoryState } from "../types";

export interface ProfileInfoPanelProps {
  readonly busy: boolean;
  readonly editingId: string | null;
  readonly editingProfileRecord?: OrganizationProfile | null | undefined;
  readonly linkedProfileEmail?: string | undefined;
  readonly onPhotoChanged?: ((fileId: string | null) => void) | undefined;
  readonly onPhotoPendingChange: (pending: boolean) => void;
  readonly onRegisterPhotoSave?: ((saveFn: (() => Promise<boolean>) | null) => void) | undefined;
  readonly partLabel: string;
  readonly performerLabel: string;
  readonly profile: OrganizationProfileRequest;
  readonly profileEmail: string;
  readonly profilePhotoFileId: string | null;
  readonly profileStatusHistory: ProfileStatusHistoryState;
  readonly resetFeedback?: string | null | undefined;
  readonly resettingProfileId?: string | null | undefined;
  readonly rosterConfiguration?: OrganizationRosterConfiguration | undefined;
  readonly sendPasswordReset?: (() => Promise<void>) | undefined;
  readonly setProfile: React.Dispatch<React.SetStateAction<OrganizationProfileRequest>>;
  readonly setProfileEmail: (email: string) => void;
}

export function ProfileInfoPanel({
  busy,
  editingId,
  editingProfileRecord,
  linkedProfileEmail,
  onPhotoChanged,
  onPhotoPendingChange,
  onRegisterPhotoSave,
  partLabel,
  profile,
  profileEmail,
  profilePhotoFileId,
  profileStatusHistory,
  resetFeedback,
  resettingProfileId,
  rosterConfiguration,
  sendPasswordReset,
  setProfile,
  setProfileEmail,
}: ProfileInfoPanelProps) {
  return (
    <div className="profile-editor-panel profile-editor-panel--info">
      {editingId ? (
        <ProfilePhotoEditor
          onChanged={onPhotoChanged ?? (() => undefined)}
          onPendingChange={onPhotoPendingChange}
          onRegisterSave={onRegisterPhotoSave}
          profile={{
            displayName: profile.displayName,
            id: editingId,
            photoFileId: profilePhotoFileId,
          }}
        />
      ) : (
        <p className="field-help">Save the Profile before adding a profile photo.</p>
      )}

      <div className="field">
        <label htmlFor="roster-profile-name">Display name</label>
        <input
          id="roster-profile-name"
          maxLength={200}
          onChange={(event) => {
            setProfile((current) => ({
              ...current,
              displayName: event.target.value,
            }));
          }}
          required
          value={profile.displayName}
        />
      </div>

      <div className="field">
        <label htmlFor="roster-profile-phone">Phone</label>
        <input
          id="roster-profile-phone"
          maxLength={50}
          onChange={(event) => {
            setProfile((current) => ({ ...current, phone: event.target.value }));
          }}
          value={profile.phone}
        />
      </div>

      <div className="field">
        <label htmlFor="roster-profile-email">Contact email</label>
        <input
          id="roster-profile-email"
          onChange={(event) => {
            setProfileEmail(event.target.value);
          }}
          placeholder="Email for Organization communications"
          type="email"
          value={profileEmail}
        />
        <p className="field-help">{accountDescription(linkedProfileEmail)}</p>
        {linkedProfileEmail && sendPasswordReset ? (
          <button
            className="button button--secondary button--small"
            disabled={busy || resettingProfileId !== null}
            onClick={() => {
              void sendPasswordReset();
            }}
            type="button"
          >
            {resettingProfileId ? "Sending reset email…" : "Send password reset"}
          </button>
        ) : null}
        {resetFeedback ? (
          <p className="notice notice--info" role="status">
            {resetFeedback}
          </p>
        ) : null}
      </div>

      {(() => {
        const assignableVoiceParts = rosterConfiguration
          ? getAssignableVoiceParts(rosterConfiguration.sections, rosterConfiguration.voiceParts)
          : [];
        const isLegacyTrackOnlyPart = Boolean(
          profile.voicePart &&
          !assignableVoiceParts.some((part) => part.label === profile.voicePart),
        );
        const legacyPart = isLegacyTrackOnlyPart
          ? rosterConfiguration?.voiceParts.find((part) => part.label === profile.voicePart)
          : null;
        const legacyOptionLabel = legacyPart
          ? `${legacyPart.fullName} (${legacyPart.label}) [Track-only — needs correction]`
          : `${profile.voicePart} [Needs correction]`;

        return (
          <div className="field">
            <label htmlFor="roster-profile-voice-part">{partLabel}</label>
            <select
              id="roster-profile-voice-part"
              onChange={(event) => {
                setProfile((current) => ({ ...current, voicePart: event.target.value }));
              }}
              value={profile.voicePart}
            >
              <option value="">No {partLabel.toLowerCase()}</option>
              {isLegacyTrackOnlyPart ? (
                <option value={profile.voicePart} disabled>
                  {legacyOptionLabel}
                </option>
              ) : null}
              {assignableVoiceParts.map(({ fullName, label }) => (
                <option key={label} value={label}>
                  {fullName} ({label})
                </option>
              ))}
            </select>
            {isLegacyTrackOnlyPart ? (
              <p className="notice notice--warning" role="alert">
                This {partLabel.toLowerCase()} is configured as track-only for recordings and cannot
                be assigned to members. Please assign a valid roster {partLabel.toLowerCase()} or
                clear it.
              </p>
            ) : null}
          </div>
        );
      })()}

      <div className="field">
        <label htmlFor="roster-profile-status">Status</label>
        <select
          id="roster-profile-status"
          onChange={(event) => {
            const value = event.target.value;
            setProfile((current) => ({
              ...current,
              globalStatus: value === "Idle" || value === "Inactive" ? value : "Active",
            }));
          }}
          value={profile.globalStatus}
        >
          <option value="Active">Active</option>
          <option value="Idle">On Break</option>
          <option value="Inactive">Inactive</option>
        </select>
        <p className="field-help">
          Selecting a status does not turn automation off. The Profile may be updated by the roster
          rules until you explicitly manage status manually.
        </p>
      </div>

      <label className="checkbox-row">
        <input
          checked={profile.statusIsManual}
          onChange={(event) => {
            setProfile((current) => ({
              ...current,
              statusIsManual: event.target.checked,
            }));
          }}
          type="checkbox"
        />
        Manage status manually (opt out of automatic status changes)
      </label>

      {profile.globalStatus === "Idle" ? (
        <p className="notice notice--info">
          {profile.statusIsManual
            ? "Manual status control is on, so this Profile has no automatic On Break transition date."
            : editingProfileRecord
              ? `On Break ${formatProfileTransitionDate(editingProfileRecord.onBreakInactiveAt)}`
              : "The On Break transition date will be calculated after this Profile is saved."}
        </p>
      ) : null}

      {editingId && profileStatusHistory.status === "ready" ? (
        <div className="profile-status-history">
          <p className="field-label">Profile Status History</p>
          {profileStatusHistory.data.entries.length === 0 ? (
            <p className="field-help">No automatic or manual status changes recorded yet.</p>
          ) : (
            <ul className="compact-list">
              {profileStatusHistory.data.entries.slice(0, 5).map((entry) => (
                <li key={`${entry.occurredAt}-${entry.triggerType}`}>
                  <strong>{statusLabel(entry.newStatus)}</strong> · {entry.reason}{" "}
                  <span className="field-help">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(entry.occurredAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="roster-profile-notes">Notes</label>
        <textarea
          id="roster-profile-notes"
          maxLength={100000}
          onChange={(event) => {
            setProfile((current) => ({ ...current, notes: event.target.value }));
          }}
          rows={4}
          value={profile.notes}
        />
      </div>

      <div className="field-group">
        <label className="checkbox-row">
          <input
            checked={profile.showInDirectory}
            onChange={(event) => {
              setProfile((current) => ({
                ...current,
                showInDirectory: event.target.checked,
              }));
            }}
            type="checkbox"
          />
          List in member directory
        </label>
        <p className="field-help">
          Opt in to include this Profile in the Organization member directory.
        </p>
      </div>

      <label className="checkbox-row">
        <input
          checked={profile.isSectionLeader}
          onChange={(event) => {
            setProfile((current) => ({
              ...current,
              isSectionLeader: event.target.checked,
            }));
          }}
          type="checkbox"
        />
        Section leader
      </label>

      <div className="field-group">
        <label className="checkbox-row">
          <input
            checked={profile.hidden}
            onChange={(event) => {
              setProfile((current) => ({
                ...current,
                hidden: event.target.checked,
              }));
            }}
            type="checkbox"
          />
          Exclude from roster
        </label>
        <p className="field-help">
          Keeps the Profile and history, but removes it from the normal roster view and search.
        </p>
      </div>
    </div>
  );
}

function accountDescription(email: string | undefined): string {
  return email
    ? `Linked account — sign-in email: ${email}`
    : "No account. Saving contact details does not send an invitation.";
}
