import "./main.css";
import "./styles/theme.css";

import type {
  CurrentAuthSession,
  PlatformMfaStatusResponse,
  PublishedOrganizationProjection,
} from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";

import { getHealth } from "./api";
import { hasSessionHint } from "./auth/sessionHint";
import { clearPublishedOrganizationProjectionCache } from "./api/public";

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
import { JoinRosterView } from "./auth/JoinRosterView";
import { ForgotPasswordView } from "./auth/ForgotPasswordView";
import { EmailChangeConfirmationView } from "./auth/EmailChangeConfirmationView";
import { getCurrentSession, getPublishedOrganizationProjection } from "./auth/api";
import { readOAuthCompletionState, type OAuthCompletionState } from "./auth/googleAuth";
import {
  isOrganizationHost,
  resolvePostSignInResolution,
  isAuthenticatedRoute,
  type PostSignInBootstrap,
  type PostSignInLanding,
} from "./auth/postSignIn";
import { ResetPasswordView } from "./auth/ResetPasswordView";
import { SignInView } from "./auth/SignInView";
import { lazyWithRetry } from "./offline/chunkRecovery";
import { purgeCachedPlayerMetadata, purgeOfflineAudioForSource } from "./offline/mediaStore";
import { clearAuthenticatedLayoutMetadata } from "./account/layoutMetadataCache";
import { PublicUnsubscribeView } from "./public/PublicUnsubscribeView";
import { PublicPollView } from "./public/PublicPollView";
import { PublicRsvpView } from "./public/PublicRsvpView";
import { PublicAuditionView } from "./public/PublicAuditionView";
import { OrganizationLayout, PublicOrganizationSite } from "./public/PublicOrganizationSite";
import { PublicTickets } from "./public/PublicTickets";
import { PublicDonations } from "./public/PublicDonations";
import { PlatformHomeView } from "./public/PlatformHomeView";
import { PublicPrivacyPolicyView } from "./public/PublicPrivacyPolicyView";
import { PublicTermsView } from "./public/PublicTermsView";
import { SetupView } from "./setup/SetupView";

const PublicPlayerView = lazyWithRetry(() =>
  import("./public/PublicPlayerView").then((m) => ({ default: m.PublicPlayerView })),
);

type ServiceState = "checking" | "offline" | "ready";
type SessionState =
  | { readonly status: "anonymous" }
  | { readonly status: "checking" }
  | { readonly status: "error"; readonly reason: "unavailable" | "unconfirmed" }
  | { readonly session: NonNullable<CurrentAuthSession>; readonly status: "authenticated" };

interface AppLocation {
  readonly pathname: string;
  readonly search: string;
}

