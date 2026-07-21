import {
  organizationInvitationRequestSchema,
  type OrganizationAuthStatusResponse,
} from "@choir/contracts";
import { useState } from "react";

import { AuthApiError, createOrganizationInvitation } from "../auth/api";

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function OrganizationInvitations({
  context,
}: {
  readonly context: OrganizationAuthStatusResponse;
}) {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [role, setRole] = useState<"administrator" | "member" | "owner">("member");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (context.role === "member") {
    return null;
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

  const mfaBlocked = context.mfaRequired && !context.mfaVerifiedUntil;
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
        Invitations expire after 48 hours. The recipient must sign in with the invited email before
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
              const nextRole = event.target.value;
              setRole(
                nextRole === "owner"
                  ? "owner"
                  : nextRole === "administrator"
                    ? "administrator"
                    : "member",
              );
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
    </section>
  );
}
