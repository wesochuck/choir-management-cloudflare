import type {
  DuesRecord,
  OrganizationMembershipSummary,
  OrganizationProfile,
  OrganizationProfileFolderNumber,
  OrganizationProfilePerformanceHistoryResponse,
  OrganizationProfileStatusHistoryResponse,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
  OrganizationRsvp,
  Season,
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
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AuthApiError,
  createOrganizationProfile,
  createOrganizationInvitation,
  getOrganizationRosterConfiguration,
  getOrganizationProfilePerformanceHistory,
  getOrganizationProfileStatusHistory,
  getOrganizationProfileFolderNumbers,
  importOrganizationProfilesCsv,
  listOrganizationDues,
  listOrganizationMemberships,
  listOrganizationProfiles,
  listOrganizationSeasons,
  markOrganizationDuesPaidInCash,
  requestPasswordReset,
  setOrganizationEventRsvp,
  updateOrganizationProfileFolderNumber,
  updateOrganizationProfile,
} from "../auth/api";
import { CsvImportDialog } from "./CsvImportDialog";
import { ProfilePhotoEditor } from "./MemberProfileDirectory";
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
  statusIsManual: false,
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
type ProfileTab = "dues" | "folders" | "info" | "performance";

type ProfileStatusHistoryState =
  | { readonly status: "error" | "idle" | "loading" }
  | { readonly data: OrganizationProfileStatusHistoryResponse; readonly status: "ready" };

const UNASSIGNED_VOICE_FILTER = "unassigned";

function sectionFilterKey(code: string): string {
  return `section:${code}`;
}

function formatProfileTransitionDate(value: string | null): string {
  if (!value) return "No automatic transition date is scheduled.";
  return `Scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}.`;
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
        <div className="roster-balance__meta">
          <span className="status-pill">{profiles.length} profiles</span>
          {counts.unassigned > 0 ? (
            <button
              aria-pressed={selectedFilters.includes(UNASSIGNED_VOICE_FILTER)}
              className={`roster-balance__unassigned${selectedFilters.includes(UNASSIGNED_VOICE_FILTER) ? " roster-balance__unassigned--selected" : ""}`}
              type="button"
              onClick={() => {
                onToggle(UNASSIGNED_VOICE_FILTER);
              }}
            >
              <span>Unassigned</span>
              <strong>{counts.unassigned}</strong>
            </button>
          ) : null}
        </div>
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
    statusIsManual: profile.statusIsManual,
    voicePart: profile.voicePart,
  };
}

function statusLabel(status: OrganizationProfile["globalStatus"]): string {
  return status === "Idle" ? "On Break" : status;
}

function parseRosterStatusFilter(value: string): RosterStatusFilter {
  return value === "Active" || value === "Idle" || value === "Inactive" ? value : "all";
}

type PerformanceHistoryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly data: OrganizationProfilePerformanceHistoryResponse;
      readonly status: "ready";
    };

type ProfileDuesState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly dues: readonly DuesRecord[];
      readonly seasons: readonly Season[];
      readonly status: "ready";
    };

type ProfileFolderNumbersState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly folderNumbers: readonly OrganizationProfileFolderNumber[];
      readonly status: "ready";
    };

function formatPerformanceDate(value: string): { readonly date: string; readonly time: string } {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "Date unavailable", time: "" };
  return {
    date: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      weekday: "short",
    }).format(parsed),
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed),
  };
}

function attendanceLabel(value: "Absent" | "Pending" | "Present"): string {
  return value === "Present" ? "Attended" : value;
}

type RsvpStatus = "No" | "Pending" | "Yes";

function parseRsvpStatus(value: string): RsvpStatus {
  return value === "Yes" || value === "No" ? value : "Pending";
}

