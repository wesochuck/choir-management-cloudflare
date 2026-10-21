import { OrganizationFeatureIcon } from "./organizationFeatures/OrganizationFeatureIcon";
import {
  getOrganizationDashboardSections,
  getOrganizationQuickActions,
} from "./organizationFeatures/selectors";
import { useOrganizationModules } from "./organizationFeatures/moduleStateContext";
import { moduleIdSchema } from "@choir/contracts";
import type {
  ModuleId,
  ModuleState,
  OrganizationAuthStatusResponse,
  OrganizationDashboardSummaryResponse,
} from "@choir/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getOrganizationDashboardSummary, listOrganizationAuditions } from "../auth/api";
import { routeHasModule } from "./components/AuthenticatedShell/utils";
import { QuickSearchTrigger } from "./components/CommandPalette";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type OverviewCard = ReturnType<typeof getOrganizationDashboardSections>[number]["cards"][number];
type QuickAction = ReturnType<typeof getOrganizationQuickActions>[number];

const unavailableModules = moduleIdSchema.options.map((id) => ({ id, enabled: false }));

type SummaryState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly data: OrganizationDashboardSummaryResponse; readonly status: "ready" };

function moduleIsEnabled(modules: readonly ModuleState[], module: ModuleId | undefined): boolean {
  return module ? routeHasModule({ module }, modules) : true;
}

function useOverviewFeatures(
  modules: readonly ModuleState[],
  performerLabel: string,
  performerLabelPlural: string,
) {
  const sharedModules = useOrganizationModules();
  const featureContext = useMemo(
    () => ({
      modules,
      status: sharedModules?.snapshot.status ?? "ready",
      performerLabel,
      performerLabelPlural,
    }),
    [modules, sharedModules?.snapshot.status, performerLabel, performerLabelPlural],
  );
  const sections = useMemo(
    () => getOrganizationDashboardSections(featureContext),
    [featureContext],
  );
  const visibleQuickActions = useMemo(
    () => getOrganizationQuickActions(featureContext),
    [featureContext],
  );
  const displayModules =
    sharedModules && sharedModules.snapshot.status !== "ready" ? unavailableModules : modules;
  return { sections, visibleQuickActions, displayModules };
}

