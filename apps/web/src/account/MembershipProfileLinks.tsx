import {
  organizationProfileRequestSchema,
  type CurrentAuthSession,
  type OrganizationAuthStatusResponse,
  type OrganizationInvitationRole,
  type OrganizationMembershipSummary,
  type OrganizationProfile,
} from "@choir/contracts";
import { allowedRoleOptionsForActor } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  getCurrentSession,
  linkOrganizationMembershipProfile,
  listOrganizationMemberships,
  listOrganizationProfiles,
  updateOrganizationMemberRole,
} from "../auth/api";
import { createOrganizationProfile } from "../api/profiles";
import { ResolveDuplicateDialog } from "./ResolveDuplicateDialog";

function roleLabel(role: OrganizationInvitationRole): string {
  switch (role) {
    case "administrator":
      return "Organization Administrator";
    case "member":
      return "Organization Member";
    case "owner":
      return "Organization Owner";
  }
}

function parseInvitationRole(value: string): OrganizationInvitationRole {
  if (value === "owner" || value === "administrator") {
    return value;
  }
  return "member";
}

type MembershipLinkState =
  | { readonly status: "error" | "loading" }
  | {
      readonly memberships: readonly OrganizationMembershipSummary[];
      readonly profiles: readonly OrganizationProfile[];
      readonly status: "ready";
      readonly truncated: boolean;
    };

interface ChangeMemberRoleDialogProps {
  readonly actorRole: OrganizationAuthStatusResponse["role"];
  readonly currentUserEmail?: string | undefined;
  readonly currentUserId?: string | undefined;
  readonly membership: OrganizationMembershipSummary;
  readonly onClose: () => void;
  readonly onRoleUpdated: (
    updatedMembership: OrganizationMembershipSummary,
    wasSelf: boolean,
  ) => void;
}

function isSelfMembership(
  membership: OrganizationMembershipSummary,
  currentUserId?: string,
  currentUserEmail?: string,
): boolean {
  if (currentUserId && membership.userId === currentUserId) {
    return true;
  }
  return currentUserEmail?.toLowerCase() === membership.email.toLowerCase();
}

function ChangeRoleWarnings({
  isDemotingSelfFromOwner,
  isDemotingSelfToMember,
  isPromotingToOwner,
  isUnlinkedAdminPromotion,
}: {
  readonly isDemotingSelfFromOwner: boolean;
  readonly isDemotingSelfToMember: boolean;
  readonly isPromotingToOwner: boolean;
  readonly isUnlinkedAdminPromotion: boolean;
}) {
  if (isUnlinkedAdminPromotion) {
    return (
      <p className="notice notice--warning" role="alert">
        A linked Organization Profile is required to assign an Administrator or Owner role. Link a
        Profile for this member before saving.
      </p>
    );
  }
  if (isPromotingToOwner) {
    return (
      <p className="notice notice--info" role="status">
        Promoting to Organization Owner grants full management access, including owner promotion,
        billing, and organization configuration.
      </p>
    );
  }
  if (isDemotingSelfFromOwner) {
    return (
      <p className="notice notice--warning" role="alert">
        Warning: You are demoting yourself from Organization Owner. You will immediately lose access
        to Owner-only settings.
      </p>
    );
  }
  if (isDemotingSelfToMember) {
    return (
      <p className="notice notice--warning" role="alert">
        Warning: You are demoting yourself to Organization Member. You will immediately lose
        Administrator management access.
      </p>
    );
  }
  return null;
}

