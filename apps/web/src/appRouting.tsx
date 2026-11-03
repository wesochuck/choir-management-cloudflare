import {
  isPublicContentPath,
  type CurrentAuthSession,
  type PlatformMfaStatusResponse,
  type PublishedOrganizationProjection,
} from "@choir/contracts";
import { Suspense, type ReactNode } from "react";

import { AuthenticatedShell } from "./account/components/AuthenticatedShell/shell";
import { AcceptInvitationView } from "./auth/AcceptInvitationView";
import { EmailChangeConfirmationView } from "./auth/EmailChangeConfirmationView";
import { ForgotPasswordView } from "./auth/ForgotPasswordView";
import type { OAuthCompletionState } from "./auth/googleAuth";
import { JoinRosterView } from "./auth/JoinRosterView";
import {
  isAuthenticatedRoute,
  type PostSignInBootstrap,
  type PostSignInLanding,
} from "./auth/postSignIn";
import { ResetPasswordView } from "./auth/ResetPasswordView";
import {
  AccountLoading,
  AlreadySignedIn,
  LegacyRedirect,
  SessionCheckError,
  type AlreadySignedInProps,
} from "./auth/SessionBoundaryViews";
import { hasSessionHint } from "./auth/sessionHint";
import { SignInView } from "./auth/SignInView";
import { lazyWithRetry } from "./offline/chunkRecovery";
import { PlatformHomeView } from "./public/PlatformHomeView";
import { PublicAuditionView } from "./public/PublicAuditionView";
import { PublicDonations } from "./public/PublicDonations";
import { OrganizationLayout, PublicOrganizationSite } from "./public/PublicOrganizationSite";
import { PublicPollView } from "./public/PublicPollView";
import { PublicPrivacyPolicyView } from "./public/PublicPrivacyPolicyView";
import { PublicRsvpView } from "./public/PublicRsvpView";
import { PublicTermsView } from "./public/PublicTermsView";
import { PublicTickets } from "./public/PublicTickets";
import { PublicUnsubscribeView } from "./public/PublicUnsubscribeView";
import { SetupView } from "./setup/SetupView";

const PublicCheckoutReminderView = lazyWithRetry(() =>
  import("./public/PublicCheckoutReminderView").then((m) => ({
    default: m.PublicCheckoutReminderView,
  })),
);

const PublicPlayerView = lazyWithRetry(() =>
  import("./public/PublicPlayerView").then((m) => ({ default: m.PublicPlayerView })),
);

export type ServiceState = "checking" | "offline" | "ready";
export type SessionState =
  | { readonly status: "anonymous" }
  | { readonly status: "checking" }
  | { readonly status: "error"; readonly reason: "unavailable" | "unconfirmed" }
  | { readonly session: NonNullable<CurrentAuthSession>; readonly status: "authenticated" };

export interface AppLocation {
  readonly pathname: string;
  readonly search: string;
}

export function readAppLocation(): AppLocation {
  return {
    pathname: window.location.pathname.replace(/\/+$/, "") || "/",
    search: window.location.search,
  };
}

export interface PasswordResetLocation {
  readonly error: string | null;
  readonly token: string | null;
}

export function readPasswordResetLocation(pathname: string): PasswordResetLocation {
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

export function selectContent(
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

function isPublicOrganizationRoute(pathname: string): boolean {
  return pathname === "/" || isPublicContentPath(pathname) || pathname === "/performances";
}

function isPublicWebsiteRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    isPublicContentPath(pathname) ||
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
    pathname === "/checkout/return" ||
    pathname === "/checkout/reminders/stop" ||
    pathname === "/player" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/confirm-email-change" ||
    pathname === "/join-roster"
  );
}

function publicUtilityRoute(
  pathname: string,
  resetLocation: PasswordResetLocation,
  auditionHeading: string | undefined,
) {
  const recovery = passwordRecoveryRoute(pathname, resetLocation);
  if (recovery) return recovery;
  if (pathname === "/checkout/return" || pathname === "/checkout/reminders/stop") {
    return (
      <Suspense fallback={<p role="status">Loading checkout…</p>}>
        <PublicCheckoutReminderView stop={pathname.endsWith("/stop")} />
      </Suspense>
    );
  }
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

export function resolveRouteRequirements(pathname: string) {
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

export function initialServiceState(isPublic: boolean): ServiceState {
  return isPublic ? "ready" : "checking";
}

export function initialSessionState(isPublic: boolean): SessionState {
  return !hasSessionHint() && isPublic ? { status: "anonymous" } : { status: "checking" };
}

export function handleSignInLanding(
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

export function renderAppContent(
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

export function resolveDisplayName(
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
