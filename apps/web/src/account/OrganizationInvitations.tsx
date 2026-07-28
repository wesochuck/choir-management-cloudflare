import {
  organizationInvitationRequestSchema,
  type OrganizationAuthStatusResponse,
  type OrganizationInvitationSummary,
  type OrganizationMembershipSummary,
  type OrganizationProfile,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  cancelOrganizationInvitation,
  createOrganizationInvitation,
  linkOrganizationMembershipProfile,
  listOrganizationInvitations,
  listOrganizationMemberships,
  listOrganizationProfiles,
} from "../auth/api";

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function roleLabel(role: OrganizationInvitationSummary["role"]): string {
  switch (role) {
    case "administrator":
      return "Organization Administrator";
    case "member":
      return "Organization Member";
    case "owner":
      return "Organization Owner";
  }
}

function parseInvitationRole(value: string): OrganizationInvitationSummary["role"] {
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

function MembershipProfileLinkList({
  busyMembershipId,
  onLink,
  onSelectedProfile,
  selectedProfiles,
  state,
}: {
  readonly busyMembershipId: string | null;
  readonly onLink: (membership: OrganizationMembershipSummary) => void;
  readonly onSelectedProfile: (membershipId: string, profileId: string) => void;
  readonly selectedProfiles: Readonly<Record<string, string>>;
  readonly state: Extract<MembershipLinkState, { status: "ready" }>;
}) {
  if (state.memberships.length === 0) {
    return <p className="empty-state">There are no Organization Memberships to link.</p>;
  }
  if (state.profiles.length === 0) {
    return (
      <p className="empty-state">Create an Organization Profile before linking a Membership.</p>
    );
  }
  const profileMembership = new Map(
    state.memberships.flatMap((membership) =>
      membership.profileId ? [[membership.profileId, membership.id] as const] : [],
    ),
  );
  return (
    <>
      <ul className="account-list organization-invitation-list">
        {state.memberships.map((membership) => (
          <li aria-label={`Membership: ${membership.email}`} key={membership.id}>
            <div>
              <h4>{membership.name}</h4>
              <p>{membership.email}</p>
              <p>{roleLabel(membership.role)}</p>
            </div>
            <div className="form-actions">
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
        ))}
      </ul>
      {state.truncated ? (
        <p className="notice notice--warning">
          Showing the first 500 Memberships. Link additional accounts through a smaller maintenance
          batch.
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
  const mfaBlocked = context.mfaRequired && !context.mfaVerifiedUntil;

  useEffect(() => {
    if (context.role === "member" || mfaBlocked) return;
    const abortController = new AbortController();
    Promise.all([
      listOrganizationMemberships(abortController.signal),
      listOrganizationProfiles(abortController.signal),
    ])
      .then(([membershipResult, profiles]) => {
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
      <div className="organization-pending-invitations">
        <h3>Membership Profile links</h3>
        <p className="notice notice--info">Verify Organization MFA before linking Profiles.</p>
      </div>
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

  return (
    <div className="organization-pending-invitations">
      <h3>Membership Profile links</h3>
      <p>
        Link each sign-in Membership to one Profile in this Organization. Profiles already linked to
        another Membership cannot be selected.
      </p>
      {state.status === "loading" ? <p role="status">Loading Memberships and Profiles…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Membership Profile links could not be loaded.
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {state.status === "ready" ? (
        <MembershipProfileLinkList
          busyMembershipId={busyMembershipId}
          onLink={(membership) => {
            void linkProfile(membership);
          }}
          onSelectedProfile={(membershipId, profileId) => {
            setSelectedProfiles((current) => ({ ...current, [membershipId]: profileId }));
          }}
          selectedProfiles={selectedProfiles}
          state={state}
        />
      ) : null}
    </div>
  );
}

function PendingInvitationList(props: PendingInvitationListProps) {
  return (
    <div className="organization-pending-invitations">
      <h3>Pending invitations</h3>
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
    </div>
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
  const mfaBlocked = context.mfaRequired && !context.mfaVerifiedUntil;

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
    <section
      className="account-section account-section--organization-invitations"
      aria-labelledby="organization-invitations-title"
    >
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Organization Memberships</p>
        <h2 id="organization-invitations-title">Invite a member</h2>
      </div>
      <p className="section-description">
        Invitations expire after 8 days. The recipient must sign in with the invited email before
        accepting; administrators can invite Organization Members or Administrators, while only an
        Owner can invite another Owner.
      </p>
      {mfaBlocked ? (
        <p className="notice notice--info" role="status">
          Verify Organization MFA above before creating an invitation.
        </p>
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
        </div>
        <button className="button button--primary" disabled={busy || mfaBlocked} type="submit">
          {busy ? "Creating invitation…" : "Create invitation"}
        </button>
      </form>

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
    </section>
  );
}
