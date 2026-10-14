import type { OrganizationProfileRequest } from "@choir/contracts";
import { Dialog, Tabs, TabsContent } from "@choir/ui";
import { useMemo, useState } from "react";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { PerformanceHistory } from "../RosterPage/shared";
import { ProfileDues, ProfileFolderNumbers, ProfileMessages } from "../RosterPage/profileDetails";
import { emptyProfile, profileRequestFrom } from "../RosterPage/utils";
import { ProfileEditorFooter } from "./ProfileEditorFooter";
import { ProfileEditorHeader } from "./ProfileEditorHeader";
import { ProfileEditorNav } from "./ProfileEditorNav";
import { ProfileEmailPanel } from "./panels/ProfileEmailPanel";
import { ProfileInfoPanel } from "./panels/ProfileInfoPanel";
import type { ProfileEditorDialogProps, ProfileTab } from "./types";

function hasProfileInfoChanged(
  current: OrganizationProfileRequest,
  baseline: OrganizationProfileRequest,
): boolean {
  return (
    current.displayName !== baseline.displayName ||
    current.phone !== baseline.phone ||
    current.voicePart !== baseline.voicePart ||
    current.globalStatus !== baseline.globalStatus ||
    current.statusIsManual !== baseline.statusIsManual ||
    current.notes !== baseline.notes ||
    current.showInDirectory !== baseline.showInDirectory ||
    current.isSectionLeader !== baseline.isSectionLeader ||
    current.hidden !== baseline.hidden
  );
}

function hasEmailSettingsChanged(
  current: OrganizationProfileRequest,
  baseline: OrganizationProfileRequest,
): boolean {
  return (
    current.doNotEmail !== baseline.doNotEmail ||
    current.receiveAdminNotifications !== baseline.receiveAdminNotifications ||
    current.receiveRsvpDeclineNotices !== baseline.receiveRsvpDeclineNotices ||
    current.receiveFinancialAlerts !== baseline.receiveFinancialAlerts ||
    current.receiveAttendanceReports !== baseline.receiveAttendanceReports ||
    (current.receiveRehearsalReminders ?? true) !== (baseline.receiveRehearsalReminders ?? true) ||
    (current.receivePerformanceReminders ?? true) !==
      (baseline.receivePerformanceReminders ?? true) ||
    (current.receiveOtherEventReminders ?? true) !== (baseline.receiveOtherEventReminders ?? true)
  );
}

function isProfileDraftDirty(
  profile: OrganizationProfileRequest,
  baselineProfile: OrganizationProfileRequest,
  profileEmail: string,
  baselineEmail: string,
): boolean {
  if (profileEmail.trim().toLowerCase() !== baselineEmail.trim().toLowerCase()) {
    return true;
  }
  return (
    hasProfileInfoChanged(profile, baselineProfile) ||
    hasEmailSettingsChanged(profile, baselineProfile)
  );
}

