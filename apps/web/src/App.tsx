import { healthResponseSchema, type CurrentAuthSession } from "@choir/contracts";
import { useEffect, useState } from "react";

import { AccountView } from "./account/AccountView";
import { AcceptInvitationView } from "./auth/AcceptInvitationView";
import { ForgotPasswordView } from "./auth/ForgotPasswordView";
import { getCurrentSession } from "./auth/api";
import { ResetPasswordView } from "./auth/ResetPasswordView";
import { SignInView } from "./auth/SignInView";
import { PublicUnsubscribeView } from "./public/PublicUnsubscribeView";

type ServiceState = "checking" | "offline" | "ready";
type SessionState =
  | { readonly status: "anonymous" }
  | { readonly status: "checking" }
  | { readonly status: "error" }
  | { readonly session: NonNullable<CurrentAuthSession>; readonly status: "authenticated" };

const moduleCards = [
  {
    description: "Profiles, invitations, voice parts, directory preferences, seasons, and dues.",
    title: "People",
  },
  {
    description: "Performances, rehearsals, RSVPs, attendance, calendars, reports, and seating.",
    title: "Events",
  },
  {
    description: "Music, resources, messages, polls, auditions, tickets, and donations.",
    title: "Programs",
  },
] as const;

function HomeView({ signedIn }: { readonly signedIn: boolean }) {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">The next home for your Organization</p>
          <h1 id="hero-title">One calm place to keep a choir moving together.</h1>
          <p className="hero__lede">
            The Cloudflare rebuild is taking shape as a secure, accessible home for every rehearsal,
            performance, person, and public experience.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href={signedIn ? "/account" : "/login"}>
              {signedIn ? "Open your account" : "Sign in"}
            </a>
            <a className="button button--secondary" href="#foundation">
              Explore the foundation
            </a>
          </div>
        </div>
        <div className="hero__art" aria-label="Abstract layered choir risers">
          <div className="voice voice--one">S</div>
          <div className="voice voice--two">A</div>
          <div className="voice voice--three">T</div>
          <div className="voice voice--four">B</div>
        </div>
      </section>

      <section className="foundation" id="foundation" aria-labelledby="foundation-title">
        <div className="section-heading">
          <p className="eyebrow">Foundation first</p>
          <h2 id="foundation-title">Built around each Organization.</h2>
          <p>
            Operational data stays inside its Organization boundary while the public site remains
            fast at the edge.
          </p>
        </div>
        <div className="module-grid">
          {moduleCards.map((module, index) => (
            <article className="module-card" key={module.title}>
              <span className="module-card__index" aria-hidden="true">
                0{index + 1}
              </span>
              <h3>{module.title}</h3>
              <p>{module.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function AccountLoading() {
  return (
    <main className="account-layout">
      <p className="notice notice--info" role="status">
        Checking your account…
      </p>
    </main>
  );
}

function AlreadySignedIn({ session }: { readonly session: NonNullable<CurrentAuthSession> }) {
  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="already-signed-in-title">
        <p className="eyebrow">Account recognized</p>
        <h1 id="already-signed-in-title">You are already signed in.</h1>
        <p className="auth-card__intro">Continue as {session.user.email}.</p>
        <a className="button button--primary" href="/account">
          Open your account
        </a>
      </section>
    </main>
  );
}

interface PasswordResetLocation {
  readonly error: string | null;
  readonly token: string | null;
}

function readPasswordResetLocation(pathname: string): PasswordResetLocation {
  if (pathname !== "/reset-password") {
    return { error: null, token: null };
  }
  const search = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const result = {
    error: search.get("error"),
    token: fragment.get("token") ?? search.get("token"),
  };
  return result;
}

function passwordRecoveryRoute(pathname: string, resetLocation: PasswordResetLocation) {
  if (pathname === "/forgot-password") {
    return <ForgotPasswordView />;
  }
  if (pathname === "/reset-password") {
    return <ResetPasswordView error={resetLocation.error} token={resetLocation.token} />;
  }
  return null;
}

function isAccountRoute(pathname: string): boolean {
  return pathname === "/account" || pathname === "/admin/communications";
}

function publicUtilityRoute(pathname: string, resetLocation: PasswordResetLocation) {
  const recovery = passwordRecoveryRoute(pathname, resetLocation);
  if (recovery) return recovery;
  if (pathname === "/unsubscribe") {
    return (
      <PublicUnsubscribeView token={new URLSearchParams(window.location.search).get("token")} />
    );
  }
  return null;
}

export function App() {
  const [serviceState, setServiceState] = useState<ServiceState>("checking");
  const [sessionState, setSessionState] = useState<SessionState>({ status: "checking" });
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const [resetLocation] = useState(() => readPasswordResetLocation(pathname));

  useEffect(() => {
    const abortController = new AbortController();

    async function checkService() {
      try {
        const response = await fetch("/api/health", {
          headers: { accept: "application/json" },
          signal: abortController.signal,
        });
        const body: unknown = await response.json();
        setServiceState(
          response.ok && healthResponseSchema.safeParse(body).success ? "ready" : "offline",
        );
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setServiceState("offline");
      }
    }

    async function checkSession() {
      try {
        const session = await getCurrentSession(abortController.signal);
        setSessionState(session ? { session, status: "authenticated" } : { status: "anonymous" });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSessionState({ status: "error" });
      }
    }

    void Promise.all([checkService(), checkSession()]);
    return () => {
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    if (pathname === "/reset-password" && (window.location.search || window.location.hash)) {
      window.history.replaceState(null, "", "/reset-password");
    }
  }, [pathname]);

  function finishSignIn() {
    window.location.assign("/account");
  }

  function finishSignOut() {
    setSessionState({ status: "anonymous" });
    window.location.assign("/");
  }

  function finishInvitationSignIn() {
    window.location.assign(`/accept-invitation${window.location.search}`);
  }

  let content;
  const utilityRoute = publicUtilityRoute(pathname, resetLocation);
  if (utilityRoute) {
    content = utilityRoute;
  } else if (pathname === "/accept-invitation") {
    content =
      sessionState.status === "checking" ? (
        <AccountLoading />
      ) : sessionState.status === "authenticated" ? (
        <AcceptInvitationView
          invitationId={new URLSearchParams(window.location.search).get("id")}
        />
      ) : (
        <SignInView onSignedIn={finishInvitationSignIn} />
      );
  } else if (pathname === "/login") {
    content =
      sessionState.status === "authenticated" ? (
        <AlreadySignedIn session={sessionState.session} />
      ) : (
        <SignInView onSignedIn={finishSignIn} />
      );
  } else if (isAccountRoute(pathname)) {
    content =
      sessionState.status === "checking" ? (
        <AccountLoading />
      ) : sessionState.status === "authenticated" ? (
        <AccountView currentSession={sessionState.session} onSignedOut={finishSignOut} />
      ) : (
        <SignInView onSignedIn={finishSignIn} />
      );
  } else {
    content = <HomeView signedIn={sessionState.status === "authenticated"} />;
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Choir Management home">
          <span className="brand-mark" aria-hidden="true">
            CM
          </span>
          <span>Choir Management</span>
        </a>
        <div className="header-actions">
          <span className={`service-status service-status--${serviceState}`} role="status">
            <span aria-hidden="true" className="service-status__dot" />
            {serviceState === "checking"
              ? "Checking service"
              : serviceState === "ready"
                ? "Staging ready"
                : "Service unavailable"}
          </span>
          <nav aria-label="Account">
            <a href={sessionState.status === "authenticated" ? "/account" : "/login"}>
              {sessionState.status === "authenticated" ? "Account" : "Sign in"}
            </a>
          </nav>
        </div>
      </header>

      {content}

      <footer>
        <p>Permanent staging · no production launch</p>
      </footer>
    </div>
  );
}
