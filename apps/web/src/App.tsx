import type { CurrentAuthSession } from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { getHealth } from "./api";

const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});
import { AuthenticatedShell } from "./account/components/AuthenticatedShell/shell";
import { AcceptInvitationView } from "./auth/AcceptInvitationView";
import { ForgotPasswordView } from "./auth/ForgotPasswordView";
import { EmailChangeConfirmationView } from "./auth/EmailChangeConfirmationView";
import { getCurrentSession, getPublishedOrganizationProjection } from "./auth/api";
import { determinePostSignInPath, isAuthenticatedRoute } from "./auth/postSignIn";
import { ResetPasswordView } from "./auth/ResetPasswordView";
import { SignInView } from "./auth/SignInView";
import { PublicUnsubscribeView } from "./public/PublicUnsubscribeView";
import { PublicPollView } from "./public/PublicPollView";
import { PublicRsvpView } from "./public/PublicRsvpView";
import { PublicPlayerView } from "./public/PublicPlayerView";
import { PublicAuditionView } from "./public/PublicAuditionView";
import { PublicOrganizationSite } from "./public/PublicOrganizationSite";
import { PublicTickets } from "./public/PublicTickets";
import { PublicDonationView } from "./public/PublicDonationView";
import { PublicDonationSuccessView } from "./public/PublicDonationSuccessView";
import { SetupView } from "./setup/SetupView";

type ServiceState = "checking" | "offline" | "ready";
type SessionState =
  | { readonly status: "anonymous" }
  | { readonly status: "checking" }
  | { readonly status: "error" }
  | { readonly session: NonNullable<CurrentAuthSession>; readonly status: "authenticated" };

const moduleCards = [
  {
    description: "Rosters, member profiles, voice parts, directory preferences, and dues tracking.",
    title: "People",
  },
  {
    description: "Rehearsals, performances, attendance tracking, calendars, and seating charts.",
    title: "Events",
  },
  {
    description: "Music library, practice resources, communications, polls, and ticketing.",
    title: "Programs",
  },
] as const;

