import {
  organizationInvitationRequestSchema,
  type OrganizationAuthStatusResponse,
  type OrganizationInvitationRole,
  type OrganizationInvitationSummary,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  cancelOrganizationInvitation,
  createOrganizationInvitation,
  listOrganizationInvitations,
} from "../auth/api";
import { MembershipProfileLinks } from "./MembershipProfileLinks";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { RosterInviteLinksSection } from "./components/RosterPage/RosterInviteLinksSection";

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
    <>
      <div className="page-heading">
        <div>
          <h1>Membership invitations</h1>
          <p className="page-heading__description">
            Invite new members, managers, and administrators to the organization.
          </p>
        </div>
      </div>
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
                {context.role === "owner" ? (
                  <option value="owner">Organization Owner</option>
                ) : null}
              </select>
              <p className="field-help" id="organization-invitation-role-help">
                These are Organization Membership roles, not Profile roles. Members can use
                member-facing features. Administrators can manage the Organization&apos;s
                operational data, Profiles, Memberships, and invitations. Owners have Administrator
                access plus owner-only controls such as Organization MFA, Public Website domains,
                and Owner invitations.
              </p>
            </div>
            <button className="button button--primary" disabled={busy || mfaBlocked} type="submit">
              {busy ? "Creating invitation…" : "Create invitation"}
            </button>
          </form>
        </fieldset>

        <RosterInviteLinksSection mfaBlocked={mfaBlocked} />

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
    </>
  );
}
