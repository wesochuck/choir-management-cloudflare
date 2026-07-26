import type { AccountOrganization, AuthSession, CurrentAuthSession } from "@choir/contracts";
import { useEffect, useState } from "react";

import { listAccountOrganizations, listActiveSessions, revokeSession, signOut } from "../auth/api";

interface AccountViewProps {
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly onSignedOut: () => void;
  readonly section?: "organizations" | "overview" | "sessions";
}

interface AccountResources {
  readonly organizations: readonly AccountOrganization[];
  readonly sessions: readonly AuthSession[];
}

type ResourceState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | ({ readonly status: "ready" } & AccountResources);

function displayDate(value: number | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function organizationHref(hostname: string): string {
  const protocol = hostname === "localhost" || hostname.endsWith(".localhost") ? "http:" : "https:";
  return `${protocol}//${hostname}`;
}

function organizationRoleLabel(role: AccountOrganization["role"]): string {
  switch (role) {
    case "administrator":
      return "Organization Administrator";
    case "member":
      return "Organization Member";
    case "owner":
      return "Organization Owner";
  }
}

function sessionLabel(session: AuthSession, isCurrent: boolean): string {
  if (isCurrent) {
    return "Current browser";
  }
  const userAgent = session.userAgent?.trim();
  return userAgent && userAgent.length > 0 ? userAgent : "Another signed-in browser";
}

export function AccountView({
  currentSession,
  onSignedOut,
  section = "overview",
}: AccountViewProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceState>(() =>
    section === "overview"
      ? { organizations: [], sessions: [], status: "ready" }
      : { status: "loading" },
  );
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (section === "overview") {
      return;
    }
    const abortController = new AbortController();
    const request =
      section === "organizations"
        ? listAccountOrganizations(abortController.signal).then((organizations) => ({
            organizations,
            sessions: [],
          }))
        : listActiveSessions(abortController.signal).then((sessions) => ({
            organizations: [],
            sessions,
          }));
    request
      .then(({ organizations, sessions }) => {
        setResources({ organizations, sessions, status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setResources({ status: "error" });
      });
    return () => {
      abortController.abort();
    };
  }, [section]);

  async function handleSignOut() {
    setActionError(null);
    setSigningOut(true);
    try {
      await signOut();
      onSignedOut();
    } catch {
      setActionError("This browser could not be signed out. Please try again.");
      setSigningOut(false);
    }
  }

  async function handleRevoke(session: AuthSession) {
    setActionError(null);
    setBusySessionId(session.id);
    try {
      await revokeSession(session.token);
      if (session.id === currentSession.session.id) {
        onSignedOut();
        return;
      }
      setResources((current) =>
        current.status === "ready"
          ? {
              ...current,
              sessions: current.sessions.filter((candidate) => candidate.id !== session.id),
            }
          : current,
      );
    } catch {
      setActionError("That session could not be revoked. Refresh and try again.");
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <main className="account-layout">
      <div className="account-heading">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Welcome, {currentSession.user.name || currentSession.user.email}.</h1>
          <p>{currentSession.user.email}</p>
        </div>
        <button
          className="button button--secondary"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          type="button"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>

      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}

      {resources.status === "loading" ? (
        <p className="notice notice--info" role="status">
          Loading your Organizations and sessions…
        </p>
      ) : null}
      {resources.status === "error" ? (
        <div className="notice notice--error" role="alert">
          <p>Your account details could not be loaded.</p>
          <button
            className="text-button"
            onClick={() => {
              window.location.reload();
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}

      {resources.status === "ready" ? (
        <div className="account-grid">
          {section === "overview" ? (
            <>
              <a className="workspace-card" href="/account/organizations">
                <span className="workspace-card__icon" aria-hidden="true">
                  ◉
                </span>
                <span>
                  <strong>Your Organizations</strong>
                  <small>Switch between your Organization Memberships.</small>
                </span>
              </a>
              <a className="workspace-card" href="/account/security">
                <span className="workspace-card__icon" aria-hidden="true">
                  ◇
                </span>
                <span>
                  <strong>Sign-in &amp; security</strong>
                  <small>Manage your password and authentication options.</small>
                </span>
              </a>
              <a className="workspace-card" href="/account/sessions">
                <span className="workspace-card__icon" aria-hidden="true">
                  ◎
                </span>
                <span>
                  <strong>Active sessions</strong>
                  <small>Review and revoke signed-in browsers.</small>
                </span>
              </a>
            </>
          ) : null}
          {section === "organizations" ? (
            <section className="account-section" aria-labelledby="organizations-title">
              <div className="section-heading section-heading--compact">
                <p className="eyebrow">Memberships</p>
                <h2 id="organizations-title">Your Organizations</h2>
              </div>
              {resources.organizations.length === 0 ? (
                <p className="empty-state">
                  You do not have an active Organization Membership yet. Ask the person who invited
                  you to confirm your access.
                </p>
              ) : (
                <ul className="account-list account-list--organizations">
                  {resources.organizations.map((organization) => {
                    const available =
                      organization.canonicalStatus === "active" &&
                      organization.lifecycleState === "active";
                    return (
                      <li key={organization.organizationId}>
                        <div>
                          <h3>{organization.name}</h3>
                          <p>{organizationRoleLabel(organization.role)}</p>
                        </div>
                        {available ? (
                          <a
                            className="button button--secondary"
                            href={organizationHref(organization.canonicalHostname)}
                          >
                            Open {organization.name}
                          </a>
                        ) : (
                          <span className="status-pill">Setup pending</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          {section === "sessions" ? (
            <section className="account-section" aria-labelledby="sessions-title">
              <div className="section-heading section-heading--compact">
                <p className="eyebrow">Security</p>
                <h2 id="sessions-title">Active sessions</h2>
              </div>
              <p className="section-description">
                Revoke a browser you no longer recognize. Session tokens are never displayed or
                saved by this page.
              </p>
              <ul className="account-list">
                {resources.sessions.map((session) => {
                  const isCurrent = session.id === currentSession.session.id;
                  const label = sessionLabel(session, isCurrent);
                  return (
                    <li aria-label={`Session: ${label}`} key={session.id}>
                      <div>
                        <h3>{label}</h3>
                        <p>Expires {displayDate(session.expiresAt)}</p>
                        {session.ipAddress ? <p>Last IP address: {session.ipAddress}</p> : null}
                      </div>
                      <button
                        className={isCurrent ? "button button--secondary" : "button button--danger"}
                        disabled={busySessionId !== null}
                        onClick={() => void handleRevoke(session)}
                        type="button"
                      >
                        {busySessionId === session.id
                          ? "Revoking…"
                          : isCurrent
                            ? "Sign out this browser"
                            : "Revoke session"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