function readAppLocation(): AppLocation {
  return {
    pathname: window.location.pathname.replace(/\/+$/, "") || "/",
    search: window.location.search,
  };
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

function SessionCheckError({ reason }: { readonly reason: "unavailable" | "unconfirmed" }) {
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

interface AlreadySignedInProps {
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

function AlreadySignedIn({
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

function sessionBoundary(
  pathname: string,
  sessionState: SessionState,
  oauthCompletion: OAuthCompletionState,
): ReactNode {
  if (pathname !== "/login" && !isAuthenticatedRoute(pathname)) return null;
  if (sessionState.status === "error") return <SessionCheckError reason={sessionState.reason} />;
  if (sessionState.status === "checking") return <AccountLoading />;
  if (sessionState.status === "anonymous" && oauthCompletion.isOAuthComplete) {
    return <SessionCheckError reason="unconfirmed" />;
  }
  return null;
}

function organizationFallbackContent(
  sessionState: SessionState,
  oauthCompletion: OAuthCompletionState,
  finishSignIn: () => void,
  organizationName: string | null,
  onWorkspaceResolved: AlreadySignedInProps["onWorkspaceResolved"],
  baseHostname: string | null,
  baseHostnameResolved: boolean,
): ReactNode {
  if (sessionState.status === "checking") return <AccountLoading />;
  if (sessionState.status === "error") return <SessionCheckError reason={sessionState.reason} />;
  if (sessionState.status === "authenticated") {
    return (
      <AlreadySignedIn
        baseHostname={baseHostname}
        baseHostnameResolved={baseHostnameResolved}
        isOAuthComplete={oauthCompletion.isOAuthComplete}
        onWorkspaceResolved={onWorkspaceResolved}
        search={oauthCompletion.search}
        session={sessionState.session}
      />
    );
  }
  return <SignInView onSignedIn={finishSignIn} organizationName={organizationName} />;
}

function selectContent(
  pathname: string,
  resetLocation: PasswordResetLocation,
  sessionState: SessionState,
  oauthCompletion: OAuthCompletionState,
  finishSignIn: () => void,
  finishSignOut: () => void,
  finishInvitationSignIn: () => void,
  isOrganization: boolean,
  auditionHeading: string | undefined,
  organizationName: string | null,
  baseHostname: string | null,
  baseHostnameResolved: boolean,
  logoFileId: string | null,
  shellBootstrap: PostSignInBootstrap | null,
  shellPlatformMfaStatus: PlatformMfaStatusResponse | null,
  onWorkspaceResolved: AlreadySignedInProps["onWorkspaceResolved"],
): ReactNode {
  const utilityRoute = publicUtilityRoute(pathname, resetLocation, auditionHeading);
  if (utilityRoute) return utilityRoute;
  const sessionNotice = sessionBoundary(pathname, sessionState, oauthCompletion);
  if (sessionNotice) return sessionNotice;
  if (pathname === "/accept-invitation") {
    if (sessionState.status === "checking") return <AccountLoading />;
    if (sessionState.status === "authenticated") {
      return (
        <AcceptInvitationView
          invitationId={new URLSearchParams(window.location.search).get("id")}
        />
      );
    }
    return <SignInView onSignedIn={finishInvitationSignIn} organizationName={organizationName} />;
  }
  if (pathname === "/login") {
    if (sessionState.status === "authenticated") {
      return (
        <AlreadySignedIn
          baseHostname={baseHostname}
          baseHostnameResolved={baseHostnameResolved}
          isOAuthComplete={oauthCompletion.isOAuthComplete}
          onWorkspaceResolved={onWorkspaceResolved}
          search={oauthCompletion.search}
          session={sessionState.session}
        />
      );
    }
    return <SignInView onSignedIn={finishSignIn} organizationName={organizationName} />;
  }
  if (isAuthenticatedRoute(pathname)) {
    if (sessionState.status === "checking") return <AccountLoading />;
    if (sessionState.status === "authenticated") {
      if (pathname === "/setup") return <SetupView />;
      if (pathname === "/account/dashboard") return <LegacyRedirect href="/dashboard" />;
      return (
        <AuthenticatedShell
          baseHostname={baseHostname}
          baseHostnameResolved={baseHostnameResolved}
          currentSession={sessionState.session}
          initialPlatformMfaStatus={shellPlatformMfaStatus}
          initialLogoFileId={logoFileId}
          initialOrganizationName={organizationName}
          onSignedOut={finishSignOut}
          shellBootstrap={shellBootstrap}
        />
      );
    }
    return <SignInView onSignedIn={finishSignIn} organizationName={organizationName} />;
  }
  if (isOrganization) {
    return organizationFallbackContent(
      sessionState,
      oauthCompletion,
      finishSignIn,
      organizationName,
      onWorkspaceResolved,
      baseHostname,
      baseHostnameResolved,
    );
  }
  return <PlatformHomeView signedIn={sessionState.status === "authenticated"} />;
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

function isPublicWebsiteRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/history" ||
    pathname === "/performances" ||
    pathname === "/auditions" ||
    pathname === "/join"
  );
}

function isStandalonePublicRoute(pathname: string): boolean {
  return (
    pathname === "/tickets" ||
    pathname.startsWith("/tickets/") ||
    pathname === "/donate" ||
    pathname.startsWith("/donate/") ||
    pathname === "/rsvp" ||
    pathname === "/poll" ||
    pathname === "/unsubscribe" ||
    pathname === "/player" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/confirm-email-change"
  );
}

function publicUtilityRoute(
  pathname: string,
  resetLocation: PasswordResetLocation,
  auditionHeading: string | undefined,
) {
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
  if (pathname === "/auditions" || pathname === "/join") {
    return <PublicAuditionView heading={auditionHeading} />;
  }
  if (pathname === "/join-roster") {
    return <JoinRosterView />;
  }
  if (pathname === "/privacy") {
    return <PublicPrivacyPolicyView />;
  }
  if (pathname === "/terms") {
    return <PublicTermsView />;
  }
  return null;
}

function isAuditionRoute(pathname: string): boolean {
  return pathname === "/auditions" || pathname === "/join";
}

function resolveRouteRequirements(pathname: string) {
  const isPublicWebsite = isPublicWebsiteRoute(pathname);
  const isStandalone = isStandalonePublicRoute(pathname);
  const isPublic = isPublicWebsite || isStandalone;
  return {
    isPublic,
    needsProjection:
      isPublicWebsite ||
      pathname === "/login" ||
      pathname === "/accept-invitation" ||
      pathname === "/privacy" ||
      pathname === "/terms",
    needsService: !isPublic,
    needsSession: (!isStandalone && hasSessionHint()) || !isPublic,
  };
}

function initialServiceState(isPublic: boolean): ServiceState {
  return isPublic ? "ready" : "checking";
}

function initialSessionState(isPublic: boolean): SessionState {
  return !hasSessionHint() && isPublic ? { status: "anonymous" } : { status: "checking" };
}

function handleSignInLanding(
  landing: PostSignInLanding,
  bootstrap: PostSignInBootstrap | null,
  platformMfaStatus: PlatformMfaStatusResponse | null,
  session: NonNullable<CurrentAuthSession>,
  navigateWithinApp: (destination: string, replace?: boolean) => void,
  onWorkspaceResolved: AlreadySignedInProps["onWorkspaceResolved"],
  setSessionState: (state: SessionState) => void,
): void {
  if (landing.kind === "navigate" || landing.kind === "verification") {
    setSessionState({ session, status: "authenticated" });
    onWorkspaceResolved(landing.path, bootstrap, platformMfaStatus);
  } else if (landing.kind === "no_access") {
    setSessionState({ session, status: "authenticated" });
    navigateWithinApp("/account/organizations", true);
  } else {
    setSessionState({ reason: "unavailable", status: "error" });
  }
}

function renderAppContent(
  pathname: string,
  sessionState: SessionState,
  sessionChecked: boolean,
  publishedProjection: PublishedOrganizationProjection | null | undefined,
  content: ReactNode,
  productShell: ReactNode,
  allowAccountFallback: boolean,
  applyProjection: (projection: PublishedOrganizationProjection | null) => void,
): ReactNode {
  if (isAuthenticatedRoute(pathname) && sessionState.status === "authenticated") {
    return content;
  }
  if (pathname === "/" && publishedProjection === null && !sessionChecked) {
    return (
      <main className="auth-layout">
        <p className="notice notice--info" role="status">
          Loading…
        </p>
      </main>
    );
  }
  return renderPublicOrProductRoute(
    pathname,
    productShell,
    sessionState.status === "authenticated",
    publishedProjection,
    allowAccountFallback,
    applyProjection,
  );
}

function resolveDisplayName(
  isOrganization: boolean,
  pathname: string,
  organizationName: string | null,
): string {
  if (organizationName) return organizationName;
  if (!isOrganization && pathname === "/") return "Music Manager";
  return "Choir Management";
}

function renderPublicOrProductRoute(
  pathname: string,
  productShell: ReactNode,
  signedIn: boolean,
  projection: PublishedOrganizationProjection | null | undefined,
  allowAccountFallback: boolean,
  onProjectionChange: (projection: PublishedOrganizationProjection | null) => void,
) {
  if (isAuditionRoute(pathname) && projection === undefined) {
    return (
      <main className="auth-layout">
        <p className="notice notice--info" role="status">
          Loading Organization website…
        </p>
      </main>
    );
  }
  if (isAuditionRoute(pathname) && projection?.payload.settings.showBrandingHeaderFooter) {
    return (
      <OrganizationLayout pathname="/auditions" projection={projection} signedIn={signedIn}>
        <PublicAuditionView
          embedded
          heading={projection.payload.settings.pageLabels?.auditions?.heading}
        />
      </OrganizationLayout>
    );
  }
  if (pathname === "/donate" || pathname.startsWith("/donate/")) {
    return <PublicDonations pathname={pathname} />;
  }
  if (pathname === "/tickets" || pathname.startsWith("/tickets/")) {
    return <PublicTickets pathname={pathname} />;
  }
  if (pathname === "/player") {
    return (
      <Suspense fallback={null}>
        <PublicPlayerView />
      </Suspense>
    );
  }
  return isPublicOrganizationRoute(pathname) ? (
    <PublicOrganizationSite
      fallback={allowAccountFallback ? productShell : null}
      initialProjection={projection}
      onProjectionChange={onProjectionChange}
      pathname={pathname}
      signedIn={signedIn}
    />
  ) : (
    productShell
  );
}

export function App() {
  const [appLocation, setAppLocation] = useState<AppLocation>(readAppLocation);
  const pathname = appLocation.pathname;

  const initialReqs = resolveRouteRequirements(pathname);

  const [serviceState, setServiceState] = useState<ServiceState>(() =>
    initialServiceState(initialReqs.isPublic),
  );
  const [sessionState, setSessionState] = useState<SessionState>(() =>
    initialSessionState(initialReqs.isPublic),
  );
  const [sessionChecked, setSessionChecked] = useState<boolean>(false);
  const [shellBootstrap, setShellBootstrap] = useState<PostSignInBootstrap | null>(null);
  const [shellPlatformMfaStatus, setShellPlatformMfaStatus] =
    useState<PlatformMfaStatusResponse | null>(null);
  const [baseHostname, setBaseHostname] = useState<string | null>(null);
  const [publishedProjection, setPublishedProjection] =
    useState<PublishedOrganizationProjection | null>();
  const [auditionHeading, setAuditionHeading] = useState<string | undefined>();
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [logoFileId, setLogoFileId] = useState<string | null>(null);
  const [projectionVersion, setProjectionVersion] = useState<number>(1);
  const [resetLocation] = useState(() => readPasswordResetLocation(pathname));
  const [oauthCompletion] = useState(() =>
    readOAuthCompletionState(typeof window !== "undefined" ? window.location.search : ""),
  );

  const checkService = useCallback((signal?: AbortSignal) => {
    return getHealth(signal)
      .then((health) => {
        setServiceState("ready");
        setBaseHostname(health.baseHostname ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setServiceState("offline");
      });
  }, []);

  const checkSession = useCallback((signal?: AbortSignal) => {
    return getCurrentSession(signal)
      .then((session) => {
        setSessionState(session ? { session, status: "authenticated" } : { status: "anonymous" });
        setSessionChecked(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSessionState({ reason: "unavailable", status: "error" });
        setSessionChecked(true);
      });
  }, []);

  const applyProjection = useCallback((projection: PublishedOrganizationProjection | null) => {
    setPublishedProjection(projection);
    if (projection?.payload.organizationName) {
      setOrganizationName(projection.payload.organizationName);
      setAuditionHeading(projection.payload.settings.pageLabels?.auditions?.heading);
      setLogoFileId(projection.payload.settings.logoFileId ?? null);
      setProjectionVersion(projection.version);
    }
  }, []);

  const checkProjection = useCallback(
    (signal?: AbortSignal) => {
      return getPublishedOrganizationProjection(signal)
        .then((projection) => {
          applyProjection(projection);
          return projection;
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setPublishedProjection(null);
          }
          return null;
        });
    },
    [applyProjection],
  );

  const navigateWithinApp = useCallback((destination: string, replace = false) => {
    const target = new URL(destination, window.location.origin);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.href);
      return;
    }
    const url = `${target.pathname}${target.search}${target.hash}`;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setAppLocation({
      pathname: target.pathname.replace(/\/+$/, "") || "/",
      search: target.search,
    });
  }, []);

  const onWorkspaceResolved = useCallback(
    (
      path: string,
      bootstrap: PostSignInBootstrap | null,
      platformMfaStatus: PlatformMfaStatusResponse | null,
    ) => {
      setShellBootstrap(bootstrap);
      setShellPlatformMfaStatus(platformMfaStatus);
      navigateWithinApp(path, true);
    },
    [navigateWithinApp],
  );

  useEffect(() => {
    const onPopState = () => {
      const location = readAppLocation();
      if (sessionState.status === "authenticated" && isAuthenticatedRoute(location.pathname)) {
        return;
      }
      setAppLocation(location);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [sessionState.status]);

  useEffect(() => {
    const abortController = new AbortController();
    const reqs = resolveRouteRequirements(pathname);

    if (reqs.needsService) {
      void checkService(abortController.signal);
    }
    if (reqs.needsSession) {
      void checkSession(abortController.signal);
    }
    if (reqs.needsProjection) {
      void checkProjection(abortController.signal).then((projection) => {
        if (abortController.signal.aborted) return;
        if (pathname === "/" && projection === null) {
          void checkService(abortController.signal);
          void checkSession(abortController.signal);
        }
      });
    }

    return () => {
      abortController.abort();
    };
  }, [checkProjection, checkService, checkSession, pathname]);

  useEffect(() => {
    if (pathname === "/reset-password" && (window.location.search || window.location.hash)) {
      window.history.replaceState(null, "", "/reset-password");
    }
  }, [pathname]);

  function finishSignIn(destination?: string) {
    setSessionState({ status: "checking" });
    setShellBootstrap(null);
    setShellPlatformMfaStatus(null);
    void (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, 8000);
      try {
        await checkService(controller.signal);
        const session = await getCurrentSession(controller.signal);
        setSessionChecked(true);
        if (!session) {
          setSessionState({ reason: "unconfirmed", status: "error" });
          return;
        }
        if (destination) {
          setSessionState({ session, status: "authenticated" });
          setShellPlatformMfaStatus(null);
          navigateWithinApp(destination, true);
          return;
        }
        const resolution = await resolvePostSignInResolution({
          baseHostname,
          baseHostnameResolved: serviceState !== "checking",
          currentPathname: pathname,
          layoutCacheHost: window.location.host,
          layoutCacheUserId: session.user.id,
          search: window.location.search,
          signal: controller.signal,
        });
        handleSignInLanding(
          resolution.landing,
          resolution.bootstrap,
          resolution.platformMfaStatus,
          session,
          navigateWithinApp,
          onWorkspaceResolved,
          setSessionState,
        );
      } catch {
        setSessionState({ reason: "unavailable", status: "error" });
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();
  }

  function finishSignOut() {
    if (sessionState.status === "authenticated") {
      clearAuthenticatedLayoutMetadata(window.location.host, sessionState.session.user.id);
    }
    setShellBootstrap(null);
    setShellPlatformMfaStatus(null);
    setSessionState({ status: "anonymous" });
    setSessionChecked(false);
    clearPublishedOrganizationProjectionCache();
    // Purge session Offline Copies and cached player metadata before leaving: navigation
    // would otherwise cut cleanup short on shared devices. Sign-out proceeds even if cleanup fails.
    void Promise.allSettled([
      purgeOfflineAudioForSource(window.location.host, "session"),
      purgeCachedPlayerMetadata(window.location.host),
    ]).finally(() => {
      window.location.assign("/");
    });
  }

  function finishInvitationSignIn() {
    finishSignIn(`/accept-invitation${window.location.search}`);
  }

  useEffect(() => {
    if (organizationName) {
      document.title = organizationName;
    }
  }, [organizationName]);

  const isOrganization = isOrganizationHost(
    typeof window !== "undefined" ? window.location.hostname : "",
    baseHostname,
  );

  const content = selectContent(
    pathname,
    resetLocation,
    sessionState,
    oauthCompletion,
    finishSignIn,
    finishSignOut,
    finishInvitationSignIn,
    isOrganization,
    auditionHeading,
    organizationName,
    baseHostname,
    serviceState !== "checking",
    logoFileId,
    shellBootstrap,
    shellPlatformMfaStatus,
    onWorkspaceResolved,
  );

  const displayName = resolveDisplayName(isOrganization, pathname, organizationName);
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const productShell = (
    <div className="app-shell">
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
          <nav aria-label="Account">
            <a
              href={
                isOrganization
                  ? "/login"
                  : sessionState.status === "authenticated"
                    ? "/account"
                    : "/login"
              }
            >
              {sessionState.status === "authenticated"
                ? isOrganization
                  ? "Workspace"
                  : "Account"
                : "Sign in"}
            </a>
          </nav>
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

  const allowAccountFallback =
    sessionChecked &&
    (sessionState.status === "anonymous" || sessionState.status === "authenticated");

  const rendered = renderAppContent(
    pathname,
    sessionState,
    sessionChecked,
    publishedProjection,
    content,
    productShell,
    allowAccountFallback,
    applyProjection,
  );

  return <QueryClientProvider client={appQueryClient}>{rendered}</QueryClientProvider>;
}
