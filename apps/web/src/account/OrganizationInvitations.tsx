import {
  organizationInvitationRequestSchema,
  type CurrentAuthSession,
  type OrganizationAuthStatusResponse,
  type OrganizationInvitationRole,
  type OrganizationInvitationSummary,
  type OrganizationMembershipSummary,
  type OrganizationProfile,
} from "@choir/contracts";
import { allowedRoleOptionsForActor } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  cancelOrganizationInvitation,
  createOrganizationInvitation,
  getCurrentSession,
  linkOrganizationMembershipProfile,
  listOrganizationInvitations,
  listOrganizationMemberships,
  listOrganizationProfiles,
  updateOrganizationMemberRole,
} from "../auth/api";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

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

interface PendingInvitationListProps {
  readonly busyInvitationId: string | null;
  readonly cancelConfirmationId: string | null;
  readonly invitations: readonly OrganizationInvitationSummary[];
  readonly listError: boolean;
  readonly listLoading: boolean;
  readonly mfaBlocked: boolean;
  readonly onCancel: (invitation: OrganizationInvitationSummary) => void;
  readonly onSetConfirmation: (invitationId: string | null) => void;
  readonly role: OrganizationAuthStatusResponse["role"];
  readonly truncated: boolean;
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
}: {
  readonly isDemotingSelfFromOwner: boolean;
  readonly isDemotingSelfToMember: boolean;
  readonly isPromotingToOwner: boolean;
}) {
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

  function handleClose() {
    if (!busy) {
      onClose();
    }
  }

  async function handleSave() {
    if (!isDirty || busy) return;
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
            disabled={busy || !isDirty}
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
  onLink,
  onOpenRoleChange,
  onSelectedProfile,
  selectedProfiles,
  state,
}: {
  readonly actorRole: OrganizationAuthStatusResponse["role"];
  readonly busyMembershipId: string | null;
  readonly currentUserEmail?: string | undefined;
  readonly currentUserId?: string | undefined;
  readonly onLink: (membership: OrganizationMembershipSummary) => void;
  readonly onOpenRoleChange: (membership: OrganizationMembershipSummary) => void;
  readonly onSelectedProfile: (membershipId: string, profileId: string) => void;
  readonly selectedProfiles: Readonly<Record<string, string>>;
  readonly state: Extract<MembershipLinkState, { status: "ready" }>;
}) {
  if (state.memberships.length === 0) {
    return <p className="empty-state">There are no Organization Memberships.</p>;
  }
  const profileMembership = new Map(
    state.memberships.flatMap((membership) =>
      membership.profileId ? [[membership.profileId, membership.id] as const] : [],
    ),
  );
  return (
    <>
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
                    className="button button--secondary"
                    disabled={busyMembershipId !== null}
                    onClick={() => {
                      onOpenRoleChange(membership);
                    }}
                    type="button"
                  >
                    Change role
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
                  className="button button--secondary"
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

function MembershipProfileLinks({ context }: { readonly context: OrganizationAuthStatusResponse }) {
  const [busyMembershipId, setBusyMembershipId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({});
  const [state, setState] = useState<MembershipLinkState>({ status: "loading" });
  const [currentUser, setCurrentUser] = useState<CurrentAuthSession | null>(null);
  const [roleDialogMembership, setRoleDialogMembership] =
    useState<OrganizationMembershipSummary | null>(null);
  const mfaBlocked = context.mfaRequired && !context.mfaSatisfied;

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
            onLink={(membership) => {
              void linkProfile(membership);
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
        </>
      ) : null}
    </fieldset>
  );
}

function PendingInvitationList(props: PendingInvitationListProps) {
  return (
    <fieldset className="surface-card organization-settings-panel organization-pending-invitations">
      <legend>Pending invitations</legend>
      {props.listLoading && !props.mfaBlocked ? (
        <p className="notice notice--info" role="status">
          Loading pending invitations…
        </p>
      ) : null}
      {props.listError ? (
        <p className="notice notice--error" role="alert">
          Pending invitations could not be loaded. Refresh the page and try again.
        </p>
      ) : null}
      {!props.mfaBlocked &&
      !props.listLoading &&
      !props.listError &&
      props.invitations.length === 0 ? (
        <p className="empty-state">There are no current pending invitations.</p>
      ) : null}
      {props.invitations.length > 0 ? (
        <ul className="account-list organization-invitation-list">
          {props.invitations.map((invitation) => {
            const canCancel = props.role === "owner" || invitation.role !== "owner";
            const confirming = props.cancelConfirmationId === invitation.id;
            return (
              <li aria-label={`Invitation: ${invitation.email}`} key={invitation.id}>
                <div>
                  <h4>{invitation.email}</h4>
                  <p>{roleLabel(invitation.role)}</p>
                  <p>Expires {displayDate(invitation.expiresAt)}</p>
                </div>
                {canCancel ? (
                  confirming ? (
                    <div
                      className="danger-confirmation"
                      role="group"
                      aria-label={`Cancel invitation for ${invitation.email}`}
                    >
                      <p>Cancel this invitation?</p>
                      <div className="form-actions">
                        <button
                          className="button button--secondary"
                          disabled={props.busyInvitationId !== null}
                          onClick={() => {
                            props.onSetConfirmation(null);
                          }}
                          type="button"
                        >
                          Keep invitation
                        </button>
                        <button
                          className="button button--danger"
                          disabled={props.busyInvitationId !== null}
                          onClick={() => {
                            props.onCancel(invitation);
                          }}
                          type="button"
                        >
                          {props.busyInvitationId === invitation.id
                            ? "Canceling invitation…"
                            : "Confirm cancellation"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="button button--danger"
                      disabled={props.busyInvitationId !== null || props.mfaBlocked}
                      onClick={() => {
                        props.onSetConfirmation(invitation.id);
                      }}
                      type="button"
                    >
                      Cancel invitation
                    </button>
                  )
                ) : (
                  <span className="status-pill">Owner action required</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {props.truncated ? (
        <p className="notice notice--warning">
          Showing the 50 newest pending invitations. Cancel older invitations after clearing this
          list.
        </p>
      ) : null}
    </fieldset>
  );
}

export function OrganizationInvitations({
  context,
}: {
  readonly context: OrganizationAuthStatusResponse;
}) {
  const [busy, setBusy] = useState(false);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  const [cancelConfirmationId, setCancelConfirmationId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<readonly OrganizationInvitationSummary[]>([]);
  const [listError, setListError] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [role, setRole] = useState<"administrator" | "member" | "owner">("member");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const mfaBlocked = context.mfaRequired && !context.mfaSatisfied;

  useEffect(() => {
    if (context.role === "member" || mfaBlocked) {
      return;
    }
    const abortController = new AbortController();
    listOrganizationInvitations(abortController.signal)
      .then((result) => {
        setInvitations(result.invitations);
        setTruncated(result.truncated);
        setListError(false);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setListError(true);
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setListLoading(false);
        }
      });
    return () => {
      abortController.abort();
    };
  }, [context.role, mfaBlocked]);

  if (context.role === "member") {
    return null;
  }

  async function refreshInvitations() {
    const result = await listOrganizationInvitations();
    setInvitations(result.invitations);
    setTruncated(result.truncated);
    setListError(false);
  }

  async function createInvitation() {
    const parsed = organizationInvitationRequestSchema.safeParse({
      email: email.trim().toLowerCase(),
      role,
    });
    if (!parsed.success) {
      setErrorMessage("Enter a valid email address and Organization role.");
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const invitation = await createOrganizationInvitation(parsed.data);
      setEmail("");
      setRole("member");
      setSuccessMessage(
        `Invitation created for ${parsed.data.email}. It expires ${displayDate(invitation.expiresAt)}.`,
      );
      await refreshInvitations().catch(() => {
        setListError(true);
      });
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof AuthApiError
          ? error.message
          : "The Organization invitation could not be created. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvitation(invitation: OrganizationInvitationSummary) {
    setBusyInvitationId(invitation.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await cancelOrganizationInvitation(invitation.id);
      setInvitations((current) => current.filter((candidate) => candidate.id !== invitation.id));
      setCancelConfirmationId(null);
      setSuccessMessage(`Invitation for ${invitation.email} canceled.`);
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof AuthApiError
          ? error.message
          : "The Organization invitation could not be canceled. Try again.",
      );
    } finally {
      setBusyInvitationId(null);
    }
  }

  return (
    <div className="settings-stack">
      <fieldset
        className="surface-card organization-settings-panel account-section account-section--organization-invitations"
        aria-labelledby="organization-invitations-title"
      >
        <legend id="organization-invitations-title">Invite a member</legend>
        <div className="section-heading section-heading--compact">
          <p className="section-description">
            Invitations expire after 8 days. The recipient must sign in with the invited email
            before accepting.
          </p>
        </div>
        {mfaBlocked ? (
          <OrganizationMfaPrompt message="Verify Organization MFA before creating an invitation." />
        ) : null}
        {errorMessage ? (
          <p className="notice notice--error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {successMessage ? (
          <p className="notice notice--success" role="status">
            {successMessage}
          </p>
        ) : null}
        <form
          className="form-stack organization-invitation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createInvitation();
          }}
        >
          <div className="field">
            <label htmlFor="organization-invitation-email">Email address</label>
            <input
              autoComplete="email"
              id="organization-invitation-email"
              maxLength={320}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field">
            <label htmlFor="organization-invitation-role">Organization role</label>
            <select
              aria-describedby="organization-invitation-role-help"
              id="organization-invitation-role"
              onChange={(event) => {
                setRole(parseInvitationRole(event.target.value));
              }}
              value={role}
            >
              <option value="member">Organization Member</option>
              <option value="administrator">Organization Administrator</option>
              {context.role === "owner" ? <option value="owner">Organization Owner</option> : null}
            </select>
            <p className="field-help" id="organization-invitation-role-help">
              These are Organization Membership roles, not Profile roles. Members can use
              member-facing features. Administrators can manage the Organization&apos;s operational
              data, Profiles, Memberships, and invitations. Owners have Administrator access plus
              owner-only controls such as Organization MFA, Public Website domains, and Owner
              invitations.
            </p>
          </div>
          <button className="button button--primary" disabled={busy || mfaBlocked} type="submit">
            {busy ? "Creating invitation…" : "Create invitation"}
          </button>
        </form>
      </fieldset>

      <PendingInvitationList
        busyInvitationId={busyInvitationId}
        cancelConfirmationId={cancelConfirmationId}
        invitations={invitations}
        listError={listError}
        listLoading={listLoading}
        mfaBlocked={mfaBlocked}
        onCancel={(invitation) => {
          void cancelInvitation(invitation);
        }}
        onSetConfirmation={setCancelConfirmationId}
        role={context.role}
        truncated={truncated}
      />
      <MembershipProfileLinks context={context} />
    </div>
  );
}
