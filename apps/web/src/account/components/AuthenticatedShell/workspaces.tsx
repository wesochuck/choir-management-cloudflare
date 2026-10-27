import {
  type PlatformMfaStatusResponse,
  type CurrentAuthSession,
  type ModuleState,
  type OrganizationAuthStatusResponse,
} from "@choir/contracts";
import { OrganizationAdminOverview } from "../../OrganizationAdminOverview";
import { useOrganizationModules } from "../../organizationFeatures/moduleStateContext";
import { OrganizationMfaPrompt } from "../../OrganizationMfaPrompt";

import { AppLink } from "./navigation";
import { PlatformAccess, PlatformDesignSystem, PlatformSetupMonitor } from "./lazyComponents";

import { safePlatformContinuation } from "../../../auth/postSignIn";
import { routeHasModule, routeModule, workspaceLabel } from "./utils";
import {
  renderAccountPage,
  renderMemberPage,
  renderOrganizationPage,
  safeAdminReturnPath,
  sessionDisplayName,
} from "./workspacesUtils";
import type { AccessState, RouteState, Workspace } from "./types";

function rosterEditingEnabled(access: AccessState): boolean {
  if (access.status !== "ready") return false;
  return access.modules.find((module) => module.id === "roster")?.enabled ?? true;
}

function OverviewPage({
  context,
  displayName,
  modules,
  navigate,
  onOpenCommandPalette,
  platformCanEdit = false,
  platformReadOnly = false,
  workspace,
}: {
  readonly context: OrganizationAuthStatusResponse | null;
  readonly displayName?: string;
  readonly modules?: readonly ModuleState[];
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
  readonly platformCanEdit?: boolean;
  readonly platformReadOnly?: boolean;
  readonly workspace: Workspace;
}) {
  const platform = workspace === "platform";
  if (workspace === "organization") {
    return (
      <OrganizationAdminOverview
        context={context}
        displayName={displayName ?? "Admin"}
        modules={modules ?? []}
        navigate={navigate}
        onOpenCommandPalette={onOpenCommandPalette}
        platformCanEdit={platformCanEdit}
        platformReadOnly={platformReadOnly}
      />
    );
  }
  const cards = platform
    ? [
        {
          href: "/platform/organizations",
          label: "Organizations",
          text: "Provision, monitor, and manage scoped access.",
        },
        {
          href: "/platform/security",
          label: "Platform security",
          text: "Verify Platform Administrator MFA.",
        },
        {
          href: "/platform/dead-letters",
          label: "Queue dead letters",
          text: "Review, retry, or dismiss failed queue jobs.",
        },
        {
          href: "/platform/email-suppressions",
          label: "Email suppressions",
          text: "Review application-wide provider blocks.",
        },
        {
          href: "/platform/design-system",
          label: "Design system",
          text: "Browse live tokens, buttons, notices, forms, and primitives.",
        },
      ]
    : [
        {
          href: "/schedule",
          label: "My schedule",
          text: "See upcoming rehearsals and performances.",
        },
        {
          href: "/profile",
          label: "My Profile",
          text: "Keep your Organization Profile current.",
        },
        { href: "/practice", label: "Practice", text: "Open your approved learning tracks." },
        {
          href: "/member/resources",
          label: "Resources",
          text: "Find Organization documents and links.",
        },
      ];

  return (
    <>
      {!platform ? (
        <div className="workspace-hero">
          <p className="workspace-hero__label">{workspaceLabel(workspace)}</p>
          <h1>At a glance</h1>
          <p>Everything you need for the next rehearsal, performance, and practice session.</p>
        </div>
      ) : null}
      {platform ? <PlatformSetupMonitor /> : null}
      <section className="overview-section" aria-labelledby="quick-actions-title">
        <div className="section-heading section-heading--compact">
          <h2 id="quick-actions-title">Start with what matters</h2>
        </div>
        <div className="workspace-card-grid">
          {cards.map((card) => (
            <AppLink href={card.href} key={card.href} onNavigate={navigate}>
              <span className="workspace-card__icon" aria-hidden="true">
                →
              </span>
              <span>
                <strong>{card.label}</strong>
                <small>{card.text}</small>
              </span>
            </AppLink>
          ))}
        </div>
      </section>
      {context?.mfaRequired && !context.mfaSatisfied ? (
        <p className="notice notice--warning">
          Organization MFA is required before operational data can be opened. Visit Organization
          security to verify access.
        </p>
      ) : null}
    </>
  );
}

function AccessDeniedPage({ workspace }: { readonly workspace: string }) {
  return (
    <section className="surface-card empty-page" aria-labelledby="access-denied-title">
      <h1 id="access-denied-title">You do not have access to this {workspace} workspace.</h1>
      <p>
        Choose a workspace from the switcher to continue with the permissions available to your
        account.
      </p>
    </section>
  );
}

function NotFoundPage({ navigate }: { readonly navigate: (href: string) => void }) {
  return (
    <section className="surface-card empty-page" aria-labelledby="not-found-title">
      <h1 id="not-found-title">That workspace page does not exist.</h1>
      <button
        className="button button--primary"
        onClick={() => {
          navigate("/dashboard");
        }}
        type="button"
      >
        Return to dashboard
      </button>
    </section>
  );
}