function DashboardLink({
  children,
  className,
  href,
  onNavigate,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly href: string;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
}

function displayCount(value: number | null): string {
  return value === null ? "…" : String(value);
}

function greetingForCurrentTime(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function OverviewBanner({
  activeProfileCount,
  displayName,
  doNotEmailCount,
  modules,
  navigate,
  pendingAuditionCount,
  performerLabelPlural,
  recentBounceCount,
  upcomingEventCount,
}: {
  readonly activeProfileCount: number | null;
  readonly displayName: string;
  readonly doNotEmailCount: number | null;
  readonly modules: readonly ModuleState[];
  readonly navigate: (href: string) => void;
  readonly pendingAuditionCount: number | null;
  readonly performerLabelPlural: string;
  readonly recentBounceCount: number | null;
  readonly upcomingEventCount: number | null;
}) {
  const greetingName = displayName.trim() || "Admin";
  const greeting = `${greetingForCurrentTime()}, ${greetingName}`;
  const hasEnabledStats = (["roster", "events", "auditions"] as const).some((module) =>
    moduleIsEnabled(modules, module),
  );

  return (
    <section className="admin-overview__banner" aria-labelledby="admin-overview-greeting">
      <div className="admin-overview__hero-intro">
        <h1 id="admin-overview-greeting">{greeting}</h1>
        <p className="admin-overview__hero-subtitle">
          A quick view of your organization, with the tools you use most just below.
        </p>
      </div>
      {hasEnabledStats ? (
        <div
          className="admin-overview__stats admin-overview__kpi-grid"
          aria-label="Organization at a glance"
        >
          {moduleIsEnabled(modules, "roster") ? (
            <DashboardLink
              className="admin-overview__kpi"
              href="/admin/roster"
              onNavigate={navigate}
            >
              <strong>{displayCount(activeProfileCount)}</strong>
              <span>Active {performerLabelPlural}</span>
            </DashboardLink>
          ) : null}
          {moduleIsEnabled(modules, "events") ? (
            <DashboardLink
              className="admin-overview__kpi"
              href="/admin/events"
              onNavigate={navigate}
            >
              <strong>{displayCount(upcomingEventCount)}</strong>
              <span>Upcoming Events</span>
            </DashboardLink>
          ) : null}
          {moduleIsEnabled(modules, "auditions") ? (
            <DashboardLink
              className="admin-overview__kpi"
              href="/admin/auditions"
              onNavigate={navigate}
            >
              <strong>{displayCount(pendingAuditionCount)}</strong>
              <span>Pending Inquiries</span>
            </DashboardLink>
          ) : null}
          {moduleIsEnabled(modules, "roster") ? (
            <DashboardLink
              className="admin-overview__kpi"
              href="/admin/roster"
              onNavigate={navigate}
            >
              <strong>{displayCount(recentBounceCount)}</strong>
              <span>Recent Email Bounces</span>
            </DashboardLink>
          ) : null}
          {moduleIsEnabled(modules, "roster") ? (
            <DashboardLink
              className="admin-overview__kpi"
              href="/admin/roster"
              onNavigate={navigate}
            >
              <strong>{displayCount(doNotEmailCount)}</strong>
              <span>Email Disabled</span>
            </DashboardLink>
          ) : null}
        </div>
      ) : (
        <p className="admin-overview__banner-welcome">
          Welcome to your organization workspace. Follow the next steps below to finish setting up
          your organization and unlock all management tools.
        </p>
      )}
    </section>
  );
}

function QuickActionsSection({
  actions,
  navigate,
  title,
}: {
  readonly actions: readonly QuickAction[];
  readonly navigate: (href: string) => void;
  readonly title: string;
}) {
  return (
    <section className="admin-overview__quick-actions" aria-labelledby="admin-quick-actions-title">
      <span id="admin-quick-actions-title" className="admin-overview__quick-actions-title">
        {title}
      </span>
      <div className="admin-overview__quick-actions-list">
        {actions.map((action) => (
          <DashboardLink
            className="admin-overview__quick-btn"
            href={action.href}
            key={action.href}
            onNavigate={navigate}
          >
            <span aria-hidden="true" className="admin-overview__quick-btn-icon">
              <OrganizationFeatureIcon iconId={action.iconId} />
            </span>
            <span>{action.label}</span>
          </DashboardLink>
        ))}
      </div>
    </section>
  );
}

function GettingStartedGuide({
  modules,
  navigate,
  performerLabelPlural,
}: {
  readonly modules: readonly ModuleState[];
  readonly navigate: (href: string) => void;
  readonly performerLabelPlural: string;
}) {
  return (
    <section
      className="admin-overview__getting-started"
      aria-labelledby="admin-getting-started-title"
    >
      <div className="admin-overview__getting-started-header">
        <div>
          <h2 id="admin-getting-started-title">Next steps for your organization</h2>
          <p>
            Follow these recommended steps to finish setting up your organization and unlock all
            management tools.
          </p>
        </div>
        <DashboardLink href="/admin/settings/setup-checklist" onNavigate={navigate}>
          <span>View full checklist →</span>
        </DashboardLink>
      </div>
      <div className="admin-overview__guide-steps">
        <div className="admin-overview__guide-step">
          <span className="admin-overview__guide-step-num" aria-hidden="true">
            1
          </span>
          <div className="admin-overview__guide-step-content">
            <strong>Configure Modules</strong>
            <p>
              Enable People (Roster & Directory), Events (Rehearsals & RSVPs), or Music & Programs.
            </p>
            <DashboardLink href="/admin/settings/modules" onNavigate={navigate}>
              <span>Configure modules →</span>
            </DashboardLink>
          </div>
        </div>
        <div className="admin-overview__guide-step">
          <span className="admin-overview__guide-step-num" aria-hidden="true">
            2
          </span>
          <div className="admin-overview__guide-step-content">
            <strong>Complete Setup Checklist</strong>
            <p>Review organization info, branding theme, and verify launch readiness.</p>
            <DashboardLink href="/admin/settings/setup-checklist" onNavigate={navigate}>
              <span>Open setup checklist →</span>
            </DashboardLink>
          </div>
        </div>
        <div className="admin-overview__guide-step">
          <span className="admin-overview__guide-step-num" aria-hidden="true">
            3
          </span>
          <div className="admin-overview__guide-step-content">
            <strong>System Settings & Terminology</strong>
            <p>
              Customize labels ({performerLabelPlural.toLowerCase()}), timezone, and security
              preferences.
            </p>
            <DashboardLink href="/admin/settings" onNavigate={navigate}>
              <span>System settings →</span>
            </DashboardLink>
          </div>
        </div>
        <div className="admin-overview__guide-step">
          <span className="admin-overview__guide-step-num" aria-hidden="true">
            4
          </span>
          <div className="admin-overview__guide-step-content">
            <strong>Add {performerLabelPlural} & Music</strong>
            <p>
              Once modules are active, add your ensemble members and repertoire manually or via CSV
              import.
            </p>
            {moduleIsEnabled(modules, "roster") ? (
              <DashboardLink href="/admin/roster" onNavigate={navigate}>
                <span>Manage {performerLabelPlural.toLowerCase()} →</span>
              </DashboardLink>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function OverviewCardItem({
  card,
  navigate,
  platformReadOnly,
}: {
  readonly card: OverviewCard;
  readonly navigate: (href: string) => void;
  readonly platformReadOnly: boolean;
}) {
  const icon = (
    <span
      aria-hidden="true"
      className={`admin-overview__card-icon admin-overview__card-icon--${card.tone}`}
    >
      <OrganizationFeatureIcon iconId={card.iconId} />
    </span>
  );
  const copy = (
    <span className="admin-overview__card-copy">
      <strong className="admin-overview__card-title">{card.label}</strong>
      <small className="admin-overview__card-description">
        {card.description}
        {platformReadOnly ? " Unavailable in read-only Platform access." : ""}
      </small>
    </span>
  );
  if (platformReadOnly) {
    return (
      <div
        aria-disabled="true"
        className="admin-overview__card"
        title="Unavailable in read-only Platform access"
      >
        {icon}
        {copy}
      </div>
    );
  }
  return (
    <DashboardLink className="admin-overview__card" href={card.href} onNavigate={navigate}>
      {icon}
      {copy}
    </DashboardLink>
  );
}

function OverviewCommandBar({
  navigate,
  onOpenCommandPalette,
  platformReadOnly,
  visibleQuickActions,
}: {
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
  readonly platformReadOnly: boolean;
  readonly visibleQuickActions: readonly QuickAction[];
}) {
  if (platformReadOnly) return null;
  return (
    <div className="admin-overview__command-bar">
      <QuickSearchTrigger
        className="admin-overview__search-trigger"
        hideTitle
        onClick={() => {
          onOpenCommandPalette?.();
        }}
        placeholder="Search pages, tools, and features..."
        variant="hero"
      />
      {visibleQuickActions.length > 0 ? (
        <QuickActionsSection
          actions={visibleQuickActions}
          navigate={navigate}
          title="Quick actions"
        />
      ) : null}
    </div>
  );
}

function PlatformAccessBanner({
  platformCanEdit,
  platformReadOnly,
}: {
  readonly platformCanEdit: boolean;
  readonly platformReadOnly: boolean;
}) {
  if (!platformReadOnly && !platformCanEdit) return null;
  return (
    <p className="notice notice--warning" role="status">
      <strong>
        {platformReadOnly ? "Read-only Platform access." : "Platform elevation active."}
      </strong>{" "}
      You are viewing this Organization as a Platform Administrator, not as an Organization member.{" "}
      {platformReadOnly
        ? "Operational shortcuts are unavailable in this overview. Manage permitted edits through Platform access with an explicit, timed elevation."
        : "Edits remain scoped to this Organization and expire automatically."}{" "}
      <a href="/platform/access">Manage Platform access</a>
    </p>
  );
}

export function OrganizationAdminOverview({
  context,
  displayName,
  modules,
  navigate,
  onOpenCommandPalette,
  platformCanEdit = false,
  platformReadOnly = false,
}: {
  readonly context: OrganizationAuthStatusResponse | null;
  readonly displayName: string;
  readonly modules: readonly ModuleState[];
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
  readonly platformCanEdit?: boolean;
  readonly platformReadOnly?: boolean;
}) {
  const { performerLabel, performerLabelPlural } = useOrganizationTerminology();
  const [summary, setSummary] = useState<SummaryState>({ status: "loading" });
  const [pendingAuditionCount, setPendingAuditionCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getOrganizationDashboardSummary(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSummary({ data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSummary({ status: "error" });
        }
      });

    if (moduleIsEnabled(modules, "auditions") && !platformReadOnly) {
      listOrganizationAuditions(controller.signal)
        .then((auditions) => {
          if (!controller.signal.aborted) {
            setPendingAuditionCount(
              auditions.filter((audition) => audition.status === "pending").length,
            );
          }
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setPendingAuditionCount(null);
          }
        });
    }

    return () => {
      controller.abort();
    };
  }, [modules, platformReadOnly]);

  const { sections, visibleQuickActions, displayModules } = useOverviewFeatures(
    modules,
    performerLabel,
    performerLabelPlural,
  );
  const isNewOrgOrSetupPending =
    sections.reduce((count, section) => count + section.cards.length, 0) <= 2;

  const summaryError = summary.status === "error";
  const activeProfileCount = summary.status === "ready" ? summary.data.activeProfileCount : null;
  const upcomingEventCount = summary.status === "ready" ? summary.data.upcomingEventCount : null;
  const recentBounceCount = summary.status === "ready" ? summary.data.recentBounceCount : null;
  const doNotEmailCount = summary.status === "ready" ? summary.data.doNotEmailCount : null;

  return (
    <div className="admin-overview">
      <PlatformAccessBanner platformCanEdit={platformCanEdit} platformReadOnly={platformReadOnly} />
      <OverviewBanner
        activeProfileCount={activeProfileCount}
        displayName={displayName}
        doNotEmailCount={doNotEmailCount}
        modules={displayModules}
        navigate={navigate}
        pendingAuditionCount={pendingAuditionCount}
        performerLabelPlural={performerLabelPlural}
        recentBounceCount={recentBounceCount}
        upcomingEventCount={upcomingEventCount}
      />

      <OverviewCommandBar
        navigate={navigate}
        onOpenCommandPalette={onOpenCommandPalette}
        platformReadOnly={platformReadOnly}
        visibleQuickActions={visibleQuickActions}
      />

      {summaryError ? (
        <p className="admin-overview__error" role="status">
          Organization summary is temporarily unavailable. The management links below are still
          available.
        </p>
      ) : null}

      {isNewOrgOrSetupPending && !platformReadOnly ? (
        <GettingStartedGuide
          modules={displayModules}
          navigate={navigate}
          performerLabelPlural={performerLabelPlural}
        />
      ) : null}

      <div className="admin-overview__sections">
        {sections.map((section) => (
          <section
            className={`admin-overview__section admin-overview__section--${section.tone}`}
            key={section.label}
            aria-labelledby={`admin-section-${section.id}`}
          >
            <div className="admin-overview__section-heading">
              <div>
                <h2
                  className={`admin-overview__section-title admin-overview__section-heading--${section.tone}`}
                  id={`admin-section-${section.id}`}
                >
                  <span aria-hidden="true" className="admin-overview__section-dot" />
                  {section.label}
                </h2>
                <p className="admin-overview__section-note">{section.description}</p>
              </div>
              <div className="admin-overview__section-count">
                {section.cards.length} {section.cards.length === 1 ? "tool" : "tools"}
              </div>
            </div>
            <div className="admin-overview__cards">
              {section.cards.map((card) => (
                <OverviewCardItem
                  card={card}
                  key={card.href}
                  navigate={navigate}
                  platformReadOnly={platformReadOnly}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {context?.mfaRequired && !context.mfaSatisfied ? (
        <OrganizationMfaPrompt message="Organization MFA is required before operational data can be opened." />
      ) : null}
    </div>
  );
}