export function ProfileEditorDialog({
  busy,
  editingId,
  editingProfileRecord,
  error,
  linkedMembership,
  onArchive,
  onClose,
  onCloseAutoFocus,
  onDeletePermanently,
  onImpersonate,
  onPhotoChanged,
  onPhotoPendingChange,
  onRegisterPhotoSave,
  onResolveDuplicate,
  onRestore,
  onRsvpChanged,
  open,
  performanceHistory,
  profile,
  profileDeliveries,
  profileDues,
  profileEmail,
  profileFolderNumbers,
  profilePhotoFileId,
  profileStatusHistory,
  profileTab,
  resetFeedback,
  resettingProfileId,
  rosterConfiguration,
  rosterMemberships = [],
  rosterReady = false,
  saveLabel,
  saveProfile,
  sendPasswordReset,
  setPerformanceHistory,
  setProfile,
  setProfileDeliveries,
  setProfileDues,
  setProfileEmail,
  setProfileFolderNumbers,
  setProfilePhotoFileId,
  setProfileTab,
}: ProfileEditorDialogProps) {
  const { organizationName, partLabel, performerLabel } = useOrganizationTerminology();
  const [photoPending, setPhotoPending] = useState(false);

  const handlePhotoPendingChange = (pending: boolean) => {
    setPhotoPending(pending);
    onPhotoPendingChange?.(pending);
  };

  const baselineProfile = useMemo(() => {
    return editingProfileRecord ? profileRequestFrom(editingProfileRecord) : emptyProfile;
  }, [editingProfileRecord]);

  const linkedProfileEmail = editingId
    ? rosterMemberships.find((m) => m.profileId === editingId)?.email
    : undefined;
  const baselineEmail = linkedProfileEmail ?? "";

  const isDirty = useMemo(() => {
    return isProfileDraftDirty(profile, baselineProfile, profileEmail, baselineEmail);
  }, [baselineEmail, baselineProfile, profile, profileEmail]);

  // Independent tabs (RSVPs, dues, folders, messages) save through their own
  // mutations. The outer profile form must never implicitly submit from those
  // panels when the general draft is pristine.
  const INDEPENDENT_TABS: readonly ProfileTab[] = ["performance", "dues", "folders", "messages"];

  function handleProfileSubmit(event: React.SyntheticEvent): void {
    event.preventDefault();
    if (INDEPENDENT_TABS.includes(profileTab) && !isDirty && !photoPending) {
      return;
    }
    void saveProfile();
  }

  function handleTabChange(nextTab: ProfileTab) {
    if (nextTab === "performance") {
      setPerformanceHistory({ status: "loading" });
    } else if (nextTab === "dues") {
      setProfileDues({ status: "loading" });
    } else if (nextTab === "folders") {
      setProfileFolderNumbers({ status: "loading" });
    } else if (nextTab === "messages") {
      setProfileDeliveries({ status: "loading" });
    }
    setProfileTab(nextTab);
  }

  const canImpersonate = Boolean(
    editingId &&
    rosterReady &&
    !rosterMemberships.some(
      (membership) =>
        membership.profileId === editingId &&
        (membership.role === "administrator" || membership.role === "owner"),
    ),
  );

  const canResolveDuplicate = Boolean(editingId && linkedMembership);

  const handlePhotoChanged = (fileId: string | null) => {
    setProfilePhotoFileId?.(fileId);
    onPhotoChanged?.(fileId);
  };

  return (
    <Dialog
      className="dialog--profile-editor"
      description="Profile details and roster attributes belong only to this Organization."
      dirty={isDirty || photoPending}
      header={
        <ProfileEditorHeader
          busy={busy}
          canImpersonate={canImpersonate}
          canResolveDuplicate={canResolveDuplicate}
          displayName={profile.displayName}
          editingId={editingId}
          globalStatus={profile.globalStatus}
          isHidden={profile.hidden}
          onArchive={onArchive}
          onDeletePermanently={onDeletePermanently}
          onImpersonate={onImpersonate}
          onResolveDuplicate={onResolveDuplicate}
          onRestore={onRestore}
          organizationName={organizationName}
          profilePhotoFileId={profilePhotoFileId}
          rosterConfiguration={rosterConfiguration}
          voicePart={profile.voicePart}
        />
      }
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      open={open}
      title={editingId ? "Edit Profile" : "Add Profile"}
    >
      <Tabs
        className="profile-editor-tabs-root"
        onValueChange={handleTabChange}
        orientation="vertical"
        value={profileTab}
      >
        <div
          className="profile-editor-layout"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          <ProfileEditorNav
            editingId={editingId}
            onValueChange={handleTabChange}
            value={profileTab}
          />

          <form className="profile-editor-main" noValidate onSubmit={handleProfileSubmit}>
            <div className="profile-editor-content">
              {error ? (
                <p className="notice notice--error" role="alert">
                  {error}
                </p>
              ) : null}

              <TabsContent
                aria-labelledby="roster-profile-info-tab"
                className="roster-profile-tab-panel"
                forceMount={true}
                id="roster-profile-info-panel"
                value="info"
              >
                <ProfileInfoPanel
                  busy={busy}
                  editingId={editingId}
                  editingProfileRecord={editingProfileRecord}
                  linkedProfileEmail={linkedProfileEmail}
                  onPhotoChanged={handlePhotoChanged}
                  onPhotoPendingChange={handlePhotoPendingChange}
                  onRegisterPhotoSave={onRegisterPhotoSave}
                  partLabel={partLabel}
                  performerLabel={performerLabel}
                  profile={profile}
                  profileEmail={profileEmail}
                  profilePhotoFileId={profilePhotoFileId}
                  profileStatusHistory={profileStatusHistory}
                  resetFeedback={resetFeedback}
                  resettingProfileId={resettingProfileId}
                  rosterConfiguration={rosterConfiguration}
                  sendPasswordReset={sendPasswordReset}
                  setProfile={setProfile}
                  setProfileEmail={setProfileEmail}
                />
              </TabsContent>

              <TabsContent
                aria-labelledby="roster-profile-email-tab"
                className="roster-profile-tab-panel"
                id="roster-profile-email-panel"
                value="email"
              >
                <ProfileEmailPanel
                  busy={busy}
                  editingProfileRecord={editingProfileRecord}
                  profile={profile}
                  setProfile={setProfile}
                />
              </TabsContent>

              {editingId ? (
                <>
                  <TabsContent
                    aria-labelledby="roster-profile-performance-tab"
                    className="roster-profile-tab-panel"
                    id="roster-profile-performance-panel"
                    value="performance"
                  >
                    <PerformanceHistory
                      onRsvpChanged={(updated) => {
                        onRsvpChanged?.(updated.eventId);
                        setPerformanceHistory((current) => {
                          if (current.status !== "ready") return current;
                          const updateRows = (rows: typeof current.data.upcoming) =>
                            rows.map((performance) =>
                              performance.id === updated.eventId
                                ? { ...performance, rsvp: updated.rsvp }
                                : performance,
                            );
                          return {
                            ...current,
                            data: {
                              ...current.data,
                              past: updateRows(current.data.past),
                              upcoming: updateRows(current.data.upcoming),
                            },
                          };
                        });
                      }}
                      profileId={editingId}
                      state={performanceHistory}
                    />
                  </TabsContent>

                  <TabsContent
                    aria-labelledby="roster-profile-dues-tab"
                    className="roster-profile-tab-panel"
                    id="roster-profile-dues-panel"
                    value="dues"
                  >
                    <ProfileDues
                      onCashPaymentMarked={(record) => {
                        setProfileDues((current) => {
                          if (current.status !== "ready") return current;
                          const existing = current.dues.some(
                            (candidate) => candidate.id === record.id,
                          );
                          return {
                            ...current,
                            dues: existing
                              ? current.dues.map((candidate) =>
                                  candidate.id === record.id ? record : candidate,
                                )
                              : [...current.dues, record],
                          };
                        });
                      }}
                      profileId={editingId}
                      state={profileDues}
                    />
                  </TabsContent>

                  <TabsContent
                    aria-labelledby="roster-profile-folders-tab"
                    className="roster-profile-tab-panel"
                    id="roster-profile-folders-panel"
                    value="folders"
                  >
                    <ProfileFolderNumbers
                      onFolderNumberChanged={(updated) => {
                        setProfileFolderNumbers((current) => {
                          if (current.status !== "ready") return current;
                          return {
                            ...current,
                            folderNumbers: current.folderNumbers.map((folder) =>
                              folder.eventId === updated.eventId ? updated : folder,
                            ),
                          };
                        });
                      }}
                      profileId={editingId}
                      state={profileFolderNumbers}
                    />
                  </TabsContent>

                  <TabsContent
                    aria-labelledby="roster-profile-messages-tab"
                    className="roster-profile-tab-panel"
                    id="roster-profile-messages-panel"
                    value="messages"
                  >
                    <ProfileMessages state={profileDeliveries} />
                  </TabsContent>
                </>
              ) : null}
            </div>

            <ProfileEditorFooter
              activeTab={profileTab}
              busy={busy}
              editingId={editingId}
              isDirty={isDirty || photoPending}
              saveLabel={saveLabel}
            />
          </form>
        </div>
      </Tabs>
    </Dialog>
  );
}
