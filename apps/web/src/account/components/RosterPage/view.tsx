import type { OrganizationProfile } from "@choir/contracts";
import {
  getDirectoryListingReason,
  isProfileDirectoryListed,
  rosterCsvColumnOptions,
} from "@choir/domain";
import {
  DataTable,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  useConfirmation,
} from "@choir/ui";
import { VoicePartBalance } from "./shared";
import { parseRosterStatusFilter, statusLabel } from "./utils";
import { ProfileEditorDialog } from "../ProfileEditor";
import { ProfileAvatarButton } from "../ProfileAvatarButton";
import { ProfilePhotoViewerDialog } from "../ProfilePhotoViewerDialog";
import { RosterInviteLinksDialog } from "./RosterInviteLinksDialog";
import { CsvImportDialog } from "../../CsvImportDialog";
import { RosterAutomationSettings } from "../../RosterAutomationSettings";
import { RosterConfiguration } from "../../RosterConfiguration";
import { OrganizationMfaPrompt } from "../../OrganizationMfaPrompt";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { RosterConfigurationDraftProvider } from "../../RosterConfigurationDraftProvider";
import { ResolveDuplicateDialog } from "../../ResolveDuplicateDialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { startOrganizationImpersonation } from "../../../api";
import type { RosterPageModel } from "./hooks";

type RosterSection = "roster" | "settings" | "automation";

