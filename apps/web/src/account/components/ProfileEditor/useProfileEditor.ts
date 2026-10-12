import type {
  OrganizationMembershipSummary,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { organizationInvitationRequestSchema } from "@choir/contracts";
import { useEffect, useState } from "react";
import {
  AuthApiError,
  createOrganizationInvitation,
  getOrganizationProfileDeliveries,
  getOrganizationProfileFolderNumbers,
  getOrganizationProfilePerformanceHistory,
  getOrganizationProfileStatusHistory,
  listOrganizationDues,
  listOrganizationMemberships,
  listOrganizationSeasons,
  requestPasswordReset,
  updateOrganizationProfile,
} from "../../../auth/api";
import { emptyProfile, profileRequestFrom } from "../RosterPage/utils";
import type {
  PerformanceHistoryState,
  ProfileDeliveriesState,
  ProfileDuesState,
  ProfileEditorDialogProps,
  ProfileFolderNumbersState,
  ProfileStatusHistoryState,
  ProfileTab,
} from "./types";

/**
 * Focused controller for editing one existing profile by stable ID in a host
 * page (Roster uses its own page controller; RSVP and future hosts use this).
 * Loads linked memberships and detail tabs only while open, saves through the
 * canonical profile API, and notifies the host via `onSaved` so it can refresh
 * its own caches. Never navigates or owns host list state.
 */
export function useProfileEditor({
  onRsvpChanged,
  onSaved,
  rosterConfiguration,
}: {
  readonly onRsvpChanged?: ((eventId: string) => void) | undefined;
  readonly onSaved?: ((saved: OrganizationProfile) => void) | undefined;
  readonly rosterConfiguration?: OrganizationRosterConfiguration | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProfileRecord, setEditingProfileRecord] = useState<OrganizationProfile | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<readonly OrganizationMembershipSummary[]>([]);
  const [membershipsReady, setMembershipsReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [performanceHistory, setPerformanceHistory] = useState<PerformanceHistoryState>({
    status: "idle",
  });
  const [profile, setProfile] = useState<OrganizationProfileRequest>(emptyProfile);
  const [profileDeliveries, setProfileDeliveries] = useState<ProfileDeliveriesState>({
    status: "idle",
  });
  const [profileDues, setProfileDues] = useState<ProfileDuesState>({ status: "idle" });
  const [profileEmail, setProfileEmail] = useState("");
  const [profileFolderNumbers, setProfileFolderNumbers] = useState<ProfileFolderNumbersState>({
    status: "idle",
  });
  const [profilePhotoFileId, setProfilePhotoFileId] = useState<string | null>(null);
  const [profileStatusHistory, setProfileStatusHistory] = useState<ProfileStatusHistoryState>({
    status: "idle",
  });
  const [profileTab, setProfileTab] = useState<ProfileTab>("info");
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [resettingProfileId, setResettingProfileId] = useState<string | null>(null);

  const emailByProfileId = new Map(
    memberships.flatMap((m) => (m.profileId ? [[m.profileId, m.email] as const] : [])),
  );

  function openProfile(record: OrganizationProfile) {
    setEditingId(record.id);
    setEditingProfileRecord(record);
    setProfile(profileRequestFrom(record));
    setProfilePhotoFileId(record.photoFileId);
    setProfileEmail(emailByProfileId.get(record.id) ?? "");
    setProfileTab("info");
    setPerformanceHistory({ status: "idle" });
    setProfileStatusHistory({ status: "loading" });
    setProfileDues({ status: "idle" });
    setProfileFolderNumbers({ status: "idle" });
    setProfileDeliveries({ status: "idle" });
    setResetFeedback(null);
    setError(null);
    setLoadError(null);
    setOpen(true);
  }

  function closeProfile() {
    if (busy) return;
    setOpen(false);
    setEditingId(null);
    setEditingProfileRecord(null);
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

  // Load linked memberships (for email / linked-account UI) only while open.
  useEffect(() => {
    if (!open || !editingId) return;
    const controller = new AbortController();
    listOrganizationMemberships(controller.signal)
      .then((result) => {
        setMemberships(result.memberships);
        setMembershipsReady(true);
        const email = result.memberships.find((m) => m.profileId === editingId)?.email ?? "";
        setProfileEmail((current) => current || email);
      })
      .catch((membershipError: unknown) => {
        if (!(membershipError instanceof DOMException && membershipError.name === "AbortError")) {
          // Membership email is supplementary; profile editing still works.
          setMemberships([]);
          setMembershipsReady(true);
        }
      });
    return () => {
      controller.abort();
    };
  }, [editingId, open]);

  useEffect(() => {
    if (!open || !editingId || profileTab !== "performance") return;
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
  }, [editingId, open, profileTab]);

  useEffect(() => {
    if (!open || !editingId) return;
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
  }, [editingId, open]);

  useEffect(() => {
    if (!open || !editingId || profileTab !== "folders") return;
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
  }, [editingId, open, profileTab]);

  useEffect(() => {
    if (!open || !editingId || profileTab !== "messages") return;
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
  }, [editingId, open, profileTab]);

  useEffect(() => {
    if (!open || !editingId || profileTab !== "dues") return;
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
  }, [editingId, open, profileTab]);

  async function saveProfile() {
    if (!editingId) return;
    if (!profile.displayName.trim()) {
      setProfileTab("info");
      setError("Enter a display name.");
      setTimeout(() => {
        document.getElementById("roster-profile-name")?.focus();
      }, 0);
      return;
    }
    const normalizedEmail = profileEmail.trim().toLowerCase();
    const linkedEmail = emailByProfileId.get(editingId) ?? "";
    if (normalizedEmail && normalizedEmail !== linkedEmail) {
      const parsedInvitation = organizationInvitationRequestSchema.safeParse({
        email: normalizedEmail,
        role: "member",
      });
      if (!parsedInvitation.success) {
        setProfileTab("info");
        setError("Enter a valid email address.");
        setTimeout(() => {
          document.getElementById("roster-profile-email")?.focus();
        }, 0);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await updateOrganizationProfile(
        editingId,
        profile,
        normalizedEmail && normalizedEmail !== linkedEmail ? normalizedEmail : undefined,
      );
      if (normalizedEmail && normalizedEmail !== linkedEmail) {
        try {
          await createOrganizationInvitation({ email: normalizedEmail, role: "member" });
        } catch {
          // Profile saved; invitation failure matches Roster behavior of not
          // blocking the save (host shows generic saved feedback).
        }
      }
      onSaved?.(saved);
      setBusy(false);
      // Close directly (bypass busy guard above which would early-return).
      setOpen(false);
      setEditingId(null);
      setEditingProfileRecord(null);
      setProfile(emptyProfile);
      setProfileEmail("");
      setProfilePhotoFileId(null);
      setResetFeedback(null);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError ? saveError.message : "The Profile could not be updated.",
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

  const linkedMembership = editingId
    ? memberships.find((membership) => membership.profileId === editingId)
    : undefined;

  const dialogProps: Omit<ProfileEditorDialogProps, "onClose" | "open" | "saveLabel"> = {
    busy,
    editingId,
    editingProfileRecord,
    error: error ?? loadError,
    linkedMembership,
    onPhotoChanged: (fileId) => {
      setProfilePhotoFileId(fileId);
      setEditingProfileRecord((current) =>
        current ? { ...current, photoFileId: fileId } : current,
      );
    },
    onRsvpChanged,
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
    rosterMemberships: memberships,
    rosterReady: membershipsReady,
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
  };

  return {
    closeProfile,
    dialogProps,
    editingId,
    open,
    openProfile,
    setLoadError,
  };
}

export type ProfileEditorController = ReturnType<typeof useProfileEditor>;
