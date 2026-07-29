import type {
  OrganizationMembershipSummary,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { organizationInvitationRequestSchema } from "@choir/contracts";
import {
  inspectRosterCsv,
  mapRosterCsvColumns,
  rosterCsvColumnForHeader,
  rosterCsvColumnOptions,
  type CsvColumnMapping,
  type RosterCsvInspection,
} from "@choir/domain";
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
import { useOrganizationTerminology } from "./organizationTerminologyContext";

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

type RosterStatusFilter = "all" | OrganizationProfile["globalStatus"];

const UNASSIGNED_VOICE_FILTER = "unassigned";

function sectionFilterKey(code: string): string {
  return `section:${code}`;
}

function voicePartFilterKey(label: string): string {
  return `part:${label}`;
}

function reportableSections(
  configuration: OrganizationRosterConfiguration,
): readonly OrganizationRosterConfiguration["sections"][number][] {
  return configuration.sections.filter(({ trackOnly }) => !trackOnly);
}

function reportableVoiceParts(
  configuration: OrganizationRosterConfiguration,
): readonly OrganizationRosterConfiguration["voiceParts"][number][] {
  const trackOnlySections = new Set(
    configuration.sections.filter(({ trackOnly }) => trackOnly).map(({ code }) => code),
  );
  return configuration.voiceParts.filter(({ sectionCode }) => !trackOnlySections.has(sectionCode));
}

function profileSectionCode(
  profile: OrganizationProfile,
  configuration: OrganizationRosterConfiguration,
): string | null {
  return (
    configuration.voiceParts.find(({ label }) => label === profile.voicePart)?.sectionCode ?? null
  );
}

function profileMatchesVoiceFilters(
  profile: OrganizationProfile,
  configuration: OrganizationRosterConfiguration,
  filters: readonly string[],
): boolean {
  if (filters.length === 0) return true;
  const sectionCode = profileSectionCode(profile, configuration);
  const voicePart = configuration.voiceParts.find(({ label }) => label === profile.voicePart);
  if (
    voicePart &&
    configuration.sections.some(
      ({ code, trackOnly }) => code === voicePart.sectionCode && trackOnly,
    )
  ) {
    return false;
  }
  return filters.some((filter) =>
    filter === UNASSIGNED_VOICE_FILTER
      ? !profile.voicePart
      : filter === voicePartFilterKey(profile.voicePart) ||
        filter === sectionFilterKey(sectionCode ?? ""),
  );
}

function VoicePartBalance({
  configuration,
  profiles,
  selectedFilters,
  onToggle,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onToggle: (filter: string) => void;
  readonly profiles: readonly OrganizationProfile[];
  readonly selectedFilters: readonly string[];
}) {
  const counts = useMemo(() => {
    const sectionsForReporting = reportableSections(configuration);
    const voicePartsForReporting = reportableVoiceParts(configuration);
    const sections = new Map(sectionsForReporting.map(({ code }) => [code, 0]));
    const voiceParts = new Map(voicePartsForReporting.map(({ label }) => [label, 0]));
    const reportableLabels = new Set(voicePartsForReporting.map(({ label }) => label));
    let unassigned = 0;
    profiles.forEach((profile) => {
      if (!profile.voicePart) {
        unassigned += 1;
        return;
      }
      if (!reportableLabels.has(profile.voicePart)) return;
      voiceParts.set(profile.voicePart, (voiceParts.get(profile.voicePart) ?? 0) + 1);
      const sectionCode = profileSectionCode(profile, configuration);
      if (sectionCode) sections.set(sectionCode, (sections.get(sectionCode) ?? 0) + 1);
    });
    return { sections, unassigned, voiceParts };
  }, [configuration, profiles]);

  return (
    <section className="surface-card roster-balance" aria-labelledby="roster-balance-title">
      <div className="roster-balance__header">
        <div>
          <p className="eyebrow">Roster overview</p>
          <h2 id="roster-balance-title">Voice part balance</h2>
          <p className="field-help">Select a section or voice part to filter the roster below.</p>
        </div>
        <span className="status-pill">{profiles.length} profiles</span>
      </div>
      <div className="roster-balance__sections">
        {reportableSections(configuration).map((section) => {
          const filter = sectionFilterKey(section.code);
          const selected = selectedFilters.includes(filter);
          return (
            <button
              aria-pressed={selected}
              className={`roster-balance__section${selected ? " roster-balance__section--selected" : ""}`}
              key={section.code}
              onClick={() => {
                onToggle(filter);
              }}
              type="button"
            >
              <span>{section.name}</span>
              <strong>{counts.sections.get(section.code) ?? 0}</strong>
            </button>
          );
        })}
      </div>
      <div className="roster-balance__parts">
        {reportableVoiceParts(configuration).map((voicePart) => {
          const filter = voicePartFilterKey(voicePart.label);
          const selected = selectedFilters.includes(filter);
          return (
            <button
              aria-pressed={selected}
              className={`roster-balance__part${selected ? " roster-balance__part--selected" : ""}`}
              key={voicePart.label}
              onClick={() => {
                onToggle(filter);
              }}
              type="button"
            >
              <span>{voicePart.label}</span>
              <strong>{counts.voiceParts.get(voicePart.label) ?? 0}</strong>
            </button>
          );
        })}
        {counts.unassigned > 0 ? (
          <button
            aria-pressed={selectedFilters.includes(UNASSIGNED_VOICE_FILTER)}
            className={`roster-balance__part${selectedFilters.includes(UNASSIGNED_VOICE_FILTER) ? " roster-balance__part--selected" : ""}`}
            onClick={() => {
              onToggle(UNASSIGNED_VOICE_FILTER);
            }}
            type="button"
          >
            <span>Unassigned</span>
            <strong>{counts.unassigned}</strong>
          </button>
        ) : null}
      </div>
    </section>
  );
}

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

function parseRosterStatusFilter(value: string): RosterStatusFilter {
  return value === "Active" || value === "Idle" || value === "Inactive" ? value : "all";
}

// eslint-disable-next-line complexity -- the roster page coordinates search, membership, dialogs, and profile actions.
export function RosterPage({ enabled }: { readonly enabled: boolean }) {
  const { performerLabel } = useOrganizationTerminology();
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [rosterImportCsv, setRosterImportCsv] = useState("");
  const [rosterImportHeaders, setRosterImportHeaders] = useState<readonly string[]>([]);
  const [rosterImportMappings, setRosterImportMappings] = useState<readonly CsvColumnMapping[]>([]);
  const [rosterImportInspection, setRosterImportInspection] = useState<RosterCsvInspection | null>(
    null,
  );
  const [rosterImportConfirmed, setRosterImportConfirmed] = useState(false);
  const [rosterImportInspecting, setRosterImportInspecting] = useState(false);
  const [profile, setProfile] = useState<OrganizationProfileRequest>(emptyProfile);
  const [profileEmail, setProfileEmail] = useState("");
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [resettingProfileId, setResettingProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<RosterState>({ status: "loading" });
  const [selectedVoiceFilters, setSelectedVoiceFilters] = useState<readonly string[]>([]);
  const [statusFilter, setStatusFilter] = useState<RosterStatusFilter>("all");
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
    return roster.profiles.filter((candidate) => {
      const matchesQuery =
        !normalized ||
        [
          candidate.displayName,
          candidate.phone,
          candidate.voicePart,
          roster.memberships.find(({ profileId }) => profileId === candidate.id)?.email ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized);
      const matchesStatus = statusFilter === "all" || candidate.globalStatus === statusFilter;
      return (
        matchesQuery &&
        matchesStatus &&
        profileMatchesVoiceFilters(candidate, roster.configuration, selectedVoiceFilters)
      );
    });
  }, [query, roster, selectedVoiceFilters, statusFilter]);

  function toggleVoiceFilter(filter: string): void {
    setSelectedVoiceFilters((current) =>
      current.includes(filter)
        ? current.filter((candidate) => candidate !== filter)
        : [...current, filter],
    );
  }

  function clearRosterFilters(): void {
    setQuery("");
    setSelectedVoiceFilters([]);
    setStatusFilter("all");
  }

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
    setRosterImportCsv("");
    setRosterImportHeaders([]);
    setRosterImportMappings([]);
    setRosterImportInspection(null);
    setRosterImportConfirmed(false);
    setRosterImportInspecting(false);
  }

  function handleRosterImportFile(file: File | null): void {
    setImportFile(file);
    setRosterImportCsv("");
    setRosterImportHeaders([]);
    setRosterImportMappings([]);
    setRosterImportInspection(null);
    setRosterImportConfirmed(false);
    setRosterImportInspecting(Boolean(file));
    setError(null);
    if (!file) return;
    void file
      .text()
      .then((csv) => {
        const initialInspection = inspectRosterCsv(csv);
        const mappings = initialInspection.headers.map((header, sourceIndex) => ({
          sourceIndex,
          targetHeader: rosterCsvColumnForHeader(header),
        }));
        setRosterImportCsv(csv);
        setRosterImportHeaders(initialInspection.headers);
        setRosterImportMappings(mappings);
        const inspection = inspectRosterCsv(mapRosterCsvColumns(csv, mappings));
        setRosterImportInspection(inspection);
        if (inspection.fatalError) setError(inspection.fatalError);
      })
      .catch(() => {
        setError("The CSV could not be read.");
      })
      .finally(() => {
        setRosterImportInspecting(false);
      });
  }

  function handleRosterColumnMap(sourceIndex: number, targetHeader: string | null): void {
    const nextMappings = rosterImportMappings.map((mapping) =>
      mapping.sourceIndex === sourceIndex ? { ...mapping, targetHeader } : mapping,
    );
    setRosterImportMappings(nextMappings);
    setRosterImportConfirmed(false);
    setRosterImportInspection(inspectRosterCsv(mapRosterCsvColumns(rosterImportCsv, nextMappings)));
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

  // eslint-disable-next-line complexity -- profile save coordinates linked membership and roster updates.
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
      const result = await importOrganizationProfilesCsv(
        mapRosterCsvColumns(await importFile.text(), rosterImportMappings),
      );
      const profiles = await listOrganizationProfiles();
      setRoster((current) => (current.status === "ready" ? { ...current, profiles } : current));
      setImportFile(null);
      setImportDialogOpen(false);
      setRosterImportCsv("");
      setRosterImportHeaders([]);
      setRosterImportMappings([]);
      setRosterImportInspection(null);
      setRosterImportConfirmed(false);
      setRosterImportInspecting(false);
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