// eslint-disable-next-line complexity -- render composition preserves the existing screen's independent states and dialogs.
export function RosterPageView({
  initialSection = "roster",
  model,
}: {
  readonly initialSection?: RosterSection;
  readonly model: RosterPageModel;
}) {
  const { partLabel } = useOrganizationTerminology();
  const [activeTab, setActiveTab] = useState<RosterSection>(initialSection);
  const [inviteLinksDialogOpen, setInviteLinksDialogOpen] = useState(false);
  const [resolveDuplicateOpen, setResolveDuplicateOpen] = useState(false);
  const [viewerPhoto, setViewerPhoto] = useState<{ displayName: string; src: string } | null>(null);
  const {
    busy,
    bulkBusy,
    bulkUpdateProfiles,
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
    onPhotoPendingChange,
    onRegisterPhotoSave,
    openCreate,
    openEdit,
    performanceHistory,
    profile,
    profileDeliveries,
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
    selectedProfileIds,
    selectedVoiceFilters,
    sendPasswordReset,
    setError,
    setImportDialogOpen,
    setPerformanceHistory,
    setProfile,
    setProfileDues,
    setProfileEmail,
    setProfileDeliveries,
    setProfileFolderNumbers,
    setProfilePhotoFileId,
    setProfileTab,
    setQuery,
    setRoster,
    setRosterImportConfirmed,
    setShowHidden,
    setStatusFilter,
    setSuccess,
    showHidden,
    statusFilter,
    success,
    toggleProfileSelection,
    toggleVisibleProfileSelection,
    toggleVoiceFilter,
  } = model;
  const membershipByProfileId = useMemo<Map<string, { readonly email: string }>>(() => {
    if (roster.status !== "ready") return new Map();
    return new Map(
      roster.memberships.map((membership) => [membership.profileId, { email: membership.email }]),
    );
  }, [roster]);
  const linkedMembership = useMemo(() => {
    if (roster.status !== "ready" || !editingId) return undefined;
    return roster.memberships.find((membership) => membership.profileId === editingId);
  }, [editingId, roster]);
  const isEditingAdmin = useMemo(() => {
    if (roster.status !== "ready" || !editingId) return false;
    return roster.memberships.some(
      (membership) =>
        membership.profileId === editingId &&
        (membership.role === "administrator" || membership.role === "owner"),
    );
  }, [editingId, roster]);

  const { confirm, confirmationDialog } = useConfirmation();

  async function handleArchiveProfile(candidate: OrganizationProfile) {
    const confirmed = await confirm({
      confirmLabel: "Archive Profile",
      description: `Archiving hides ${candidate.displayName} from the active roster while preserving all historical attendance, dues, folder assignments, and voting records. You can restore archived profiles at any time.`,
      destructive: true,
      title: `Archive ${candidate.displayName}?`,
    });
    if (confirmed) {
      await model.archiveProfile(candidate.id);
    }
  }

  async function handleDeleteProfile(candidate: OrganizationProfile) {
    const confirmed = await confirm({
      confirmLabel: "Delete permanently",
      description: `Are you sure you want to permanently delete ${candidate.displayName}? This cannot be undone and is only allowed for profiles with zero event attendance, dues, folder assignments, or active memberships. If records exist, the profile must be archived instead.`,
      destructive: true,
      title: `Permanently delete ${candidate.displayName}?`,
    });
    if (confirmed) {
      await model.deleteProfilePermanently(candidate.id);
    }
  }

  const selectAllVisibleRef = useRef<HTMLInputElement>(null);
  const [rosterPage, setRosterPage] = useState(1);
  const [rosterPageSize, setRosterPageSize] = useState(50);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset page on filter change
    setRosterPage(1);
  }, [filteredProfiles.length, query, selectedVoiceFilters, showHidden, statusFilter]);

  const visibleProfileIds = filteredProfiles.map((candidate) => candidate.id);
  const selectedVisibleCount = visibleProfileIds.filter((profileId) =>
    selectedProfileIds.includes(profileId),
  ).length;
  const allVisibleSelected =
    visibleProfileIds.length > 0 && selectedVisibleCount === visibleProfileIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  useEffect(() => {
    if (selectAllVisibleRef.current) {
      selectAllVisibleRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);
  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage the roster." />;
  }
  return (
    <RosterConfigurationDraftProvider enabled={enabled}>
      <Tabs onValueChange={setActiveTab} value={activeTab}>
        <TabsList aria-label="Roster sections" as="nav" className="ticketing-tabs roster-page-tabs">
          <TabsTrigger
            aria-controls="roster-directory-panel"
            id="roster-directory-tab"
            value="roster"
          >
            Roster
          </TabsTrigger>
          <TabsTrigger
            aria-controls="roster-settings-panel"
            id="roster-settings-tab"
            value="settings"
          >
            Settings
          </TabsTrigger>
          <TabsTrigger
            aria-controls="roster-automation-panel"
            id="roster-automation-tab"
            value="automation"
          >
            Roster automation
          </TabsTrigger>
        </TabsList>
        <TabsContent
          aria-labelledby="roster-settings-tab"
          id="roster-settings-panel"
          value="settings"
        >
          <RosterConfiguration enabled={enabled} />
        </TabsContent>
        <TabsContent
          aria-labelledby="roster-automation-tab"
          id="roster-automation-panel"
          value="automation"
        >
          <RosterAutomationSettings enabled={enabled} />
        </TabsContent>
        <TabsContent
          aria-labelledby="roster-directory-tab"
          id="roster-directory-panel"
          value="roster"
        >
          <div className="page-toolbar">
            <div className="page-toolbar__actions">
              <a
                className="button button--secondary"
                download
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
              <button
                className="button button--secondary"
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  setInviteLinksDialogOpen(true);
                }}
                type="button"
              >
                Invite by link
              </button>
              <button className="button button--primary" onClick={openCreate} type="button">
                Add Profile
              </button>
            </div>
          </div>

          {error && !dialogOpen && !importDialogOpen && !inviteLinksDialogOpen ? (
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
                partLabel={partLabel}
                profiles={showHidden ? roster.profiles : roster.profiles.filter((p) => !p.hidden)}
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
                <label className="checkbox-row roster-filter-row__hidden">
                  <input
                    checked={showHidden}
                    onChange={(event) => {
                      setShowHidden(event.target.checked);
                    }}
                    type="checkbox"
                  />
                  Include off-roster profiles
                </label>
                {query ||
                selectedVoiceFilters.length > 0 ||
                statusFilter !== "all" ||
                showHidden ? (
                  <button
                    className="button button--secondary button--control-height"
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
              {selectedVisibleCount > 0 ? (
                <div
                  className="roster-bulk-actions"
                  aria-label="Bulk profile actions"
                  role="region"
                >
                  <div>
                    <strong>{selectedVisibleCount} selected</strong>
                    <p>
                      Status actions take manual control. Directory actions only change visibility.
                    </p>
                  </div>
                  <div className="roster-bulk-actions__buttons">
                    <button
                      className="button button--secondary"
                      disabled={bulkBusy}
                      onClick={() => {
                        void bulkUpdateProfiles({ kind: "status", value: "Active" });
                      }}
                      type="button"
                    >
                      {bulkBusy ? "Updating…" : "Set active"}
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={bulkBusy}
                      onClick={() => {
                        void bulkUpdateProfiles({ kind: "status", value: "Idle" });
                      }}
                      type="button"
                    >
                      Set On Break
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={bulkBusy}
                      onClick={() => {
                        void bulkUpdateProfiles({ kind: "status", value: "Inactive" });
                      }}
                      type="button"
                    >
                      Set inactive
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={bulkBusy}
                      onClick={() => {
                        void bulkUpdateProfiles({ kind: "directory", value: true });
                      }}
                      type="button"
                    >
                      List in directory
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={bulkBusy}
                      onClick={() => {
                        void bulkUpdateProfiles({ kind: "directory", value: false });
                      }}
                      type="button"
                    >
                      Remove from directory
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={bulkBusy}
                      onClick={() => {
                        void bulkUpdateProfiles({ kind: "hidden", value: true });
                      }}
                      type="button"
                    >
                      Exclude from roster
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={bulkBusy}
                      onClick={() => {
                        void bulkUpdateProfiles({ kind: "hidden", value: false });
                      }}
                      type="button"
                    >
                      Return to roster
                    </button>
                  </div>
                </div>
              ) : null}
              <DataTable
                columns={[
                  {
                    header: "Select",
                    headerContent: (
                      <input
                        aria-label="Select all matching profiles"
                        checked={allVisibleSelected}
                        disabled={visibleProfileIds.length === 0 || bulkBusy}
                        onChange={(event) => {
                          toggleVisibleProfileSelection(visibleProfileIds, event.target.checked);
                        }}
                        ref={selectAllVisibleRef}
                        type="checkbox"
                      />
                    ),
                    id: "selection",
                    mobileLabel: "Select",
                    render: (candidate) => (
                      <input
                        aria-label={`Select ${candidate.displayName}`}
                        checked={selectedProfileIds.includes(candidate.id)}
                        disabled={bulkBusy}
                        onChange={(event) => {
                          toggleProfileSelection(candidate.id, event.target.checked);
                        }}
                        type="checkbox"
                      />
                    ),
                  },
                  {
                    header: "Name",
                    id: "name",
                    render: (candidate) => (
                      <span className="roster-profile-name">
                        <ProfileAvatarButton
                          displayName={candidate.displayName}
                          onOpenViewer={(src) => {
                            setViewerPhoto({ displayName: candidate.displayName, src });
                          }}
                          photoFileId={candidate.photoFileId}
                          size={32}
                        />
                        <strong>{candidate.displayName}</strong>
                        {candidate.isSectionLeader ? (
                          <Tooltip content="Section leader">
                            <span
                              className="roster-section-leader"
                              role="img"
                              aria-label="Section leader"
                              tabIndex={0}
                            >
                              ★
                            </span>
                          </Tooltip>
                        ) : null}
                      </span>
                    ),
                    sortValue: (candidate) => candidate.displayName,
                  },
                  {
                    header: "Email address",
                    id: "email",
                    render: (candidate) => {
                      const email = membershipByProfileId.get(candidate.id)?.email;
                      return email ? <a href={`mailto:${email}`}>{email}</a> : "Not linked";
                    },
                    sortValue: (candidate) => membershipByProfileId.get(candidate.id)?.email ?? "",
                  },
                  {
                    header: partLabel,
                    id: "voicePart",
                    render: (candidate) => candidate.voicePart || "Not assigned",
                    sortValue: (candidate) => candidate.voicePart,
                  },
                  {
                    header: "Status",
                    id: "status",
                    render: (candidate) => (
                      <span className="status-pill-group">
                        <span className="status-pill">{statusLabel(candidate.globalStatus)}</span>
                        {candidate.hidden ? (
                          <span className="status-pill status-pill--hidden">Off roster</span>
                        ) : null}
                      </span>
                    ),
                    sortValue: (candidate) =>
                      `${candidate.hidden ? "1" : "0"}-${statusLabel(candidate.globalStatus)}`,
                  },
                  {
                    header: "Delivery status",
                    id: "delivery",
                    render: (candidate) => {
                      if (candidate.providerEmailSuppressed) {
                        return (
                          <span
                            className="status-pill status-pill--suppressed"
                            title="Provider suppression is active. Contact a Platform Administrator to release local provider suppression after the address issue is resolved."
                          >
                            Suppressed
                          </span>
                        );
                      }
                      if (candidate.doNotEmail) {
                        return (
                          <span
                            className="status-pill status-pill--warning"
                            title={`Email delivery disabled${candidate.bounceReason ? `: ${candidate.bounceReason}` : ""}`}
                          >
                            Blocked
                          </span>
                        );
                      }
                      return <span className="status-pill status-pill--success">Allowed</span>;
                    },
                    sortValue: (candidate) =>
                      candidate.providerEmailSuppressed
                        ? "Suppressed"
                        : candidate.doNotEmail
                          ? "Blocked"
                          : "Allowed",
                  },
                  {
                    header: "Directory listing",
                    id: "directory",
                    render: (candidate) => {
                      const listed = isProfileDirectoryListed(candidate);
                      const reason = getDirectoryListingReason(candidate);
                      return (
                        <span
                          className={`status-pill ${listed ? "status-pill--success" : "status-pill--neutral"}`}
                          title={reason ?? undefined}
                        >
                          {listed ? "Listed" : "Not listed"}
                        </span>
                      );
                    },
                    sortValue: (candidate) => (isProfileDirectoryListed(candidate) ? 1 : 0),
                  },
                  {
                    header: "Actions",
                    id: "actions",
                    mobileLabel: "Manage",
                    render: (candidate) => {
                      const isCandidateAdmin = roster.memberships.some(
                        (membership) =>
                          membership.profileId === candidate.id &&
                          (membership.role === "administrator" || membership.role === "owner"),
                      );
                      return (
                        <div className="table-actions">
                          <button
                            className="button button--secondary button--small"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEdit(candidate);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                          {!isCandidateAdmin ? (
                            <button
                              className="button button--secondary button--small"
                              onClick={(event) => {
                                event.stopPropagation();
                                void (async () => {
                                  try {
                                    await startOrganizationImpersonation(candidate.id);
                                    window.location.href = "/dashboard";
                                  } catch (err: unknown) {
                                    setError(
                                      err instanceof Error
                                        ? err.message
                                        : "Could not begin impersonation.",
                                    );
                                  }
                                })();
                              }}
                              aria-label={`Impersonate ${candidate.displayName}`}
                              title={`Impersonate ${candidate.displayName}`}
                              type="button"
                            >
                              Impersonate
                            </button>
                          ) : null}
                          {candidate.hidden ? (
                            candidate.globalStatus === "Inactive" ? (
                              <button
                                aria-label={`Restore ${candidate.displayName}`}
                                className="button button--secondary button--small"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void model.restoreProfile(candidate.id);
                                }}
                                title={`Restore ${candidate.displayName} as active`}
                                type="button"
                              >
                                Restore
                              </button>
                            ) : (
                              <button
                                aria-label={`Return ${candidate.displayName} to roster`}
                                className="button button--secondary button--small"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void model.returnProfileToRoster(candidate.id);
                                }}
                                title={`Return ${candidate.displayName} to roster`}
                                type="button"
                              >
                                Return to roster
                              </button>
                            )
                          ) : (
                            <button
                              aria-label={`Archive ${candidate.displayName}`}
                              className="button button--secondary button--small"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleArchiveProfile(candidate);
                              }}
                              title={`Archive ${candidate.displayName}`}
                              type="button"
                            >
                              Archive
                            </button>
                          )}
                          {!isCandidateAdmin ? (
                            <button
                              aria-label={`Delete ${candidate.displayName}`}
                              className="button button--danger button--small"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDeleteProfile(candidate);
                              }}
                              title={`Delete ${candidate.displayName}`}
                              type="button"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      );
                    },
                  },
                ]}
                emptyMessage={query ? "No profiles match your search" : "No profiles yet"}
                initialSort={{ columnId: "name", direction: "asc" }}
                keySelector={(candidate) => candidate.id}
                onRowClick={openEdit}
                pagination={{
                  onPageChange: setRosterPage,
                  onPageSizeChange: (nextSize) => {
                    setRosterPageSize(nextSize);
                    setRosterPage(1);
                  },
                  page: rosterPage,
                  pageSize: rosterPageSize,
                  pageSizeOptions: [25, 50, 100],
                }}
                rowLabel={(candidate) => `Edit profile ${candidate.displayName}`}
                rows={filteredProfiles}
              />
            </>
          ) : null}
        </TabsContent>
      </Tabs>

      <ProfileEditorDialog
        busy={busy}
        editingId={editingId}
        editingProfileRecord={editingProfileRecord}
        error={error}
        linkedMembership={linkedMembership}
        onArchive={
          editingId && editingProfileRecord
            ? () => {
                void handleArchiveProfile(editingProfileRecord);
              }
            : undefined
        }
        onClose={closeDialog}
        onDeletePermanently={
          editingId && editingProfileRecord && !isEditingAdmin
            ? () => {
                void handleDeleteProfile(editingProfileRecord);
              }
            : undefined
        }
        onImpersonate={() => {
          if (!editingId) return;
          void (async () => {
            try {
              await startOrganizationImpersonation(editingId);
              window.location.href = "/dashboard";
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : "Could not begin impersonation.");
            }
          })();
        }}
        onPhotoChanged={(fileId) => {
          setProfilePhotoFileId(fileId);
          setRoster((current) =>
            current.status === "ready"
              ? {
                  ...current,
                  profiles: current.profiles.map((candidate) =>
                    candidate.id === editingId ? { ...candidate, photoFileId: fileId } : candidate,
                  ),
                }
              : current,
          );
        }}
        onPhotoPendingChange={onPhotoPendingChange}
        onRegisterPhotoSave={onRegisterPhotoSave}
        onResolveDuplicate={() => {
          setResolveDuplicateOpen(true);
        }}
        onRestore={
          editingId
            ? () => {
                void model.restoreProfile(editingId);
              }
            : undefined
        }
        open={dialogOpen}
        performanceHistory={performanceHistory}
        profile={profile}
        profileDeliveries={profileDeliveries}
        profileDues={profileDues}
        profileEmail={profileEmail}
        profileFolderNumbers={profileFolderNumbers}
        profilePhotoFileId={profilePhotoFileId}
        profileStatusHistory={profileStatusHistory}
        profileTab={profileTab}
        resetFeedback={resetFeedback}
        resettingProfileId={resettingProfileId}
        rosterConfiguration={roster.status === "ready" ? roster.configuration : undefined}
        rosterMemberships={roster.status === "ready" ? roster.memberships : []}
        rosterReady={roster.status === "ready"}
        saveProfile={saveProfile}
        sendPasswordReset={sendPasswordReset}
        setPerformanceHistory={setPerformanceHistory}
        setProfile={setProfile}
        setProfileDeliveries={setProfileDeliveries}
        setProfileDues={setProfileDues}
        setProfileEmail={setProfileEmail}
        setProfileFolderNumbers={setProfileFolderNumbers}
        setProfilePhotoFileId={setProfilePhotoFileId}
        setProfileTab={setProfileTab}
      />
      {editingId && linkedMembership && roster.status === "ready" ? (
        <ResolveDuplicateDialog
          allProfiles={roster.profiles}
          linkedProfileIds={
            new Set(roster.memberships.flatMap((m) => (m.profileId ? [m.profileId] : [])))
          }
          membershipEmail={linkedMembership.email}
          membershipId={linkedMembership.id}
          membershipName={profile.displayName || linkedMembership.name}
          onClose={() => {
            setResolveDuplicateOpen(false);
          }}
          onReconciled={() => {
            setResolveDuplicateOpen(false);
            closeDialog();
            setSuccess("Duplicate Profile successfully resolved and merged.");
            void model.refreshRoster();
          }}
          open={resolveDuplicateOpen}
          sourceProfileId={editingId}
        />
      ) : null}
      <CsvImportDialog
        busy={busy || rosterImportInspecting}
        columnMappings={rosterImportMappings.map((mapping) => ({
          ...mapping,
          header: rosterImportHeaders[mapping.sourceIndex] ?? "",
        }))}
        confirmed={rosterImportConfirmed}
        description="Upload a CSV to add profiles to this roster."
        error={error}
        file={importFile}
        helpText="Profiles are created without login access. CSV email addresses will be counted as invitation candidates."
        invalid={Boolean(rosterImportInspection?.fatalError)}
        mappingOptions={rosterCsvColumnOptions.map((value) => ({
          label: value === "Voice Part" ? partLabel : value,
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
        title="Import roster"
      />
      <RosterInviteLinksDialog
        onClose={() => {
          setInviteLinksDialogOpen(false);
        }}
        open={inviteLinksDialogOpen}
      />
      <ProfilePhotoViewerDialog
        displayName={viewerPhoto?.displayName ?? ""}
        isOpen={viewerPhoto !== null}
        onClose={() => {
          setViewerPhoto(null);
        }}
        photoSrc={viewerPhoto?.src ?? null}
      />
      {confirmationDialog}
    </RosterConfigurationDraftProvider>
  );
}