export function WorkspacePageLoading({
  message = "Loading workspace page…",
}: {
  readonly message?: string;
} = {}) {
  return (
    <p className="notice notice--info" role="status">
      {message}
    </p>
  );
}

type PlatformScopedAccess = Extract<AccessState, { status: "platform-scoped" }>;

function PlatformScopedWorkspacePage({
  access,
  displayName,
  navigate,
  onOpenCommandPalette,
  route,
}: {
  readonly access: PlatformScopedAccess;
  readonly displayName: string;
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
  readonly route: RouteState;
}) {
  // Only the /admin overview is available, read-only unless elevated. Other
  // admin routes are clearly marked unavailable instead of dead 403 links.
  if (route.pathname !== "/admin") {
    return (
      <section className="surface-card empty-page" aria-labelledby="platform-scoped-title">
        <h1 id="platform-scoped-title">Not available in read-only Platform access.</h1>
        <p>
          You are viewing this Organization as a Platform Administrator without Organization
          Membership. Operational pages require membership or an explicit, timed Platform elevation.
        </p>
        <p>
          <a className="button button--primary" href="/admin">
            Return to Organization overview
          </a>{" "}
          <a className="button button--secondary" href="/platform/access">
            Manage Platform access
          </a>
        </p>
      </section>
    );
  }
  return (
    <OverviewPage
      context={null}
      displayName={displayName}
      modules={access.modules}
      navigate={navigate}
      onOpenCommandPalette={onOpenCommandPalette}
      platformCanEdit={access.platformContext.canEdit}
      platformReadOnly
      workspace="organization"
    />
  );
}

function readyAccessFlags(access: Extract<AccessState, { readonly status: "ready" }>): {
  readonly canManageSetLists: boolean;
  readonly canReviewRsvps: boolean;
  readonly enabled: boolean;
  readonly manager: boolean;
  readonly moduleDenied: boolean;
} {
  const enabled =
    !access.context.mfaRequired ||
    access.context.mfaSatisfied ||
    Boolean(access.context.mfaVerifiedUntil);
  return {
    canManageSetLists: routeHasModule({ module: "setlists" }, access.modules),
    canReviewRsvps: routeHasModule({ module: "rsvp" }, access.modules),
    enabled,
    manager: access.context.role !== "member",
    moduleDenied: false,
  };
}

function OrganizationWorkspacePage({
  access,
  displayName,
  navigate,
  onOpenCommandPalette,
  route,
}: {
  readonly access: AccessState;
  readonly displayName: string;
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
  readonly route: RouteState;
}) {
  const moduleController = useOrganizationModules();
  if (access.status === "none") {
    return <AccessDeniedPage workspace="Organization" />;
  }
  if (access.status === "loading") {
    return <WorkspacePageLoading message="Loading Organization workspace…" />;
  }
  if (access.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Organization access could not be verified. Refresh and try again.
      </p>
    );
  }
  if (moduleController?.snapshot.status === "loading") {
    return <WorkspacePageLoading message="Loading Organization workspace…" />;
  }
  if (access.status === "platform-scoped") {
    return (
      <PlatformScopedWorkspacePage
        access={access}
        displayName={displayName}
        navigate={navigate}
        onOpenCommandPalette={onOpenCommandPalette}
        route={route}
      />
    );
  }
  if (access.context.role === "member" && access.platformContext) {
    return (
      <PlatformScopedWorkspacePage
        access={{ ...access, platformContext: access.platformContext, status: "platform-scoped" }}
        displayName={displayName}
        navigate={navigate}
        onOpenCommandPalette={onOpenCommandPalette}
        route={route}
      />
    );
  }
  if (access.context.role === "member") {
    return <AccessDeniedPage workspace="Organization Admin" />;
  }
  const { canManageSetLists, canReviewRsvps, enabled, manager } = readyAccessFlags(access);
  const requiredModule = routeModule(route.pathname);
  if (requiredModule !== undefined && !routeHasModule({ module: requiredModule }, access.modules)) {
    return <AccessDeniedPage workspace={`${requiredModule} module`} />;
  }
  const canEditProfiles = rosterEditingEnabled(access);
  const page = renderOrganizationPage(
    route,
    enabled,
    manager,
    navigate,
    (nextNavigate) => <NotFoundPage navigate={nextNavigate} />,
    canEditProfiles,
    canReviewRsvps,
    canManageSetLists,
  );
  return (
    page ?? (
      <OverviewPage
        context={access.context}
        displayName={displayName}
        modules={access.modules}
        navigate={navigate}
        onOpenCommandPalette={onOpenCommandPalette}
        workspace="organization"
      />
    )
  );
}

