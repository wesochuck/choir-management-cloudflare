import type { OrganizationProfile, OrganizationProfileRequest } from "@choir/contracts";
import { organizationInvitationRequestSchema } from "@choir/contracts";
import { emptyProfile, profileMatchesVoiceFilters, profileRequestFrom } from "./utils";
import type {
  PerformanceHistoryState,
  ProfileDeliveriesState,
  ProfileDuesState,
  ProfileFolderNumbersState,
  ProfileStatusHistoryState,
  ProfileTab,
  RosterState,
  RosterStatusFilter,
} from "./types";
import {
  inspectRosterCsv,
  mapRosterCsvColumns,
  rosterCsvColumnForHeader,
  type CsvColumnMapping,
  type RosterCsvInspection,
} from "@choir/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AuthApiError,
  createOrganizationProfile,
  createOrganizationInvitation,
  getOrganizationRosterConfiguration,
  getOrganizationProfileDeliveries,
  getOrganizationProfilePerformanceHistory,
  getOrganizationProfileStatusHistory,
  getOrganizationProfileFolderNumbers,
  importOrganizationProfilesCsv,
  listOrganizationDues,
  listOrganizationMemberships,
  listOrganizationProfiles,
  listOrganizationSeasons,
  requestPasswordReset,
  updateOrganizationProfile,
} from "../../../auth/api";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";

export type RosterBulkAction =
  | { readonly kind: "directory"; readonly value: boolean }
  | { readonly kind: "status"; readonly value: OrganizationProfile["globalStatus"] };

export function useRosterPageController({
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
  const [profileDeliveries, setProfileDeliveries] = useState<ProfileDeliveriesState>({
    status: "idle",
  });
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [resettingProfileId, setResettingProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<RosterState>({ status: "loading" });
  const [selectedVoiceFilters, setSelectedVoiceFilters] = useState<readonly string[]>([]);
  const [selectedProfileIds, setSelectedProfileIds] = useState<readonly string[]>([]);
  const [statusFilter, setStatusFilter] = useState<RosterStatusFilter>("all");
  const [bulkBusy, setBulkBusy] = useState(false);
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
    setProfileDeliveries({ status: initialProfileTab === "messages" ? "loading" : "idle" });
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
    if (!dialogOpen || !editingId || profileTab !== "messages") return;
    const controller = new AbortController();
    getOrganizationProfileDeliveries(editingId, controller.signal)
      .then((data) => {
        setProfileDeliveries({ data, status: "ready" });
      })
      .catch((deliveriesError: unknown) => {
        if (!(deliveriesError instanceof DOMException && deliveriesError.name === "AbortError")) {
          setProfileDeliveries({ status: "error" });
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

  function toggleProfileSelection(profileId: string, selected: boolean): void {
    setSelectedProfileIds((current) => {
      if (selected) return current.includes(profileId) ? current : [...current, profileId];
      return current.filter((candidate) => candidate !== profileId);
    });
  }

  function toggleVisibleProfileSelection(profileIds: readonly string[], selected: boolean): void {
    setSelectedProfileIds((current) => {
      const next = new Set(current);
      for (const profileId of profileIds) {
        if (selected) next.add(profileId);
        else next.delete(profileId);
      }
      return [...next];
    });
  }

  async function bulkUpdateProfiles(action: RosterBulkAction): Promise<void> {
    if (bulkBusy || roster.status !== "ready") return;
    const selected = filteredProfiles.filter((candidate) =>
      selectedProfileIds.includes(candidate.id),
    );
    if (selected.length === 0) return;
    setBulkBusy(true);
    setError(null);
    setSuccess(null);
    const results = await Promise.allSettled(
      selected.map((candidate) => {
        const nextProfile: OrganizationProfileRequest = {
          ...profileRequestFrom(candidate),
          ...(action.kind === "status"
            ? { globalStatus: action.value, statusIsManual: true }
            : { showInDirectory: action.value }),
        };
        return updateOrganizationProfile(candidate.id, nextProfile);
      }),
    );
    const updated = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failed = results.length - updated.length;
    if (updated.length > 0) {
      const updatedById = new Map(updated.map((candidate) => [candidate.id, candidate]));
      setRoster((current) =>
        current.status === "ready"
          ? {
              ...current,
              profiles: current.profiles.map(
                (candidate) => updatedById.get(candidate.id) ?? candidate,
              ),
            }
          : current,
      );
    }
    setSelectedProfileIds((current) =>
      current.filter((profileId) => !selected.some((candidate) => candidate.id === profileId)),
    );
    if (failed > 0) {
      setError(
        `${String(failed)} Profile${failed === 1 ? "" : "s"} could not be updated. ${String(updated.length)} updated successfully.`,
      );
    } else {
      setSuccess(`${String(updated.length)} Profile${updated.length === 1 ? "" : "s"} updated.`);
    }
    setBulkBusy(false);
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
    setProfileDeliveries({ status: "idle" });
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
    setProfileDeliveries({ status: "idle" });
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
    setProfileDeliveries({ status: "idle" });
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
  return {
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
    openCreate,
    openEdit,
    performanceHistory,
    performerLabel,
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
    setProfileDeliveries,
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
    toggleProfileSelection,
    toggleVisibleProfileSelection,
    toggleVoiceFilter,
  };
}

export type RosterPageModel = ReturnType<typeof useRosterPageController>;
