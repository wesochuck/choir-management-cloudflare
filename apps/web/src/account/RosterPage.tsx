import type {
  OrganizationMembershipSummary,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { organizationInvitationRequestSchema } from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useMemo, useState } from "react";

import {
  AuthApiError,
  createOrganizationProfile,
  createOrganizationInvitation,
  getOrganizationRosterConfiguration,
  importOrganizationProfilesCsv,
  listOrganizationMemberships,
  listOrganizationProfiles,
  requestPasswordReset,
  updateOrganizationProfile,
} from "../auth/api";
import { CsvImportDialog } from "./CsvImportDialog";

const emptyProfile: OrganizationProfileRequest = {
  displayName: "",
  doNotEmail: false,
  globalStatus: "Active",
  isSectionLeader: false,
  notes: "",
  phone: "",
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  voicePart: "",
};

type RosterState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly configuration: OrganizationRosterConfiguration;
      readonly memberships: readonly OrganizationMembershipSummary[];
      readonly profiles: readonly OrganizationProfile[];
      readonly status: "ready";
    };

function profileRequestFrom(profile: OrganizationProfile): OrganizationProfileRequest {
  return {
    displayName: profile.displayName,
    doNotEmail: profile.doNotEmail,
    globalStatus: profile.globalStatus,
    isSectionLeader: profile.isSectionLeader,
    notes: profile.notes,
    phone: profile.phone,
    receiveAdminNotifications: profile.receiveAdminNotifications,
    receiveAttendanceReports: profile.receiveAttendanceReports,
    receiveFinancialAlerts: profile.receiveFinancialAlerts,
    receiveRsvpDeclineNotices: profile.receiveRsvpDeclineNotices,
    showInDirectory: profile.showInDirectory,
    voicePart: profile.voicePart,
  };
}

function statusLabel(status: OrganizationProfile["globalStatus"]): string {
  return status === "Idle" ? "On Break" : status;
}

export function RosterPage({ enabled }: { readonly enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [profile, setProfile] = useState<OrganizationProfileRequest>(emptyProfile);
  const [profileEmail, setProfileEmail] = useState("");
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [resettingProfileId, setResettingProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<RosterState>({ status: "loading" });
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationProfiles(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationMemberships(controller.signal),
    ])
      .then(([profiles, configuration, membershipResult]) => {
        setRoster({
          configuration,
          memberships: membershipResult.memberships,
          profiles,
          status: "ready",
        });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setRoster({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const filteredProfiles = useMemo(() => {
    if (roster.status !== "ready") return [];
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? roster.profiles.filter((candidate) =>
          [
            candidate.displayName,
            candidate.phone,
            candidate.voicePart,
            roster.memberships.find(({ profileId }) => profileId === candidate.id)?.email ?? "",
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalized),
        )
      : roster.profiles;
  }, [query, roster]);

  function closeDialog() {
    if (busy) return;
    setDialogOpen(false);
    setEditingId(null);
    setProfile(emptyProfile);
    setProfileEmail("");
    setResetFeedback(null);
    setError(null);
  }

  function closeImportDialog() {
    if (busy) return;
    setImportDialogOpen(false);
    setImportFile(null);
  }

  function openCreate() {
    setEditingId(null);
    setProfile(emptyProfile);
    setProfileEmail("");
    setResetFeedback(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  function openEdit(candidate: OrganizationProfile) {
    setEditingId(candidate.id);
    setProfile(profileRequestFrom(candidate));
    setProfileEmail(
      roster.status === "ready"
        ? (roster.memberships.find(({ profileId }) => profileId === candidate.id)?.email ?? "")
        : "",
    );
    setResetFeedback(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  async function saveProfile() {
    const normalizedEmail = profileEmail.trim().toLowerCase();
    const linkedEmail =
      editingId && roster.status === "ready"
        ? (roster.memberships.find(({ profileId }) => profileId === editingId)?.email ?? "")
        : "";
    if (normalizedEmail && normalizedEmail !== linkedEmail) {
      const parsedInvitation = organizationInvitationRequestSchema.safeParse({
        email: normalizedEmail,
        role: "member",
      });
      if (!parsedInvitation.success) {
        setError("Enter a valid email address.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const saved = editingId
        ? await updateOrganizationProfile(editingId, profile)
        : await createOrganizationProfile(profile);
      let invitationNote = "";
      if (normalizedEmail && normalizedEmail !== linkedEmail) {
        try {
          await createOrganizationInvitation({ email: normalizedEmail, role: "member" });
          invitationNote = ` A membership invitation was sent to ${normalizedEmail}.`;
        } catch {
          invitationNote =
            " The Profile was saved, but the membership invitation could not be created.";
        }
      }
      setRoster((current) =>
        current.status === "ready"
          ? {
              ...current,
              profiles: editingId
                ? current.profiles.map((candidate) =>
                    candidate.id === saved.id ? saved : candidate,
                  )
                : [...current.profiles, saved].toSorted((left, right) =>
                    left.displayName.localeCompare(right.displayName),
                  ),
            }
          : current,
      );
      setSuccess(`${editingId ? "Profile updated." : "Profile created."}${invitationNote}`);
      setDialogOpen(false);
      setEditingId(null);
      setProfile(emptyProfile);
      setProfileEmail("");
      setResetFeedback(null);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : `The Profile could not be ${editingId ? "updated" : "created"}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    if (!editingId || !profileEmail) return;
    setResettingProfileId(editingId);
    setResetFeedback(null);
    try {
      await requestPasswordReset(profileEmail);
      setResetFeedback(`Password reset email sent to ${profileEmail}.`);
    } catch {
      setResetFeedback("The password reset email could not be sent. Try again.");
    } finally {
      setResettingProfileId(null);
    }
  }

  async function importRoster() {
    if (!importFile) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await importOrganizationProfilesCsv(await importFile.text());
      const profiles = await listOrganizationProfiles();
      setRoster((current) => (current.status === "ready" ? { ...current, profiles } : current));
      setImportFile(null);
      setImportDialogOpen(false);
      setSuccess(
        `${String(result.imported)} Profile(s) imported. ${String(result.invitationCandidates)} email address(es) are ready for Membership invitations.`,
      );
    } catch (importError: unknown) {
      setError(
        importError instanceof AuthApiError
          ? importError.message
          : "The roster CSV could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <p className="notice notice--warning">Verify Organization MFA to manage the roster.</p>;
  }

  return (
    <>
      <div className="page-toolbar">
        <label className="search-field">
          <span className="sr-only">Search Profiles</span>
          <input
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search Profiles"
            type="search"
            value={query}
          />
        </label>
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

      <Dialog
        description="Profile details and roster attributes belong only to this Organization."
        onClose={closeDialog}
        open={dialogOpen}
        title={editingId ? "Edit Profile" : "Add Profile"}
      >
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
              placeholder="Enter an email to invite this singer"
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
          </div>
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
          <div className="dialog__actions">
            <button className="button button--secondary" onClick={closeDialog} type="button">
              Cancel
            </button>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Saving…" : editingId ? "Save Profile" : "Create Profile"}
            </button>
          </div>
        </form>
      </Dialog>
      <CsvImportDialog
        busy={busy}
        description="Add Profiles from the established roster CSV format."
        error={error}
        file={importFile}
        helpText="Profiles are created without login access. CSV email addresses are counted as invitation candidates; send Membership invitations separately when ready."
        onClose={closeImportDialog}
        onFileChange={setImportFile}
        onImport={() => {
          void importRoster();
        }}
        open={importDialogOpen}
        title="Import roster CSV"
      />
    </>
  );
}