function ChangeMemberRoleDialog({
  actorRole,
  currentUserEmail,
  currentUserId,
  membership,
  onClose,
  onRoleUpdated,
}: ChangeMemberRoleDialogProps) {
  const isSelf = isSelfMembership(membership, currentUserId, currentUserEmail);
  const [selectedRole, setSelectedRole] = useState<OrganizationInvitationRole>(membership.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedOptions = allowedRoleOptionsForActor(actorRole, membership.role, isSelf);
  const isDirty = selectedRole !== membership.role;
  const isPromotingToOwner = selectedRole === "owner" && membership.role !== "owner";
  const isDemotingSelfFromOwner = isSelf && membership.role === "owner" && selectedRole !== "owner";
  const isDemotingSelfToMember =
    isSelf && membership.role !== "member" && selectedRole === "member";
  const isDangerAction = isDemotingSelfFromOwner || isDemotingSelfToMember;
  const isUnlinkedAdminPromotion =
    !membership.profileId && (selectedRole === "administrator" || selectedRole === "owner");

  function handleClose() {
    if (!busy) {
      onClose();
    }
  }

  async function handleSave() {
    if (!isDirty || busy || isUnlinkedAdminPromotion) return;
    setBusy(true);
    setError(null);
    try {
      const response = await updateOrganizationMemberRole(
        membership.id,
        selectedRole,
        membership.role,
      );
      onRoleUpdated({ ...membership, role: response.role }, isSelf);
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof AuthApiError
          ? err.message
          : "The Organization Membership role could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      description={`Change Organization role for ${membership.name} (${membership.email}).`}
      dirty={isDirty}
      onClose={handleClose}
      open={true}
      title="Change member role"
    >
      <div className="form-stack">
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="change-member-role-select">Organization role</label>
          <select
            disabled={busy}
            id="change-member-role-select"
            onChange={(event) => {
              setSelectedRole(parseInvitationRole(event.target.value));
            }}
            value={selectedRole}
          >
            {allowedOptions.map((roleOption) => (
              <option key={roleOption} value={roleOption}>
                {roleLabel(roleOption)}
              </option>
            ))}
          </select>
        </div>

        <ChangeRoleWarnings
          isDemotingSelfFromOwner={isDemotingSelfFromOwner}
          isDemotingSelfToMember={isDemotingSelfToMember}
          isPromotingToOwner={isPromotingToOwner}
          isUnlinkedAdminPromotion={isUnlinkedAdminPromotion}
        />

        <div className="dialog__actions">
          <DialogClose asChild>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={handleClose}
              type="button"
            >
              Cancel
            </button>
          </DialogClose>
          <button
            className={`button ${isDangerAction ? "button--danger" : "button--primary"}`}
            disabled={busy || !isDirty || isUnlinkedAdminPromotion}
            onClick={() => {
              void handleSave();
            }}
            type="button"
          >
            {busy ? "Saving…" : "Save role"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function MembershipProfileLinkList({
  actorRole,
  busyMembershipId,
  currentUserEmail,
  currentUserId,
  onCreateAndLink,
  onLink,
  onOpenResolveDuplicate,
  onOpenRoleChange,
  onSelectedProfile,
  selectedProfiles,
  state,
}: {
  readonly actorRole: OrganizationAuthStatusResponse["role"];
  readonly busyMembershipId: string | null;
  readonly currentUserEmail?: string | undefined;
  readonly currentUserId?: string | undefined;
  readonly onCreateAndLink?: (membership: OrganizationMembershipSummary) => void;
  readonly onLink: (membership: OrganizationMembershipSummary) => void;
  readonly onOpenResolveDuplicate?: (membership: OrganizationMembershipSummary) => void;
  readonly onOpenRoleChange: (membership: OrganizationMembershipSummary) => void;
  readonly onSelectedProfile: (membershipId: string, profileId: string) => void;
  readonly selectedProfiles: Readonly<Record<string, string>>;
  readonly state: Extract<MembershipLinkState, { status: "ready" }>;
}) {
  if (state.memberships.length === 0) {
    return <p className="empty-state">There are no Organization Memberships.</p>;
  }
  const unlinkedAdmins = state.memberships.filter(
    (m) => (m.role === "owner" || m.role === "administrator") && !m.profileId,
  );
  const profileMembership = new Map(
    state.memberships.flatMap((membership) =>
      membership.profileId ? [[membership.profileId, membership.id] as const] : [],
    ),
  );
  return (
    <>
      {unlinkedAdmins.length > 0 ? (
        <aside
          aria-label="Administrators without a linked Profile"
          className="notice notice--warning"
          role="alert"
        >
          <strong>Administrators without a linked Profile</strong>
          <p>
            The following administrators do not have a linked Organization Profile and cannot
            receive administrative notifications or access personal notifications:
          </p>
          <ul>
            {unlinkedAdmins.map((admin) => (
              <li key={admin.id}>
                {admin.name} ({admin.email}) — {roleLabel(admin.role)}
              </li>
            ))}
          </ul>
          <p>
            Select an existing Profile below and choose Link Profile, or use Create and link to
            create a roster Profile now.
          </p>
        </aside>
      ) : null}
      <ul className="account-list organization-invitation-list">
        {state.memberships.map((membership) => {
          const isSelf = isSelfMembership(membership, currentUserId, currentUserEmail);
          const allowedOptions = allowedRoleOptionsForActor(actorRole, membership.role, isSelf);
          const canChangeRole = allowedOptions.length > 0;

          return (
            <li aria-label={`Membership: ${membership.email}`} key={membership.id}>
              <div>
                <h4>{membership.name}</h4>
                <p>{membership.email}</p>
                <p>{roleLabel(membership.role)}</p>
              </div>
              <div className="form-actions">
                {canChangeRole ? (
                  <button
                    aria-label={`Change role for ${membership.name}`}
                    className="button button--secondary button--control-height"
                    disabled={busyMembershipId !== null}
                    onClick={() => {
                      onOpenRoleChange(membership);
                    }}
                    type="button"
                  >
                    Change role
                  </button>
                ) : null}
                {onOpenResolveDuplicate && membership.profileId ? (
                  <button
                    aria-label={`Resolve duplicate for ${membership.name}`}
                    className="button button--secondary button--control-height"
                    disabled={busyMembershipId !== null}
                    onClick={() => {
                      onOpenResolveDuplicate(membership);
                    }}
                    type="button"
                  >
                    Resolve duplicate
                  </button>
                ) : null}
                {onCreateAndLink &&
                !membership.profileId &&
                (membership.role === "owner" || membership.role === "administrator") ? (
                  <button
                    aria-label={`Create and link Profile for ${membership.name}`}
                    className="button button--secondary button--control-height"
                    disabled={busyMembershipId !== null}
                    onClick={() => {
                      onCreateAndLink(membership);
                    }}
                    type="button"
                  >
                    {busyMembershipId === membership.id ? "Creating…" : "Create and link"}
                  </button>
                ) : null}
                <label className="field">
                  Organization Profile
                  <select
                    value={selectedProfiles[membership.id] ?? ""}
                    onChange={(event) => {
                      onSelectedProfile(membership.id, event.target.value);
                    }}
                  >
                    <option value="">Choose a Profile</option>
                    {state.profiles.map((profile) => {
                      const linkedMembershipId = profileMembership.get(profile.id);
                      return (
                        <option
                          disabled={
                            linkedMembershipId !== undefined && linkedMembershipId !== membership.id
                          }
                          key={profile.id}
                          value={profile.id}
                        >
                          {profile.displayName}
                          {linkedMembershipId === membership.id ? " (linked)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <button
                  className="button button--secondary button--control-height"
                  disabled={
                    busyMembershipId !== null ||
                    !selectedProfiles[membership.id] ||
                    selectedProfiles[membership.id] === membership.profileId
                  }
                  onClick={() => {
                    onLink(membership);
                  }}
                  type="button"
                >
                  {busyMembershipId === membership.id ? "Linking…" : "Link Profile"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {state.truncated ? (
        <p className="notice notice--warning">
          Showing the first 500 Memberships. Manage additional accounts through a smaller
          maintenance batch.
        </p>
      ) : null}
    </>
  );
}

export function MembershipProfileLinks({
  context,
}: {
  readonly context: OrganizationAuthStatusResponse;
}) {
  const [busyMembershipId, setBusyMembershipId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({});
  const [state, setState] = useState<MembershipLinkState>({ status: "loading" });
  const [currentUser, setCurrentUser] = useState<CurrentAuthSession | null>(null);
  const [roleDialogMembership, setRoleDialogMembership] =
    useState<OrganizationMembershipSummary | null>(null);
  const [resolveDuplicateMembership, setResolveDuplicateMembership] =
    useState<OrganizationMembershipSummary | null>(null);
  const mfaBlocked = context.mfaRequired && !context.mfaSatisfied;

  async function reloadMembershipLinks() {
    try {
      const [membershipResult, profiles] = await Promise.all([
        listOrganizationMemberships(),
        listOrganizationProfiles(),
      ]);
      setState({
        memberships: membershipResult.memberships,
        profiles,
        status: "ready",
        truncated: membershipResult.truncated,
      });
      setSelectedProfiles(
        Object.fromEntries(
          membershipResult.memberships.map((membership) => [
            membership.id,
            membership.profileId ?? "",
          ]),
        ),
      );
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setState({ status: "error" });
      }
    }
  }

  useEffect(() => {
    if (context.role === "member" || mfaBlocked) return;
    const abortController = new AbortController();
    Promise.all([
      listOrganizationMemberships(abortController.signal),
      listOrganizationProfiles(abortController.signal),
      getCurrentSession(abortController.signal).catch(() => null),
    ])
      .then(([membershipResult, profiles, session]) => {
        setState({
          memberships: membershipResult.memberships,
          profiles,
          status: "ready",
          truncated: membershipResult.truncated,
        });
        setCurrentUser(session);
        setSelectedProfiles(
          Object.fromEntries(
            membershipResult.memberships.map((membership) => [
              membership.id,
              membership.profileId ?? "",
            ]),
          ),
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [context.role, mfaBlocked]);

  if (context.role === "member") return null;
  if (mfaBlocked) {
    return (
      <fieldset className="surface-card organization-settings-panel organization-pending-invitations">
        <legend>Organization Memberships</legend>
        <p className="notice notice--info">
          Organization Memberships will be available after Organization MFA is verified.
        </p>
      </fieldset>
    );
  }

  async function linkProfile(membership: OrganizationMembershipSummary) {
    const profileId = selectedProfiles[membership.id] ?? "";
    if (!profileId || profileId === membership.profileId) return;
    setBusyMembershipId(membership.id);
    setMessage(null);
    try {
      await linkOrganizationMembershipProfile(membership.id, profileId);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              memberships: current.memberships.map((candidate) =>
                candidate.id === membership.id ? { ...candidate, profileId } : candidate,
              ),
            }
          : current,
      );
      setMessage(`Profile linked for ${membership.email}.`);
    } catch (error: unknown) {
      setMessage(
        error instanceof AuthApiError
          ? error.message
          : "The Membership Profile link could not be saved.",
      );
    } finally {
      setBusyMembershipId(null);
    }
  }

  async function handleCreateAndLink(membership: OrganizationMembershipSummary) {
    setBusyMembershipId(membership.id);
    setMessage(null);
    try {
      const created = await createOrganizationProfile(
        organizationProfileRequestSchema.parse({
          displayName: membership.name || "Choir Administrator",
          receiveAdminNotifications: true,
          receiveFinancialAlerts: true,
          receiveRsvpDeclineNotices: true,
          showInDirectory: true,
        }),
        membership.email,
      );
      await linkOrganizationMembershipProfile(membership.id, created.id);
      await reloadMembershipLinks();
      setMessage(`Created and linked Profile for ${membership.email}.`);
    } catch (error: unknown) {
      setMessage(
        error instanceof AuthApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "The Profile could not be created and linked.",
      );
    } finally {
      setBusyMembershipId(null);
    }
  }

  function handleRoleUpdated(updatedMembership: OrganizationMembershipSummary, wasSelf: boolean) {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            memberships: current.memberships.map((candidate) =>
              candidate.id === updatedMembership.id ? updatedMembership : candidate,
            ),
          }
        : current,
    );
    setMessage(
      `Role updated to ${roleLabel(updatedMembership.role)} for ${updatedMembership.name}.`,
    );
    if (wasSelf && typeof window !== "undefined" && typeof window.location.reload === "function") {
      window.location.reload();
    }
  }

  return (
    <fieldset className="surface-card organization-settings-panel organization-pending-invitations">
      <legend>Organization Memberships</legend>
      <div className="section-heading section-heading--compact">
        <p className="section-description">
          Manage member roles and link each sign-in Membership to a Profile in this Organization.
          Profiles already linked to another Membership cannot be selected.
        </p>
      </div>
      {state.status === "loading" ? <p role="status">Loading Memberships and Profiles…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Organization Memberships could not be loaded.
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {state.status === "ready" ? (
        <>
          <MembershipProfileLinkList
            actorRole={context.role}
            busyMembershipId={busyMembershipId}
            currentUserEmail={currentUser?.user.email}
            currentUserId={currentUser?.user.id}
            onCreateAndLink={(membership) => {
              void handleCreateAndLink(membership);
            }}
            onLink={(membership) => {
              void linkProfile(membership);
            }}
            onOpenResolveDuplicate={(membership) => {
              setResolveDuplicateMembership(membership);
            }}
            onOpenRoleChange={(membership) => {
              setRoleDialogMembership(membership);
            }}
            onSelectedProfile={(membershipId, profileId) => {
              setSelectedProfiles((current) => ({ ...current, [membershipId]: profileId }));
            }}
            selectedProfiles={selectedProfiles}
            state={state}
          />
          {roleDialogMembership ? (
            <ChangeMemberRoleDialog
              actorRole={context.role}
              currentUserEmail={currentUser?.user.email}
              currentUserId={currentUser?.user.id}
              key={roleDialogMembership.id}
              membership={roleDialogMembership}
              onClose={() => {
                setRoleDialogMembership(null);
              }}
              onRoleUpdated={handleRoleUpdated}
            />
          ) : null}
          {resolveDuplicateMembership?.profileId ? (
            <ResolveDuplicateDialog
              allProfiles={state.profiles}
              linkedProfileIds={
                new Set(state.memberships.flatMap((m) => (m.profileId ? [m.profileId] : [])))
              }
              membershipEmail={resolveDuplicateMembership.email}
              membershipId={resolveDuplicateMembership.id}
              membershipName={resolveDuplicateMembership.name}
              onClose={() => {
                setResolveDuplicateMembership(null);
              }}
              onReconciled={() => {
                setResolveDuplicateMembership(null);
                setMessage(
                  `Successfully resolved duplicate Profile for ${resolveDuplicateMembership.email}.`,
                );
                void reloadMembershipLinks();
              }}
              open={true}
              sourceProfileId={resolveDuplicateMembership.profileId}
            />
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