function HomeView({ signedIn }: { readonly signedIn: boolean }) {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">Choir Management</p>
          <h1 id="hero-title">One calm place to keep your choir moving together.</h1>
          <p className="hero__lede">
            A simple, secure platform for rehearsals, performances, roster coordination, and public
            events.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href={signedIn ? "/account" : "/login"}>
              {signedIn ? "Open your account" : "Sign in"}
            </a>
            <a className="button button--secondary" href="#features">
              Explore features
            </a>
          </div>
        </div>
      </section>

      <section className="foundation" id="features" aria-labelledby="features-title">
        <div className="section-heading">
          <p className="eyebrow">Overview</p>
          <h2 id="features-title">Designed for choral ensembles.</h2>
          <p>
            Keep your singers, music, rehearsals, and performances organized in one dedicated
            workspace.
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
  const [targetHref, setTargetHref] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void determinePostSignInPath({
      currentPathname: window.location.pathname,
      search: window.location.search,
      signal: controller.signal,
    })
      .then((path) => {
        if (!controller.signal.aborted) {
          setTargetHref(path);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTargetHref("/dashboard");
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  const href = targetHref ?? "/dashboard";
  const isAdmin = targetHref === "/admin" || targetHref?.startsWith("/admin/") === true;
  const targetLabel =
    targetHref === null
      ? "Open your workspace"
      : isAdmin
        ? "Open admin dashboard"
        : "Open your workspace";

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="already-signed-in-title">
        <p className="eyebrow">Account recognized</p>
        <h1 id="already-signed-in-title">You are already signed in.</h1>
        <p className="auth-card__intro">Continue as {session.user.email}.</p>
        <a className="button button--primary" href={href}>
          {targetLabel}
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

function selectContent(
  pathname: string,
  resetLocation: PasswordResetLocation,
  sessionState: SessionState,
  finishSignIn: () => void,
  finishSignOut: () => void,
  finishInvitationSignIn: () => void,
): ReactNode {
  const utilityRoute = publicUtilityRoute(pathname, resetLocation);
  if (utilityRoute) return utilityRoute;
  if (pathname === "/accept-invitation") {
    if (sessionState.status === "checking") return <AccountLoading />;
    if (sessionState.status === "authenticated") {
      return (
        <AcceptInvitationView
          invitationId={new URLSearchParams(window.location.search).get("id")}
        />
      );
    }
    return <SignInView onSignedIn={finishInvitationSignIn} />;
  }
  if (pathname === "/login") {
    if (sessionState.status === "authenticated") {
      return <AlreadySignedIn session={sessionState.session} />;
    }
    return <SignInView onSignedIn={finishSignIn} />;
  }
  if (isAuthenticatedRoute(pathname)) {
    if (sessionState.status === "checking") return <AccountLoading />;
    if (sessionState.status === "authenticated") {
      if (pathname === "/setup") return <SetupView />;
      if (pathname === "/account/dashboard") return <LegacyRedirect href="/dashboard" />;
      return (
        <AuthenticatedShell currentSession={sessionState.session} onSignedOut={finishSignOut} />
      );
    }
    return <SignInView onSignedIn={finishSignIn} />;
  }
  return <HomeView signedIn={sessionState.status === "authenticated"} />;
}

function LegacyRedirect({ href }: { readonly href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return <AccountLoading />;
}

function isPublicOrganizationRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/history" || pathname === "/performances";
}

function publicUtilityRoute(pathname: string, resetLocation: PasswordResetLocation) {
  const recovery = passwordRecoveryRoute(pathname, resetLocation);
  if (recovery) return recovery;
  if (pathname === "/unsubscribe") {
    return (
      <PublicUnsubscribeView token={new URLSearchParams(window.location.search).get("token")} />
    );
  }
  if (pathname === "/confirm-email-change") {
    return (
      <EmailChangeConfirmationView
        token={new URLSearchParams(window.location.search).get("token")}
      />
    );
  }
  if (pathname === "/rsvp") {
    return <PublicRsvpView />;
  }
  if (pathname === "/poll") {
    return <PublicPollView />;
  }
  if (pathname === "/player") {
    return <PublicPlayerView />;
  }
  if (pathname === "/auditions" || pathname === "/join") {
    return <PublicAuditionView />;
  }
  return null;
}

function renderPublicOrProductRoute(pathname: string, productShell: ReactNode, signedIn: boolean) {
  if (pathname === "/donate") {
    return <PublicDonationView />;
  }
  if (pathname === "/donate/success") {
    return <PublicDonationSuccessView />;
  }
  if (pathname === "/tickets" || pathname.startsWith("/tickets/")) {
    return <PublicTickets pathname={pathname} />;
  }
  return isPublicOrganizationRoute(pathname) ? (
    <PublicOrganizationSite fallback={productShell} pathname={pathname} signedIn={signedIn} />
  ) : (
    productShell
  );
}

export function App() {
  const [serviceState, setServiceState] = useState<ServiceState>("checking");
  const [sessionState, setSessionState] = useState<SessionState>({ status: "checking" });
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [logoFileId, setLogoFileId] = useState<string | null>(null);
  const [projectionVersion, setProjectionVersion] = useState<number>(1);
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const [resetLocation] = useState(() => readPasswordResetLocation(pathname));

  useEffect(() => {
    const abortController = new AbortController();

    async function checkService() {
      try {
        await getHealth(abortController.signal);
        setServiceState("ready");
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

    async function checkProjection() {
      try {
        const projection = await getPublishedOrganizationProjection(abortController.signal);
        if (projection?.payload.organizationName) {
          setOrganizationName(projection.payload.organizationName);
          setLogoFileId(projection.payload.settings.logoFileId ?? null);
          setProjectionVersion(projection.version);
        }
      } catch {
        // Fall back gracefully to default branding if projection is not published or unavailable.
      }
    }

    void Promise.all([checkService(), checkSession(), checkProjection()]);
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
    setSessionState({ status: "checking" });
    void (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, 8000);
      try {
        const nextPath = await determinePostSignInPath({
          currentPathname: pathname,
          search: window.location.search,
          signal: controller.signal,
        });
        window.location.assign(nextPath);
      } catch {
        window.location.assign("/dashboard");
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();
  }

  function finishSignOut() {
    setSessionState({ status: "anonymous" });
    window.location.assign("/");
  }

  function finishInvitationSignIn() {
    window.location.assign(`/accept-invitation${window.location.search}`);
  }

  const content = selectContent(
    pathname,
    resetLocation,
    sessionState,
    finishSignIn,
    finishSignOut,
    finishInvitationSignIn,
  );

  const displayName = organizationName ?? "Choir Management";
  const initials = organizationName
    ? organizationName
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "CM";

  const isPlayerRoute = pathname === "/player";

  const productShell = (
    <div className={`app-shell ${isPlayerRoute ? "app-shell--player" : ""}`}>
      <header className="site-header">
        <a className="brand" href="/" aria-label={`${displayName} home`}>
          {logoFileId ? (
            <img
              src={`/api/public/media/${String(projectionVersion)}/${encodeURIComponent(logoFileId)}`}
              alt=""
              className="brand-logo"
            />
          ) : (
            <span className="brand-mark" aria-hidden="true">
              {initials}
            </span>
          )}
          <span>{displayName}</span>
        </a>
        <div className="header-actions">
          {serviceState === "offline" ? (
            <span className="service-status service-status--offline" role="status">
              <span aria-hidden="true" className="service-status__dot" />
              Service unavailable
            </span>
          ) : null}
          {!isPlayerRoute ? (
            <nav aria-label="Account">
              <a href={sessionState.status === "authenticated" ? "/account" : "/login"}>
                {sessionState.status === "authenticated" ? "Account" : "Sign in"}
              </a>
            </nav>
          ) : null}
        </div>
      </header>

      {content}

      <footer>
        <p>
          © {new Date().getFullYear()} {displayName}. All rights reserved.
        </p>
      </footer>
    </div>
  );

  const rendered =
    isAuthenticatedRoute(pathname) && sessionState.status === "authenticated"
      ? content
      : renderPublicOrProductRoute(pathname, productShell, sessionState.status === "authenticated");

  return <QueryClientProvider client={appQueryClient}>{rendered}</QueryClientProvider>;
}
