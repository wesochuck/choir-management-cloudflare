import { rosterCsvColumnOptions } from "@choir/domain";
import { DataTable, Dialog } from "@choir/ui";
import { PerformanceHistory, VoicePartBalance } from "./shared";
import { formatProfileTransitionDate, parseRosterStatusFilter, statusLabel } from "./utils";
import { ProfileDues, ProfileFolderNumbers } from "./profileDetails";
import { CsvImportDialog } from "../../CsvImportDialog";
import { ProfilePhotoEditor } from "../../MemberProfileDirectory";
import { RosterAutomationSettings } from "../../RosterAutomationSettings";
import { RosterConfiguration } from "../../RosterConfiguration";
import { useState } from "react";
import type { RosterPageModel } from "./hooks";

// eslint-disable-next-line complexity -- render composition preserves the existing screen's independent states and dialogs.
export function RosterPageView({
  initialSection = "roster",
  model,
}: {
  readonly initialSection?: "roster" | "settings";
  readonly model: RosterPageModel;
}) {
  const [activeTab, setActiveTab] = useState<"roster" | "settings">(initialSection);
  const {
    busy,
    clearRosterFilters,
    closeDialog,
    closeImportDialog,
    dialogOpen,
    editingId,
    editingProfileRecord,
    enabled,
    error,
    filteredProfiles,
    handleRosterColumnMap,
    handleRosterImportFile,
    importDialogOpen,
    importFile,
    importRoster,
    openCreate,
    openEdit,
    performanceHistory,
    performerLabel,
    profile,
    profileDues,
    profileEmail,
    profileFolderNumbers,
    profilePhotoFileId,
    profileStatusHistory,
    profileTab,
    query,
    resetFeedback,
    resettingProfileId,
    roster,
    rosterImportConfirmed,
    rosterImportHeaders,
    rosterImportInspecting,
    rosterImportInspection,
    rosterImportMappings,
    saveProfile,
    selectedVoiceFilters,
    sendPasswordReset,
    setError,
    setImportDialogOpen,
    setPerformanceHistory,
    setProfile,
    setProfileDues,
    setProfileEmail,
    setProfileFolderNumbers,
    setProfilePhotoFileId,
    setProfileTab,
    setQuery,
    setRoster,
    setRosterImportConfirmed,
    setStatusFilter,
    setSuccess,
    statusFilter,
    success,
    toggleVoiceFilter,
  } = model;
  if (!enabled) {
    return <p className="notice notice--warning">Verify Organization MFA to manage the roster.</p>;
  }
  return (
    <>
      <nav className="ticketing-tabs roster-page-tabs" aria-label="Roster sections" role="tablist">
        <button
          aria-controls="roster-directory-panel"
          aria-selected={activeTab === "roster"}
          className={activeTab === "roster" ? "is-active" : undefined}
          id="roster-directory-tab"
          onClick={() => {
            setActiveTab("roster");
          }}
          role="tab"
          type="button"
        >
          Roster
        </button>
        <button
          aria-controls="roster-settings-panel"
          aria-selected={activeTab === "settings"}
          className={activeTab === "settings" ? "is-active" : undefined}
          id="roster-settings-tab"
          onClick={() => {
            setActiveTab("settings");
          }}
          role="tab"
          type="button"
        >
          Settings
        </button>
      </nav>
      <div
        aria-labelledby="roster-settings-tab"
        hidden={activeTab !== "settings"}
        id="roster-settings-panel"
        role="tabpanel"
      >
        <RosterConfiguration enabled={enabled} />
        <RosterAutomationSettings enabled={enabled} />
      </div>
      <div
        aria-labelledby="roster-directory-tab"
        hidden={activeTab !== "roster"}
        id="roster-directory-panel"
        role="tabpanel"
      >
        <div className="page-toolbar">
          <div className="page-toolbar__actions">
            <a
              className="button button--secondary"
              download="choir_roster_export.csv"
              href="/api/organization/profiles/export.csv"
            >
              Export CSV
            </a>
            <button
              className="button button--secondary"
              onClick={() => {
                setError(null);
                setSuccess(null);
                setImportDialogOpen(true);
              }}
              type="button"
            >
              Import CSV
            </button>
            <button className="button button--primary" onClick={openCreate} type="button">
              Add Profile
            </button>
          </div>
        </div>

        {error && !dialogOpen && !importDialogOpen ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="notice notice--success" role="status">
            {success}
          </p>
        ) : null}
        {roster.status === "loading" ? <p role="status">Loading roster…</p> : null}
        {roster.status === "error" ? (
          <p className="notice notice--error" role="alert">
            The Organization roster could not be loaded.
          </p>
        ) : null}
        {roster.status === "ready" ? (
          <>
            <VoicePartBalance
              configuration={roster.configuration}
              onToggle={toggleVoiceFilter}
              profiles={roster.profiles}
              selectedFilters={selectedVoiceFilters}
            />
            <div className="roster-filter-row">
              <label className="search-field">
                <span className="sr-only">Search Profiles</span>
                <input
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                  placeholder="Search by name or email"
                  type="search"
                  value={query}
                />
              </label>
              <label className="field roster-filter-row__status">
                <span className="sr-only">Filter by status</span>
                <select
                  aria-label="Filter by status"
                  onChange={(event) => {
                    setStatusFilter(parseRosterStatusFilter(event.target.value));
                  }}
                  value={statusFilter}
                >
                  <option value="all">All statuses</option>
                  <option value="Active">Active</option>
                  <option value="Idle">On Break</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
              {query || selectedVoiceFilters.length > 0 || statusFilter !== "all" ? (
                <button
                  className="button button--secondary"
                  onClick={clearRosterFilters}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
            <div className="table-heading">
              <h2>Profiles</h2>
              <span>{filteredProfiles.length} shown</span>
            </div>
            <DataTable
              columns={[
                {
                  header: "Name",
                  id: "name",
                  render: (candidate) => <strong>{candidate.displayName}</strong>,
                  sortValue: (candidate) => candidate.displayName,
                },
                {
                  header: "Email",
                  id: "email",
                  render: (candidate) => {
                    const email = roster.memberships.find(
                      ({ profileId }) => profileId === candidate.id,
                    )?.email;
                    return email ? <a href={`mailto:${email}`}>{email}</a> : "Not linked";
                  },
                  sortValue: (candidate) =>
                    roster.memberships.find(({ profileId }) => profileId === candidate.id)?.email ??
                    "",
                },
                {
                  header: "Voice part",
                  id: "voicePart",
                  render: (candidate) => candidate.voicePart || "Not assigned",
                  sortValue: (candidate) => candidate.voicePart,
                },
                {
                  header: "Status",
                  id: "status",
                  render: (candidate) => (
                    <span className="status-pill">{statusLabel(candidate.globalStatus)}</span>
                  ),
                  sortValue: (candidate) => statusLabel(candidate.globalStatus),
                },
                {
                  header: "Directory",
                  id: "directory",
                  render: (candidate) => (candidate.showInDirectory ? "Shown" : "Hidden"),
                  sortValue: (candidate) => candidate.showInDirectory,
                },
                {
                  header: "Actions",
                  id: "actions",
                  mobileLabel: "Manage",
                  render: (candidate) => (
                    <button
                      className="text-button"
                      onClick={() => {
                        openEdit(candidate);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  ),
                },
              ]}
              emptyMessage={query ? "No Profiles match your search." : "No Profiles yet."}
              initialSort={{ columnId: "name", direction: "asc" }}
              keySelector={(candidate) => candidate.id}
              onRowClick={openEdit}
              rowLabel={(candidate) => `Edit profile ${candidate.displayName}`}
              rows={filteredProfiles}
            />
          </>
        ) : null}
      </div>

      <Dialog
        description="Profile details and roster attributes belong only to this Organization."
        onClose={closeDialog}
        open={dialogOpen}
        title={editingId ? "Edit Profile" : "Add Profile"}
      >
        {editingId ? (
          <div className="roster-profile-tabs" role="tablist" aria-label="Profile sections">
            <button
              aria-selected={profileTab === "info"}
              className={profileTab === "info" ? "is-active" : ""}
              onClick={() => {
                setProfileTab("info");
              }}
              role="tab"
              type="button"
            >
              Profile Info
            </button>
            <button
              aria-selected={profileTab === "performance"}
              className={profileTab === "performance" ? "is-active" : ""}
              onClick={() => {
                setPerformanceHistory({ status: "loading" });
                setProfileTab("performance");
              }}
              role="tab"
              type="button"
            >
              Performance RSVPs
            </button>
            <button
              aria-selected={profileTab === "dues"}
              className={profileTab === "dues" ? "is-active" : ""}
              onClick={() => {
                setProfileDues({ status: "loading" });
                setProfileTab("dues");
              }}
              role="tab"
              type="button"
            >
              Dues
            </button>
            <button
              aria-selected={profileTab === "folders"}
              className={profileTab === "folders" ? "is-active" : ""}
              onClick={() => {
                setProfileFolderNumbers({ status: "loading" });
                setProfileTab("folders");
              }}
              role="tab"
              type="button"
            >
              Folder numbers
            </button>
          </div>
        ) : null}
        {editingId && profileTab === "performance" ? (
          <PerformanceHistory
            onRsvpChanged={(updated) => {
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
        ) : editingId && profileTab === "folders" ? (
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
        ) : editingId && profileTab === "dues" ? (
          <ProfileDues
            onCashPaymentMarked={(record) => {
              setProfileDues((current) => {
                if (current.status !== "ready") return current;
                const existing = current.dues.some((candidate) => candidate.id === record.id);
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
        ) : (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProfile();
            }}
          >
            {error ? (
              <p className="notice notice--error" role="alert">
                {error}
              </p>
            ) : null}
            {editingId ? (
              <ProfilePhotoEditor
                onChanged={(fileId) => {
                  setProfilePhotoFileId(fileId);
                  setRoster((current) =>
                    current.status === "ready"
                      ? {
                          ...current,
                          profiles: current.profiles.map((candidate) =>
                            candidate.id === editingId
                              ? { ...candidate, photoFileId: fileId }
                              : candidate,
                          ),
                        }
                      : current,
                  );
                }}
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
                autoFocus
                id="roster-profile-name"
                maxLength={200}
                onChange={(event) => {
                  setProfile((current) => ({ ...current, displayName: event.target.value }));
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
              <label htmlFor="roster-profile-email">Email address</label>
              <input
                id="roster-profile-email"
                onChange={(event) => {
                  setProfileEmail(event.target.value);
                }}
                placeholder={`Enter an email to invite this ${performerLabel.toLowerCase()}`}
                readOnly={Boolean(editingId && profileEmail)}
                type="email"
                value={profileEmail}
              />
              <p className="field-help">
                Linked account emails are managed through Membership invitations.
              </p>
              {editingId && profileEmail ? (
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
            <div className="field">
              <label htmlFor="roster-profile-voice-part">Voice part</label>
              <select
                id="roster-profile-voice-part"
                onChange={(event) => {
                  setProfile((current) => ({ ...current, voicePart: event.target.value }));
                }}
                value={profile.voicePart}
              >
                <option value="">No voice part</option>
                {roster.status === "ready"
                  ? roster.configuration.voiceParts.map(({ fullName, label }) => (
                      <option key={label} value={label}>
                        {fullName} ({label})
                      </option>
                    ))
                  : null}
              </select>
            </div>
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
                Selecting a status does not turn automation off. The Profile may be updated by the
                roster rules until you explicitly manage status manually.
              </p>
            </div>
            <label className="checkbox-row">
              <input
                checked={profile.statusIsManual}
                onChange={(event) => {
                  setProfile((current) => ({ ...current, statusIsManual: event.target.checked }));
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
            <label className="checkbox-row">
              <input
                checked={profile.showInDirectory}
                onChange={(event) => {
                  setProfile((current) => ({ ...current, showInDirectory: event.target.checked }));
                }}
                type="checkbox"
              />
              Show in directory
            </label>
            <label className="checkbox-row">
              <input
                checked={profile.isSectionLeader}
                onChange={(event) => {
                  setProfile((current) => ({ ...current, isSectionLeader: event.target.checked }));
                }}
                type="checkbox"
              />
              Section leader
            </label>
            <label className="checkbox-row">
              <input
                checked={profile.doNotEmail}
                onChange={(event) => {
                  setProfile((current) => ({ ...current, doNotEmail: event.target.checked }));
                }}
                type="checkbox"
              />
              Do not email
            </label>
            <label className="checkbox-row">
              <input
                checked={profile.receiveAdminNotifications}
                onChange={(event) => {
                  setProfile((current) => ({
                    ...current,
                    receiveAdminNotifications: event.target.checked,
                  }));
                }}
                type="checkbox"
              />
              Receive administrator notifications, including audition emails
            </label>
            <div className="dialog__actions">
              <button className="button button--secondary" onClick={closeDialog} type="button">
                Cancel
              </button>
              <button className="button button--primary" disabled={busy} type="submit">
                {busy ? "Saving…" : editingId ? "Save Profile" : "Create Profile"}
              </button>
            </div>
          </form>
        )}
      </Dialog>
      <CsvImportDialog
        busy={busy || rosterImportInspecting}
        columnMappings={rosterImportMappings.map((mapping) => ({
          ...mapping,
          header: rosterImportHeaders[mapping.sourceIndex] ?? "",
        }))}
        confirmed={rosterImportConfirmed}
        description="Add Profiles from the established roster CSV format."
        error={error}
        file={importFile}
        helpText="Profiles are created without login access. CSV email addresses are counted as invitation candidates; send Membership invitations separately when ready."
        invalid={Boolean(rosterImportInspection?.fatalError)}
        mappingOptions={rosterCsvColumnOptions.map((value) => ({
          label: value,
          required: value === "Name",
          value,
        }))}
        onClose={closeImportDialog}
        onConfirmationChange={setRosterImportConfirmed}
        onFileChange={handleRosterImportFile}
        onImport={() => {
          void importRoster();
        }}
        onMapColumn={handleRosterColumnMap}
        open={importDialogOpen}
        title="Import roster CSV"
      />
    </>
  );
}
