import type { OrganizationInvitationDetails } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  acceptOrganizationInvitation,
  getOrganizationInvitation,
  rejectOrganizationInvitation,
} from "./api";

type InvitationState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly invitation: OrganizationInvitationDetails; readonly status: "ready" }
  | {
      readonly organizationName: string;
      readonly outcome: "accepted" | "rejected";
      readonly status: "success";
    };

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function roleLabel(role: OrganizationInvitationDetails["role"]): string {
  switch (role) {
    case "administrator":
      return "Organization Administrator";
    case "member":
      return "Organization Member";
    case "owner":
      return "Organization Owner";
  }
}

function validInvitationId(value: string | null): value is string {
  return (
    value !== null && value.length >= 1 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export function AcceptInvitationView({ invitationId }: { readonly invitationId: string | null }) {
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [state, setState] = useState<InvitationState>(
    validInvitationId(invitationId) ? { status: "loading" } : { status: "error" },
  );

  useEffect(() => {
    if (!validInvitationId(invitationId)) {
      return;
    }
    const abortController = new AbortController();
    getOrganizationInvitation(invitationId, abortController.signal)
      .then((invitation) => {
        setState({ invitation, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [invitationId]);

  async function acceptInvitation() {
    if (state.status !== "ready") {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      await acceptOrganizationInvitation(state.invitation.id);
      setState({
        organizationName: state.invitation.organizationName,
        outcome: "accepted",
        status: "success",
      });
    } catch {
      setErrorMessage(
        "This invitation could not be accepted. It may have expired, been replaced, or belong to another signed-in email.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function rejectInvitation() {
    if (state.status !== "ready") {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      await rejectOrganizationInvitation(state.invitation.id);
      setState({
        organizationName: state.invitation.organizationName,
        outcome: "rejected",
        status: "success",
      });
    } catch {
      setErrorMessage(
        "This invitation could not be declined. It may have expired, been replaced, or belong to another signed-in email.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return (
      <main className="auth-layout">
        <p className="notice notice--info" role="status">
          Checking your Organization invitation…
        </p>
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="invitation-unavailable-title">
          <h1 id="invitation-unavailable-title">This invitation cannot be opened.</h1>
          <p className="notice notice--error" role="alert">
            It may have expired, been replaced, or belong to another signed-in email.
          </p>
          <a className="button button--secondary" href="/account">
            Open your account
          </a>
        </section>
      </main>
    );
  }
  if (state.status === "success") {
    const accepted = state.outcome === "accepted";
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="invitation-accepted-title">
          <h1 id="invitation-accepted-title">
            {accepted ? `You joined ${state.organizationName}.` : "Invitation declined."}
          </h1>
          <p className="notice notice--success" role="status">
            {accepted
              ? "Your Organization Membership is ready."
              : `You did not join ${state.organizationName}.`}
          </p>
          <a className="button button--primary" href="/account">
            Open your account
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="invitation-title">
        <h1 id="invitation-title">Join {state.invitation.organizationName}.</h1>
        <dl className="invitation-details">
          <div>
            <dt>Invited email</dt>
            <dd>{state.invitation.email}</dd>
          </div>
          <div>
            <dt>Organization role</dt>
            <dd>{roleLabel(state.invitation.role)}</dd>
          </div>
          <div>
            <dt>Invited by</dt>
            <dd>{state.invitation.inviterEmail}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{displayDate(state.invitation.expiresAt)}</dd>
          </div>
        </dl>
        {errorMessage ? (
          <p className="notice notice--error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <button
          className="button button--primary"
          disabled={busy}
          onClick={() => {
            void acceptInvitation();
          }}
          type="button"
        >
          {busy ? "Accepting invitation…" : "Accept Organization invitation"}
        </button>
        {confirmReject ? (
          <div className="danger-confirmation" role="group" aria-label="Confirm invitation decline">
            <p>
              Decline this Organization invitation? You will need a new invitation to join later.
            </p>
            <div className="form-actions">
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={() => {
                  setConfirmReject(false);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button--danger"
                disabled={busy}
                onClick={() => {
                  void rejectInvitation();
                }}
                type="button"
              >
                {busy ? "Declining invitation…" : "Confirm: decline invitation"}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => {
              setConfirmReject(true);
            }}
            type="button"
          >
            Decline invitation
          </button>
        )}
      </section>
    </main>
  );
}
