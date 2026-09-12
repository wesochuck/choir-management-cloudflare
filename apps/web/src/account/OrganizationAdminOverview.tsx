import type {
  ModuleState,
  OrganizationAuthStatusResponse,
  OrganizationDashboardSummaryResponse,
} from "@choir/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getOrganizationDashboardSummary, listOrganizationAuditions } from "../auth/api";
import { QuickSearchTrigger } from "./components/CommandPalette";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type OverviewModule = "events" | "people" | "programs";
type OverviewTone = "green" | "blue" | "amber" | "pink" | "cyan" | "slate";

interface OverviewCard {
  readonly description: string;
  readonly href: string;
  readonly icon: string;
  readonly label: string;
  readonly module?: OverviewModule;
  readonly tone: OverviewTone;
}

interface OverviewSection {
  readonly cards: readonly OverviewCard[];
  readonly label: string;
  readonly tone: OverviewTone;
}

interface QuickAction {
  readonly href: string;
  readonly icon: string;
  readonly label: string;
  readonly module?: OverviewModule;
}

type SummaryState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly data: OrganizationDashboardSummaryResponse; readonly status: "ready" };

const quickActions: readonly QuickAction[] = [
  { href: "/admin/attendance", icon: "✅", label: "Take Attendance", module: "events" },
  {
    href: "/admin/communications",
    icon: "✉️",
    label: "Send Announcement",
    module: "programs",
  },
  { href: "/admin/roster?add=true", icon: "👥", label: "Add performer", module: "people" },
  { href: "/admin/events?add=true", icon: "📅", label: "New Event", module: "events" },
  { href: "/admin/library", icon: "🎼", label: "Add Music", module: "programs" },
];

function moduleIsEnabled(
  modules: readonly ModuleState[],
  module: OverviewModule | undefined,
): boolean {
  return !module || (modules.find((item) => item.id === module)?.enabled ?? true);
}

function buildOverviewSections(
  performerLabel: string,
  performerLabelPlural: string,
): readonly OverviewSection[] {
  return [
    {
      label: "People & membership",
      tone: "green",
      cards: [
        {
          href: "/admin/roster",
          icon: "👥",
          label: "Manage Roster",
          description: `Add ${performerLabelPlural.toLowerCase()} and track status`,
          module: "people",
          tone: "green",
        },
        {
          href: "/directory",
          icon: "📖",
          label: `${performerLabel} Directory`,
          description: `View opted-in ${performerLabelPlural.toLowerCase()} contact info`,
          module: "people",
          tone: "green",
        },
        {
          href: "/admin/auditions",
          icon: "🎵",
          label: "Auditions & Inquiries",
          description: "Review public audition requests and join inquiries",
          module: "people",
          tone: "blue",
        },
        {
          href: "/admin/communications",
          icon: "✉️",
          label: "Communications",
          description: "Send announcements and review history",
          module: "programs",
          tone: "slate",
        },
        {
          href: "/admin/polls",
          icon: "📊",
          label: "Engagement Polls",
          description: "Review volunteer responses and counts",
          module: "programs",
          tone: "pink",
        },
        {
          href: "/admin/donations",
          icon: "🎁",
          label: "Donations",
          description: "Track giving and manage donor levels",
          module: "programs",
          tone: "pink",
        },
        {
          href: "/admin/patrons",
          icon: "💎",
          label: "Patrons Dashboard",
          description: "View donor/buyer LTV and message patrons",
          module: "programs",
          tone: "cyan",
        },
      ],
    },
    {
      label: "Events & attendance",
      tone: "amber",
      cards: [
        {
          href: "/admin/events",
          icon: "📅",
          label: "Manage Events",
          description: "Schedule performances and rehearsals",
          module: "events",
          tone: "amber",
        },
        {
          href: "/admin/tickets",
          icon: "🎟️",
          label: "Ticket Sales",
          description: "Track sales and process refunds",
          module: "programs",
          tone: "amber",
        },
        {
          href: "/admin/rsvp",
          icon: "🗓️",
          label: "Event RSVPs",
          description: "Track responses and roster balances",
          module: "events",
          tone: "amber",
        },
        {
          href: "/admin/attendance",
          icon: "✅",
          label: "Take Attendance",
          description: "Track check-ins for events",
          module: "events",
          tone: "green",
        },
        {
          href: "/admin/venues",
          icon: "🏛️",
          label: "Manage Venues",
          description: "Configure venue capacities",
          module: "events",
          tone: "slate",
        },
        {
          href: "/admin/seating",
          icon: "🪑",
          label: "Seating Charts",
          description: "Design layouts and assign seats",
          module: "events",
          tone: "blue",
        },
      ],
    },
    {
      label: "Music & performance",
      tone: "cyan",
      cards: [
        {
          href: "/admin/library",
          icon: "🎼",
          label: "Music Library",
          description: "Catalog, repertoire, and CSV import",
          module: "programs",
          tone: "cyan",
        },
        {
          href: "/admin/setlists",
          icon: "📋",
          label: "Set Lists",
          description: "Build and reorder event music",
          module: "programs",
          tone: "cyan",
        },
        {
          href: "/admin/resources",
          icon: "📂",
          label: `${performerLabel} Resources`,
          description: `Upload documents and links for ${performerLabelPlural.toLowerCase()}`,
          module: "programs",
          tone: "cyan",
        },
      ],
    },
    {
      label: "Admin",
      tone: "slate",
      cards: [
        {
          href: "/admin/website",
          icon: "🌐",
          label: "Public Website",
          description: "Landing page, hero image, and public branding",
          module: "programs",
          tone: "cyan",
        },
        {
          href: "/admin/settings",
          icon: "⚙️",
          label: "System Settings",
          description: "Configure global preferences",
          tone: "slate",
        },
      ],
    },
  ];
}

