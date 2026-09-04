import {
  type CurrentAuthSession,
  type ModuleState,
  type OrganizationAuthStatusResponse,
} from "@choir/contracts";
import { OrganizationAdminOverview } from "../../OrganizationAdminOverview";

import { AppLink } from "./navigation";
import { PlatformAccess, PlatformDesignSystem, PlatformSetupMonitor } from "./lazyComponents";

import { routeHasModule, routeModule, workspaceLabel } from "./utils";
import {
  renderAccountPage,
  renderMemberPage,
  renderOrganizationPage,
  sessionDisplayName,
} from "./workspacesUtils";
import type { AccessState, RouteState, Workspace } from "./types";

function OverviewPage({
  context,
  displayName,
  modules,
  navigate,
  onOpenCommandPalette,
  workspace,
}: {
  readonly context: OrganizationAuthStatusResponse | null;
  readonly displayName?: string;
  readonly modules?: readonly ModuleState[];
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
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
      {context?.mfaRequired && !context.mfaVerifiedUntil ? (
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

export function WorkspacePageLoading() {
  return (
    <p className="notice notice--info" role="status">
      Loading workspace page…
    </p>
  );
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
  if (access.status === "none") {
    return <AccessDeniedPage workspace="Organization" />;
  }
  if (access.status === "ready" && access.context.role === "member") {
    return <AccessDeniedPage workspace="Organization Admin" />;
  }
  const enabled =
    access.status === "ready" &&
    (!access.context.mfaRequired || Boolean(access.context.mfaVerifiedUntil));
  const manager = access.status === "ready" && access.context.role !== "member";
  const requiredModule = routeModule(route.pathname);
  if (
    access.status === "ready" &&
    requiredModule !== undefined &&
    !routeHasModule({ module: requiredModule }, access.modules)
  ) {
    return <AccessDeniedPage workspace={`${requiredModule} module`} />;
  }
  const page = renderOrganizationPage(route, enabled, manager, navigate, (nextNavigate) => (
    <NotFoundPage navigate={nextNavigate} />
  ));
  return (
    page ?? (
      <OverviewPage
        context={access.status === "ready" ? access.context : null}
        displayName={displayName}
        modules={access.status === "ready" ? access.modules : []}
        navigate={navigate}
        onOpenCommandPalette={onOpenCommandPalette}
        workspace="organization"
      />
    )
  );
}

function PlatformWorkspacePage({
  navigate,
  platformAvailable,
  pathname,
}: {
  readonly navigate: (href: string) => void;
  readonly platformAvailable: boolean;
  readonly pathname: string;
}) {
  if (!platformAvailable) return <AccessDeniedPage workspace="Platform Admin" />;
  if (pathname === "/platform") {
    return <OverviewPage context={null} navigate={navigate} workspace="platform" />;
  }
  if (pathname === "/platform/organizations") {
    return <PlatformAccess view="organizations" />;
  }
  if (pathname === "/platform/access") {
    return <PlatformAccess view="access" />;
  }
  if (pathname === "/platform/dead-letters") {
    return <PlatformAccess view="dead-letters" />;
  }
  if (pathname === "/platform/email-suppressions") {
    return <PlatformAccess view="email-suppressions" />;
  }
  if (pathname === "/platform/design-system") {
    return <PlatformDesignSystem />;
  }
  return <PlatformAccess view="security" />;
}

export function WorkspacePage({
  access,
  currentSession,
  memberEnabled,
  navigate,
  onOpenCommandPalette,
  onSignedOut,
  platformAvailable,
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
  readonly route: RouteState;
  readonly workspace: Workspace;
}) {
  if (workspace === "account")
    return renderAccountPage(route.pathname, currentSession, onSignedOut);
  if (workspace === "platform") {
    return (
      <PlatformWorkspacePage
        navigate={navigate}
        platformAvailable={platformAvailable}
        pathname={route.pathname}
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
  const requiredModule = routeModule(route.pathname);
  if (
    access.status === "ready" &&
    requiredModule !== undefined &&
    !routeHasModule({ module: requiredModule }, access.modules)
  ) {
    return <AccessDeniedPage workspace={`${requiredModule} module`} />;
  }
  return (
    renderMemberPage(route.pathname, memberEnabled, navigate, access.status) ?? (
      <OverviewPage
        context={access.status === "ready" ? access.context : null}
        navigate={navigate}
        workspace="member"
      />
    )
  );
}