function PerformanceHistory({
  onRsvpChanged,
  profileId,
  state,
}: {
  readonly onRsvpChanged: (rsvp: OrganizationRsvp) => void;
  readonly profileId: string;
  readonly state: PerformanceHistoryState;
}) {
  const [rsvpUpdateError, setRsvpUpdateError] = useState<string | null>(null);
  const [savingEventId, setSavingEventId] = useState<string | null>(null);

  async function updateRsvp(eventId: string, rsvp: RsvpStatus): Promise<void> {
    setSavingEventId(eventId);
    setRsvpUpdateError(null);
    try {
      const updated = await setOrganizationEventRsvp(eventId, profileId, rsvp);
      onRsvpChanged(updated);
    } catch (error: unknown) {
      setRsvpUpdateError(
        error instanceof AuthApiError
          ? error.message
          : "The performer's RSVP could not be updated.",
      );
    } finally {
      setSavingEventId(null);
    }
  }

  if (state.status === "loading") {
    return <p className="notice notice--info">Loading performance history…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Performance history could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;

  const sections = [
    { id: "upcoming", label: "Upcoming performances", rows: state.data.upcoming },
    { id: "past", label: "Past performances", rows: state.data.past },
  ] as const;
  return (
    <div className="profile-performance-history">
      {rsvpUpdateError ? (
        <p className="notice notice--error" role="alert">
          {rsvpUpdateError}
        </p>
      ) : null}
      {sections.map(({ id, label, rows }) => (
        <section aria-labelledby={`profile-performance-${id}`} key={id}>
          <div className="profile-performance-history__heading">
            <h3 id={`profile-performance-${id}`}>
              {label} ({rows.length})
            </h3>
          </div>
          {rows.length === 0 ? (
            <p className="profile-performance-history__empty">
              {id === "past" ? "No past performances yet." : "No upcoming performances."}
            </p>
          ) : (
            <div className="profile-performance-history__list">
              {rows.map((performance) => {
                const formatted = formatPerformanceDate(performance.startsAt);
                return (
                  <article className="profile-performance-card" key={performance.id}>
                    <div className="profile-performance-card__date">
                      <strong>{formatted.date}</strong>
                      <span>{formatted.time}</span>
                    </div>
                    <div className="profile-performance-card__event">
                      <strong>{performance.title}</strong>
                      <span>
                        {performance.venueName || performance.location || "Venue not listed"}
                      </span>
                    </div>
                    <div className="profile-performance-card__status">
                      <span className="profile-performance-card__label">Attended</span>
                      <span className="status-pill">{attendanceLabel(performance.attendance)}</span>
                    </div>
                    <div className="profile-performance-card__status">
                      <label
                        className="profile-performance-card__label"
                        htmlFor={`profile-rsvp-${performance.id}`}
                      >
                        RSVP
                      </label>
                      <select
                        aria-label={`RSVP for ${performance.title}`}
                        className="profile-performance-rsvp-select"
                        disabled={savingEventId !== null}
                        id={`profile-rsvp-${performance.id}`}
                        onChange={(event) => {
                          void updateRsvp(performance.id, parseRsvpStatus(event.target.value));
                        }}
                        value={performance.rsvp}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Yes">Yes (Attending)</option>
                        <option value="No">Declined</option>
                      </select>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function formatDuesAmount(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    currency: "USD",
    style: "currency",
  });
}

function ProfileFolderNumbers({
  onFolderNumberChanged,
  profileId,
  state,
}: {
  readonly onFolderNumberChanged: (folderNumber: OrganizationProfileFolderNumber) => void;
  readonly profileId: string;
  readonly state: ProfileFolderNumbersState;
}) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [returnedDrafts, setReturnedDrafts] = useState<Readonly<Record<string, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingEventId, setSavingEventId] = useState<string | null>(null);

  async function saveFolderNumber(folder: OrganizationProfileFolderNumber): Promise<void> {
    const folderNumber = (drafts[folder.eventId] ?? folder.folderNumber).trim();
    const folderReturned = returnedDrafts[folder.eventId] ?? folder.folderReturned;
    setSavingEventId(folder.eventId);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateOrganizationProfileFolderNumber(profileId, folder.eventId, {
        folderNumber,
        folderReturned,
      });
      onFolderNumberChanged(updated);
      setSuccess(`${folder.eventTitle} folder details saved.`);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : "The folder number could not be saved.",
      );
    } finally {
      setSavingEventId(null);
    }
  }

  if (state.status === "loading") {
    return <p className="notice notice--info">Loading folder numbers…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Folder numbers could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;
  if (state.folderNumbers.length === 0) {
    return <p className="profile-folder-numbers__empty">No events have been configured yet.</p>;
  }

  return (
    <div className="profile-folder-numbers">
      <div className="profile-folder-numbers__heading">
        <div>
          <p className="eyebrow">Music folders</p>
          <h3>Folder numbers by event</h3>
        </div>
        <span className="field-help">Folder details are stored separately for each event.</span>
      </div>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      <div className="profile-folder-numbers__list" role="list">
        {state.folderNumbers.map((folder) => {
          const formatted = formatPerformanceDate(folder.startsAt);
          const isSaving = savingEventId === folder.eventId;
          return (
            <div className="profile-folder-row" key={folder.eventId} role="listitem">
              <div className="profile-folder-row__event">
                <strong>{folder.eventTitle}</strong>
                <span>
                  {folder.eventType} · {formatted.date} {formatted.time}
                </span>
              </div>
              <label className="profile-folder-row__number">
                <span>Folder number</span>
                <input
                  maxLength={50}
                  onChange={(event) => {
                    setDrafts((current) => ({
                      ...current,
                      [folder.eventId]: event.target.value,
                    }));
                  }}
                  value={drafts[folder.eventId] ?? folder.folderNumber}
                />
              </label>
              <label className="checkbox-row profile-folder-row__returned">
                <input
                  checked={returnedDrafts[folder.eventId] ?? folder.folderReturned}
                  onChange={(event) => {
                    setReturnedDrafts((current) => ({
                      ...current,
                      [folder.eventId]: event.target.checked,
                    }));
                  }}
                  type="checkbox"
                />
                Folder returned
              </label>
              <div className="profile-folder-row__action">
                <button
                  className="button button--secondary button--small"
                  disabled={savingEventId !== null}
                  onClick={() => {
                    void saveFolderNumber(folder);
                  }}
                  type="button"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function duesStatusLabel(record: DuesRecord | undefined): string {
  if (!record) return "Not paid";
  if (record.status === "paid") {
    return record.paymentMethod === "cash" ? "Paid · Cash" : "Paid";
  }
  return record.status === "refunded" ? "Refunded" : "Pending";
}

function ProfileDues({
  onCashPaymentMarked,
  profileId,
  state,
}: {
  readonly onCashPaymentMarked: (record: DuesRecord) => void;
  readonly profileId: string;
  readonly state: ProfileDuesState;
}) {
  const [cashPaymentSeasonId, setCashPaymentSeasonId] = useState<string | null>(null);
  const [cashPaymentError, setCashPaymentError] = useState<string | null>(null);
  const [cashPaymentSuccess, setCashPaymentSuccess] = useState<string | null>(null);

  async function markCashPayment(season: Season, record: DuesRecord | undefined): Promise<void> {
    if (record?.status === "paid" || record?.status === "refunded") return;
    if (!window.confirm(`Mark ${season.name} dues as paid in cash?`)) return;
    setCashPaymentSeasonId(season.id);
    setCashPaymentError(null);
    setCashPaymentSuccess(null);
    try {
      const updated = await markOrganizationDuesPaidInCash(profileId, season.id);
      onCashPaymentMarked(updated);
      setCashPaymentSuccess(`${season.name} dues were marked as paid in cash.`);
    } catch (error: unknown) {
      setCashPaymentError(
        error instanceof AuthApiError
          ? error.message
          : "The cash dues payment could not be recorded.",
      );
    } finally {
      setCashPaymentSeasonId(null);
    }
  }

  if (state.status === "loading") {
    return <p className="notice notice--info">Loading dues history…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Dues history could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;
  if (state.seasons.length === 0) {
    return <p className="profile-dues-history__empty">No seasons have been configured yet.</p>;
  }

  return (
    <div className="profile-dues-history">
      <div className="profile-dues-history__heading">
        <div>
          <p className="eyebrow">Membership</p>
          <h3>Dues by season</h3>
        </div>
        <span className="field-help">
          Payment status comes from checkout records or an administrator&apos;s cash entry.
        </span>
      </div>
      {cashPaymentError ? (
        <p className="notice notice--error" role="alert">
          {cashPaymentError}
        </p>
      ) : null}
      {cashPaymentSuccess ? (
        <p className="notice notice--success" role="status">
          {cashPaymentSuccess}
        </p>
      ) : null}
      <div className="profile-dues-history__list" role="list">
        {state.seasons.map((season) => {
          const record = state.dues.find(({ seasonId }) => seasonId === season.id);
          return (
            <div className="profile-dues-row" key={season.id} role="listitem">
              <div className="profile-dues-row__season">
                <strong>{season.name}</strong>
                <span>
                  {new Date(season.startsAt).toLocaleDateString()} –{" "}
                  {new Date(season.endsAt).toLocaleDateString()}
                </span>
              </div>
              <div className="profile-dues-row__amount">
                <span className="profile-performance-card__label">Amount</span>
                <strong>{formatDuesAmount(record?.amountCents ?? season.duesAmountCents)}</strong>
              </div>
              <div className="profile-dues-row__status">
                <span className="profile-performance-card__label">Status</span>
                <span className="status-pill">{duesStatusLabel(record)}</span>
              </div>
              <div className="profile-dues-row__paid">
                <span className="profile-performance-card__label">Paid at</span>
                <span>{record?.paidAt ? new Date(record.paidAt).toLocaleDateString() : "—"}</span>
              </div>
              <div className="profile-dues-row__action">
                {!record || record.status === "pending" ? (
                  <button
                    className="button button--secondary button--small"
                    disabled={cashPaymentSeasonId !== null}
                    onClick={() => {
                      void markCashPayment(season, record);
                    }}
                    type="button"
                  >
                    {cashPaymentSeasonId === season.id ? "Recording…" : "Mark cash paid"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// eslint-disable-next-line complexity -- the roster page coordinates search, membership, dialogs, and profile actions.
export function RosterPage({
  enabled,
  initialProfileId,
  initialProfileTab = "info",
}: {
  readonly enabled: boolean;
  readonly initialProfileId?: string | null;
  readonly initialProfileTab?: ProfileTab;
}) {
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
  const [profilePhotoFileId, setProfilePhotoFileId] = useState<string | null>(null);
  const [profileTab, setProfileTab] = useState<ProfileTab>("info");
  const [performanceHistory, setPerformanceHistory] = useState<PerformanceHistoryState>({
    status: "idle",
  });
  const [profileStatusHistory, setProfileStatusHistory] = useState<ProfileStatusHistoryState>({
    status: "idle",
  });
  const [profileDues, setProfileDues] = useState<ProfileDuesState>({ status: "idle" });
  const [profileFolderNumbers, setProfileFolderNumbers] = useState<ProfileFolderNumbersState>({
    status: "idle",
  });
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [resettingProfileId, setResettingProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<RosterState>({ status: "loading" });
  const [selectedVoiceFilters, setSelectedVoiceFilters] = useState<readonly string[]>([]);
  const [statusFilter, setStatusFilter] = useState<RosterStatusFilter>("all");
  const [success, setSuccess] = useState<string | null>(null);
  const openedProfileFromRoute = useRef<string | null>(null);

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

  useEffect(() => {
    if (!enabled || roster.status !== "ready" || !initialProfileId) return;
    const candidate = roster.profiles.find((profile) => profile.id === initialProfileId);
    if (!candidate) return;
    const routeKey = `${initialProfileId}:${initialProfileTab}`;
    if (openedProfileFromRoute.current === routeKey) return;
    openedProfileFromRoute.current = routeKey;
    setEditingId(candidate.id);
    setProfile(profileRequestFrom(candidate));
    setProfilePhotoFileId(candidate.photoFileId);
    setProfileEmail(
      roster.memberships.find(({ profileId }) => profileId === candidate.id)?.email ?? "",
    );
    setProfileTab(initialProfileTab);
    setPerformanceHistory({ status: initialProfileTab === "performance" ? "loading" : "idle" });
    setProfileStatusHistory({ status: "loading" });
    setProfileDues({ status: initialProfileTab === "dues" ? "loading" : "idle" });
    setProfileFolderNumbers({ status: initialProfileTab === "folders" ? "loading" : "idle" });
    setResetFeedback(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }, [enabled, initialProfileId, initialProfileTab, roster]);

  useEffect(() => {
    if (!dialogOpen || !editingId || profileTab !== "performance") return;
    const controller = new AbortController();
    getOrganizationProfilePerformanceHistory(editingId, controller.signal)
      .then((data) => {
        setPerformanceHistory({ data, status: "ready" });
      })
      .catch((historyError: unknown) => {
        if (!(historyError instanceof DOMException && historyError.name === "AbortError")) {
          setPerformanceHistory({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [dialogOpen, editingId, profileTab]);

  useEffect(() => {
    if (!dialogOpen || !editingId) return;
    const controller = new AbortController();
    getOrganizationProfileStatusHistory(editingId, controller.signal)
      .then((data) => {
        setProfileStatusHistory({ data, status: "ready" });
      })
      .catch((historyError: unknown) => {
        if (!(historyError instanceof DOMException && historyError.name === "AbortError")) {
          setProfileStatusHistory({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [dialogOpen, editingId]);

  useEffect(() => {
    if (!dialogOpen || !editingId || profileTab !== "folders") return;
    const controller = new AbortController();
    getOrganizationProfileFolderNumbers(editingId, controller.signal)
      .then((folderNumbers) => {
        setProfileFolderNumbers({ folderNumbers, status: "ready" });
      })
      .catch((folderError: unknown) => {
        if (!(folderError instanceof DOMException && folderError.name === "AbortError")) {
          setProfileFolderNumbers({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [dialogOpen, editingId, profileTab]);

  useEffect(() => {
    if (!dialogOpen || !editingId || profileTab !== "dues") return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationSeasons(controller.signal),
      listOrganizationDues(controller.signal),
    ])
      .then(([seasons, dues]) => {
        setProfileDues({
          dues: dues.filter((record) => record.profileId === editingId),
          seasons,
          status: "ready",
        });
      })
      .catch((duesError: unknown) => {
        if (!(duesError instanceof DOMException && duesError.name === "AbortError")) {
          setProfileDues({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [dialogOpen, editingId, profileTab]);

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
    setProfilePhotoFileId(null);
    setProfileTab("info");
    setPerformanceHistory({ status: "idle" });
    setProfileStatusHistory({ status: "idle" });
    setProfileDues({ status: "idle" });
    setProfileFolderNumbers({ status: "idle" });
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
    setProfileTab("info");
    setPerformanceHistory({ status: "idle" });
    setProfileStatusHistory({ status: "idle" });
    setProfileDues({ status: "idle" });
    setProfileFolderNumbers({ status: "idle" });
    setProfile(emptyProfile);
    setProfileEmail("");
    setProfilePhotoFileId(null);
    setResetFeedback(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  function openEdit(candidate: OrganizationProfile) {
    setEditingId(candidate.id);
    setProfileTab("info");
    setPerformanceHistory({ status: "idle" });
    setProfileStatusHistory({ status: "loading" });
    setProfileDues({ status: "idle" });
    setProfileFolderNumbers({ status: "idle" });
    setProfile(profileRequestFrom(candidate));
    setProfilePhotoFileId(candidate.photoFileId);
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
      setProfilePhotoFileId(null);
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

  const editingProfileRecord =
    editingId && roster.status === "ready"
      ? (roster.profiles.find((candidate) => candidate.id === editingId) ?? null)
      : null;

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