function PlatformWorkspacePage({
  initialMfaStatus,
  navigate,
  platformAvailable,
  platformStatus,
  pathname,
  refreshPlatformStatus,
  search = "",
}: {
  readonly initialMfaStatus: PlatformMfaStatusResponse | null;
  readonly navigate: (href: string) => void;
  readonly platformAvailable: boolean;
  readonly platformStatus: "loading" | "ready" | "error";
  readonly pathname: string;
  readonly refreshPlatformStatus: () => void;
  readonly search?: string;
}) {
  if (platformStatus === "loading") {
    return <WorkspacePageLoading message="Checking Platform Administrator access…" />;
  }
  if (platformStatus === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Platform Administrator status could not be checked. Refresh and try again.{" "}
        <button onClick={refreshPlatformStatus} type="button">
          Retry
        </button>
      </p>
    );
  }
  if (!platformAvailable) return <AccessDeniedPage workspace="Platform Admin" />;
  if (pathname === "/platform") {
    return <OverviewPage context={null} navigate={navigate} workspace="platform" />;
  }
  if (pathname === "/platform/organizations") {
    return <PlatformAccess initialMfaStatus={initialMfaStatus} view="organizations" />;
  }
  if (pathname === "/platform/access") {
    const rawReturnTo = new URLSearchParams(search).get("returnTo") ?? "";
    const returnTo = safePlatformContinuation(rawReturnTo) ?? undefined;
    return <PlatformAccess initialMfaStatus={initialMfaStatus} returnTo={returnTo} view="access" />;
  }
  if (pathname === "/platform/dead-letters") {
    return <PlatformAccess initialMfaStatus={initialMfaStatus} view="dead-letters" />;
  }
  if (pathname === "/platform/email-suppressions") {
    return <PlatformAccess initialMfaStatus={initialMfaStatus} view="email-suppressions" />;
  }
  if (pathname === "/platform/design-system") {
    return <PlatformDesignSystem />;
  }
  return <PlatformAccess initialMfaStatus={initialMfaStatus} view="security" />;
}

function MemberWorkspacePage({
  access,
  memberEnabled,
  navigate,
  route,
}: {
  readonly access: AccessState;
  readonly memberEnabled: boolean;
  readonly navigate: (href: string) => void;
  readonly route: RouteState;
}) {
  if (access.status === "loading") {
    return <WorkspacePageLoading message="Loading your member workspace…" />;
  }
  if (access.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Your Organization access could not be verified. Refresh and try again.
      </p>
    );
  }
  if (access.status === "none" || access.status === "platform-scoped") {
    return <AccessDeniedPage workspace="Member workspace" />;
  }
  const mfaRequired =
    access.context.mfaRequired && !access.context.mfaSatisfied && !access.context.mfaVerifiedUntil;
  if (mfaRequired) {
    return (
      <OrganizationMfaPrompt message="Verify Organization MFA to view your member workspace." />
    );
  }
  const requiredModule = routeModule(route.pathname);
  if (requiredModule !== undefined && !routeHasModule({ module: requiredModule }, access.modules)) {
    return <AccessDeniedPage workspace={`${requiredModule} module`} />;
  }
  const hasAdminAccess = access.context.role === "owner" || access.context.role === "administrator";
  const adminReturnTo = hasAdminAccess ? safeAdminReturnPath(route.search) : null;
  return (
    renderMemberPage(
      route.pathname,
      memberEnabled,
      navigate,
      "ready",
      mfaRequired,
      adminReturnTo,
      route.search,
    ) ?? <OverviewPage context={access.context} navigate={navigate} workspace="member" />
  );
}

export function WorkspacePage({
  access,
  currentSession,
  memberEnabled,
  navigate,
  onOpenCommandPalette,
  onSignedOut,
  platformAvailable,
  platformMfaStatus,
  platformStatus,
  refreshPlatformStatus,
  route,
  workspace,
}: {
  readonly access: AccessState;
  readonly currentSession: NonNullable<CurrentAuthSession>;
  readonly memberEnabled: boolean;
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
  readonly onSignedOut: () => void;
  readonly platformAvailable: boolean;
  readonly platformMfaStatus: PlatformMfaStatusResponse | null;
  readonly platformStatus: "loading" | "ready" | "error";
  readonly refreshPlatformStatus: () => void;
  readonly route: RouteState;
  readonly workspace: Workspace;
}) {
  if (workspace === "account")
    return renderAccountPage(route.pathname, currentSession, onSignedOut);
  if (workspace === "platform") {
    return (
      <PlatformWorkspacePage
        initialMfaStatus={platformMfaStatus}
        navigate={navigate}
        platformAvailable={platformAvailable}
        platformStatus={platformStatus}
        pathname={route.pathname}
        refreshPlatformStatus={refreshPlatformStatus}
        search={route.search}
      />
    );
  }
  if (workspace === "organization") {
    return (
      <OrganizationWorkspacePage
        access={access}
        displayName={sessionDisplayName(currentSession)}
        navigate={navigate}
        onOpenCommandPalette={onOpenCommandPalette}
        route={route}
      />
    );
  }
  return (
    <MemberWorkspacePage
      access={access}
      memberEnabled={memberEnabled}
      navigate={navigate}
      route={route}
    />
  );
}
