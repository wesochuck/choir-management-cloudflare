import type { CurrentAuthSession, PlatformMfaStatusResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  resolvePostSignInResolution,
  type PostSignInBootstrap,
  type PostSignInLanding,
} from "./postSignIn";

export function AccountLoading() {
  return (
    <main className="account-layout">
      <p className="notice notice--info" role="status">
        Checking your account…
      </p>
    </main>
  );
}

export function LegacyRedirect({ href }: { readonly href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return <AccountLoading />;
}

export function SessionCheckError({ reason }: { readonly reason: "unavailable" | "unconfirmed" }) {
  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="session-error-title">
        <h1 id="session-error-title">We couldn’t confirm your sign-in.</h1>
        <p className="notice notice--error" role="alert">
          {reason === "unconfirmed"
            ? "Sign-in completed, but no valid session was found. Check that cookies are allowed for this site, then try again."
            : "The account service could not check your session. Please retry before signing in again."}
        </p>
        <button
          className="button button--primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          Retry session check
        </button>
        <a className="button button--secondary" href="/login">
          Return to sign in
        </a>
      </section>
    </main>
  );
}

export interface AlreadySignedInProps {
  readonly baseHostname: string | null;
  readonly baseHostnameResolved: boolean;
  readonly isOAuthComplete: boolean;
  readonly onWorkspaceResolved: (
    path: string,
    bootstrap: PostSignInBootstrap | null,
    platformMfaStatus: PlatformMfaStatusResponse | null,
  ) => void;
  readonly search: string;
  readonly session: NonNullable<CurrentAuthSession>;
}

export function AlreadySignedIn({
  baseHostname,
  baseHostnameResolved,
  isOAuthComplete,
  onWorkspaceResolved,
  search,
  session,
}: AlreadySignedInProps) {
  const [landing, setLanding] = useState<PostSignInLanding | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void resolvePostSignInResolution({
      baseHostname,
      baseHostnameResolved,
      currentPathname: window.location.pathname,
      layoutCacheHost: window.location.host,
      layoutCacheUserId: session.user.id,
      search,
      signal: controller.signal,
    })
      .then(({ bootstrap, landing: resolved, platformMfaStatus }) => {
        if (controller.signal.aborted) return;
        setLanding(resolved);
        // Every already-signed-in visit to /login (plain or OAuth completion)
        // enters the resolved workspace directly; no interstitial click.
        if (resolved.kind === "navigate" || resolved.kind === "verification") {
          onWorkspaceResolved(resolved.path, bootstrap, platformMfaStatus);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLanding({ kind: "unavailable" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [
    baseHostname,
    baseHostnameResolved,
    isOAuthComplete,
    onWorkspaceResolved,
    search,
    session.user.id,
  ]);

  if (landing?.kind === "no_access") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="already-signed-in-title">
          <h1 id="already-signed-in-title">No access to this Organization.</h1>
          <p className="auth-card__intro">
            You are signed in as {session.user.email}, but that identity does not have access to
            this Organization. Choose an Organization you belong to instead.
          </p>
          <a className="button button--primary" href="/account/organizations">
            Choose an Organization
          </a>
          <a className="button button--secondary" href="/">
            Visit the public website
          </a>
        </section>
      </main>
    );
  }

  if (landing?.kind === "unavailable") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="already-signed-in-title">
          <h1 id="already-signed-in-title">We couldn’t confirm your workspace.</h1>
          <p className="auth-card__intro">Continue as {session.user.email}.</p>
          <button
            className="button button--primary"
            onClick={() => {
              window.location.reload();
            }}
            type="button"
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="already-signed-in-title">
        <h1 id="already-signed-in-title">You are already signed in.</h1>
        <p className="auth-card__intro" role="status">
          Continue as {session.user.email}. Opening your workspace…
        </p>
      </section>
    </main>
  );
}