function DashboardLink({
  children,
  href,
  onNavigate,
}: {
  readonly children: ReactNode;
  readonly href: string;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <a
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
  const hasEnabledStats = moduleIsEnabled(modules, "people") || moduleIsEnabled(modules, "events");

  return (
    <section className="admin-overview__banner" aria-labelledby="admin-overview-greeting">
      <div className="admin-overview__banner-inner">
        <h1 id="admin-overview-greeting">{greeting}</h1>
        {hasEnabledStats ? (
          <div className="admin-overview__stats" aria-label="Organization summary">
            {moduleIsEnabled(modules, "people") ? (
              <DashboardLink href="/admin/roster" onNavigate={navigate}>
                <span>Active {performerLabelPlural}</span>
                <strong>{displayCount(activeProfileCount)}</strong>
              </DashboardLink>
            ) : null}
            {moduleIsEnabled(modules, "events") ? (
              <DashboardLink href="/admin/events" onNavigate={navigate}>
                <span>Upcoming Events</span>
                <strong>{displayCount(upcomingEventCount)}</strong>
              </DashboardLink>
            ) : null}
            {moduleIsEnabled(modules, "people") ? (
              <DashboardLink href="/admin/auditions" onNavigate={navigate}>
                <span>Pending Inquiries</span>
                <strong>{displayCount(pendingAuditionCount)}</strong>
              </DashboardLink>
            ) : null}
            {moduleIsEnabled(modules, "people") ? (
              <DashboardLink href="/admin/roster" onNavigate={navigate}>
                <span>Recent Email Bounces</span>
                <strong>{displayCount(recentBounceCount)}</strong>
              </DashboardLink>
            ) : null}
            {moduleIsEnabled(modules, "people") ? (
              <DashboardLink href="/admin/roster" onNavigate={navigate}>
                <span>Email Disabled</span>
                <strong>{displayCount(doNotEmailCount)}</strong>
              </DashboardLink>
            ) : null}
          </div>
        ) : (
          <p className="admin-overview__banner-welcome">
            Welcome to your organization workspace. Follow the next steps below to finish setting up
            your organization and unlock all management tools.
          </p>
        )}
      </div>
    </section>
  );
}

function QuickActionsSection({
  actions,
  navigate,
  performerLabel,
  title,
}: {
  readonly actions: readonly QuickAction[];
  readonly navigate: (href: string) => void;
  readonly performerLabel: string;
  readonly title: string;
}) {
  return (
    <section className="admin-overview__quick-actions" aria-labelledby="admin-quick-actions-title">
      <p id="admin-quick-actions-title">{title}</p>
      <div>
        {actions.map((action) => (
          <DashboardLink href={action.href} key={action.href} onNavigate={navigate}>
            <span aria-hidden="true">{action.icon}</span>
            {action.label === "Add performer" ? `Add ${performerLabel}` : action.label}
          </DashboardLink>
        ))}
      </div>
    </section>
  );
}

function GettingStartedGuide({
  navigate,
  performerLabelPlural,
}: {
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
            <DashboardLink href="/admin/roster" onNavigate={navigate}>
              <span>Manage {performerLabelPlural.toLowerCase()} →</span>
            </DashboardLink>
          </div>
        </div>
      </div>
    </section>
  );
}

export function OrganizationAdminOverview({
  context,
  displayName,
  modules,
  navigate,
  onOpenCommandPalette,
}: {
  readonly context: OrganizationAuthStatusResponse | null;
  readonly displayName: string;
  readonly modules: readonly ModuleState[];
  readonly navigate: (href: string) => void;
  readonly onOpenCommandPalette?: (() => void) | undefined;
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

    if (moduleIsEnabled(modules, "people")) {
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
  }, [modules]);

  const sections = useMemo(
    () =>
      buildOverviewSections(performerLabel, performerLabelPlural)
        .map((section) => ({
          ...section,
          cards: section.cards.filter((card) => moduleIsEnabled(modules, card.module)),
        }))
        .filter((section) => section.cards.length > 0),
    [modules, performerLabel, performerLabelPlural],
  );
  const visibleQuickActions = useMemo(
    () => quickActions.filter((action) => moduleIsEnabled(modules, action.module)),
    [modules],
  );
  const hasEnabledStats = moduleIsEnabled(modules, "people") || moduleIsEnabled(modules, "events");
  const isNewOrgOrSetupPending = !hasEnabledStats || sections.length <= 1;

  const summaryError = summary.status === "error";
  const activeProfileCount = summary.status === "ready" ? summary.data.activeProfileCount : null;
  const upcomingEventCount = summary.status === "ready" ? summary.data.upcomingEventCount : null;
  const recentBounceCount = summary.status === "ready" ? summary.data.recentBounceCount : null;
  const doNotEmailCount = summary.status === "ready" ? summary.data.doNotEmailCount : null;

  return (
    <div className="admin-overview">
      <OverviewBanner
        activeProfileCount={activeProfileCount}
        displayName={displayName}
        doNotEmailCount={doNotEmailCount}
        modules={modules}
        navigate={navigate}
        pendingAuditionCount={pendingAuditionCount}
        performerLabelPlural={performerLabelPlural}
        recentBounceCount={recentBounceCount}
        upcomingEventCount={upcomingEventCount}
      />

      <QuickSearchTrigger
        onClick={() => {
          onOpenCommandPalette?.();
        }}
        placeholder="Search products, pages, and features..."
        variant="hero"
      />

      {summaryError ? (
        <p className="admin-overview__error" role="status">
          Organization summary is temporarily unavailable. The management links below are still
          available.
        </p>
      ) : null}

      {visibleQuickActions.length > 0 ? (
        <QuickActionsSection
          actions={visibleQuickActions}
          navigate={navigate}
          performerLabel={performerLabel}
          title="Quick actions"
        />
      ) : null}

      {isNewOrgOrSetupPending ? (
        <GettingStartedGuide navigate={navigate} performerLabelPlural={performerLabelPlural} />
      ) : null}

      <div className="admin-overview__sections">
        {sections.map((section) => (
          <section className="admin-overview__section" key={section.label}>
            <h2
              className={`admin-overview__section-heading admin-overview__section-heading--${section.tone}`}
            >
              <span aria-hidden="true" />
              {section.label}
            </h2>
            <div className="admin-overview__cards">
              {section.cards.map((card) => (
                <DashboardLink href={card.href} key={card.href} onNavigate={navigate}>
                  <span
                    aria-hidden="true"
                    className={`admin-overview__card-icon admin-overview__card-icon--${card.tone}`}
                  >
                    {card.icon}
                  </span>
                  <span className="admin-overview__card-copy">
                    <strong>{card.label}</strong>
                    <small>{card.description}</small>
                  </span>
                  <span aria-hidden="true" className="admin-overview__card-arrow">
                    →
                  </span>
                </DashboardLink>
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
