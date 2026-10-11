import { DialogClose, DropdownMenu } from "@choir/ui";
import type { OrganizationRosterConfiguration } from "@choir/contracts";
import { statusLabel } from "../RosterPage/utils";

export interface ProfileEditorHeaderProps {
  readonly busy?: boolean | undefined;
  readonly canImpersonate: boolean;
  readonly canResolveDuplicate: boolean;
  readonly displayName: string;
  readonly editingId: string | null;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly onImpersonate?: (() => void) | undefined;
  readonly onResolveDuplicate?: (() => void) | undefined;
  readonly organizationName?: string | undefined;
  readonly profilePhotoFileId: string | null;
  readonly rosterConfiguration?: OrganizationRosterConfiguration | undefined;
  readonly voicePart: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "—";
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function getVoicePartDisplay(
  voicePart: string,
  rosterConfiguration?: OrganizationRosterConfiguration,
): string {
  if (!voicePart) return "";
  const match = rosterConfiguration?.voiceParts.find((vp) => vp.label === voicePart);
  return match?.fullName ?? voicePart;
}

function getStatusClass(status: "Active" | "Idle" | "Inactive"): string {
  switch (status) {
    case "Active":
      return "status-pill--success";
    case "Idle":
      return "status-pill--warning";
    case "Inactive":
      return "status-pill--neutral";
  }
}

function ProfileAvatar({
  displayName,
  isEdit,
  photoFileId,
}: {
  readonly displayName: string;
  readonly isEdit: boolean;
  readonly photoFileId: string | null;
}) {
  if (isEdit && photoFileId) {
    return (
      <img
        alt={`${displayName} profile photo`}
        className="profile-editor-header__avatar profile-editor-header__avatar--photo"
        src={`/api/organization/files/${encodeURIComponent(photoFileId)}`}
      />
    );
  }
  if (isEdit) {
    return (
      <div
        aria-hidden="true"
        className="profile-editor-header__avatar profile-editor-header__avatar--initials"
      >
        {getInitials(displayName)}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className="profile-editor-header__avatar profile-editor-header__avatar--placeholder"
    >
      <svg
        fill="none"
        height="24"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="24"
      >
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>
  );
}

function buildMoreActions(
  canImpersonate: boolean,
  onImpersonate: (() => void) | undefined,
  canResolveDuplicate: boolean,
  onResolveDuplicate: (() => void) | undefined,
  busy = false,
) {
  const items = [];
  if (canImpersonate && onImpersonate) {
    items.push({
      disabled: busy,
      label: "Impersonate",
      onSelect: onImpersonate,
    });
  }
  if (canResolveDuplicate && onResolveDuplicate) {
    items.push({
      disabled: busy,
      label: "Resolve duplicate",
      onSelect: onResolveDuplicate,
    });
  }
  return items;
}

export function ProfileEditorHeader({
  busy = false,
  canImpersonate,
  canResolveDuplicate,
  displayName,
  editingId,
  globalStatus,
  onImpersonate,
  onResolveDuplicate,
  organizationName,
  profilePhotoFileId,
  rosterConfiguration,
  voicePart,
}: ProfileEditorHeaderProps) {
  // Add mode must stay an honest placeholder until the profile is created.
  // Never derive edit state from the draft displayName input.
  const isEdit = editingId !== null;
  const trimmedName = displayName.trim();
  const headerName = isEdit ? trimmedName || "Untitled profile" : "Add Profile";
  const voicePartDisplay = getVoicePartDisplay(voicePart, rosterConfiguration);
  const moreActionsItems = buildMoreActions(
    canImpersonate,
    onImpersonate,
    canResolveDuplicate,
    onResolveDuplicate,
    busy,
  );
  const statusClass = getStatusClass(globalStatus);

  return (
    <div className="profile-editor-header">
      <div className="profile-editor-header__identity">
        <div className="profile-editor-header__avatar-wrapper">
          <ProfileAvatar
            displayName={trimmedName || headerName}
            isEdit={isEdit}
            photoFileId={profilePhotoFileId}
          />
        </div>

        <div className="profile-editor-header__details">
          <h2 className="profile-editor-header__name">{headerName}</h2>
          {isEdit ? (
            <div className="profile-editor-header__meta">
              <span className={`status-pill ${statusClass}`}>{statusLabel(globalStatus)}</span>
              {voicePartDisplay ? (
                <>
                  <span aria-hidden="true" className="profile-editor-header__meta-sep">
                    ·
                  </span>
                  <span className="profile-editor-header__part">{voicePartDisplay}</span>
                </>
              ) : null}
              {organizationName ? (
                <>
                  <span aria-hidden="true" className="profile-editor-header__meta-sep">
                    ·
                  </span>
                  <span className="profile-editor-header__org" title={organizationName}>
                    {organizationName}
                  </span>
                </>
              ) : null}
            </div>
          ) : (
            <p className="profile-editor-header__subtext">Create a new choir member profile</p>
          )}
        </div>
      </div>

      <div className="profile-editor-header__actions">
        {moreActionsItems.length > 0 ? (
          <DropdownMenu
            accessibleLabel="More actions"
            items={moreActionsItems}
            trigger={
              <button
                className="button button--secondary button--small profile-editor-header__more-btn"
                type="button"
              >
                <span aria-hidden="true" className="profile-editor-header__more-icon">
                  •••
                </span>
                <span>More actions</span>
              </button>
            }
          />
        ) : null}
        <DialogClose asChild>
          <button aria-label="Close" className="dialog__close" type="button">
            &times;
          </button>
        </DialogClose>
      </div>
    </div>
  );
}
