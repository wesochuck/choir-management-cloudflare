import { getAdminFeatureForPath } from "../../organizationFeatures/selectors";
import { type ReactNode, useId, useState } from "react";
import { Tooltip } from "@choir/ui";
import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";
import type { NavigationGroup, ThemePreference } from "./types";

export function ThemeIcon({ preference }: { readonly preference: ThemePreference }) {
  return preference === "dark" ? (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  );
}

export function AppLink({
  ariaCurrent,
  ariaLabel,
  children,
  className,
  href,
  onNavigate,
}: {
  readonly ariaCurrent?: "page" | undefined;
  readonly ariaLabel?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly href: string;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <a
      href={href}
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      className={className}
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

export function SidebarWorkspaceHeading({
  organizationName,
  workspaceName,
}: {
  readonly organizationName: string;
  readonly workspaceName: string;
}) {
  return (
    <div className="sidebar-context">
      <h2 className="sidebar-context__title">{workspaceName}</h2>
      <p className="sidebar-context__org">{organizationName}</p>
    </div>
  );
}

function MemberNavigation({
  groups,
  currentHref,
  navigate,
  compact = false,
  expandedGroups,
  toggleGroup,
  onExpandGroup,
}: {
  readonly groups: readonly NavigationGroup[];
  readonly currentHref: string | undefined;
  readonly navigate: (href: string) => void;
  readonly compact?: boolean | undefined;
  readonly expandedGroups?: readonly string[] | undefined;
  readonly toggleGroup?: ((id: string) => void) | undefined;
  readonly onExpandGroup?: ((id: string) => void) | undefined;
}) {
  const prefix = useId();
  const [state, setState] = useState<{
    readonly href: string | undefined;
    readonly collapsed: readonly string[];
  }>({ href: currentHref, collapsed: [] });
  if (state.href !== currentHref) {
    const activeGroup = groups.find((group) =>
      group.items.some((item) => item.href === currentHref),
    );
    setState({
      href: currentHref,
      collapsed: state.collapsed.filter((label) => label !== activeGroup?.label),
    });
  }

  function links(group: NavigationGroup) {
    return group.items.map((item) => (
      <AppLink
        key={item.href}
        href={item.href}
        onNavigate={navigate}
        ariaCurrent={item.href === currentHref ? "page" : undefined}
        className="organization-nav__link"
      >
        {item.iconId ? <OrganizationFeatureIcon iconId={item.iconId} /> : null}
        <span>{item.label}</span>
        {item.href === currentHref ? <span className="sr-only"> (current)</span> : null}
      </AppLink>
    ));
  }

  if (compact) {
    const home = groups.find((group) => group.id === "home");
    const categories = groups.filter((group) => group.id && group.id !== "home");
    return (
      <nav
        aria-label="Workspace navigation"
        className="organization-nav member-nav organization-nav--compact"
      >
        {home ? (
          <>
            {home.items.map((item) => (
              <Tooltip key={item.href} content={item.label}>
                <AppLink
                  href={item.href}
                  onNavigate={navigate}
                  ariaLabel={item.label}
                  ariaCurrent={item.href === currentHref ? "page" : undefined}
                  className="organization-nav__link"
                >
                  {item.iconId ? <OrganizationFeatureIcon iconId={item.iconId} /> : null}
                  <span>{item.label}</span>
                  {item.href === currentHref ? <span className="sr-only"> (current)</span> : null}
                </AppLink>
              </Tooltip>
            ))}
          </>
        ) : null}
        {categories.map((group) => {
          const groupId = group.id ?? group.label;
          const isGroupActive = group.items.some((item) => item.href === currentHref);
          return (
            <div key={group.label} className="organization-nav__rail-group" data-tone={group.tone}>
              <Tooltip content={group.label}>
                <button
                  type="button"
                  aria-label={group.label}
                  className="organization-nav__rail-button"
                  data-tone={group.tone}
                  data-active={isGroupActive ? "true" : undefined}
                  aria-current={isGroupActive ? "true" : undefined}
                  onClick={() => {
                    onExpandGroup?.(groupId);
                  }}
                >
                  {group.iconId ? <OrganizationFeatureIcon iconId={group.iconId} /> : null}
                </button>
              </Tooltip>
            </div>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Workspace navigation" className="organization-nav member-nav">
      {groups.map((group) => {
        if (group.id === "home") return <div key={group.label}>{links(group)}</div>;
        const groupId = group.id ?? group.label;
        const expanded = expandedGroups
          ? expandedGroups.includes(groupId)
          : !state.collapsed.includes(group.label);
        const controls = `${prefix}-${encodeURIComponent(group.label)}`;
        return (
          <div key={group.label} className="organization-nav__group" data-tone={group.tone}>
            <button
              type="button"
              className="organization-nav__group-button"
              aria-expanded={expanded}
              aria-controls={controls}
              onClick={() => {
                if (toggleGroup) {
                  toggleGroup(groupId);
                } else {
                  setState((current) => ({
                    ...current,
                    collapsed: expanded
                      ? [...current.collapsed, group.label]
                      : current.collapsed.filter((label) => label !== group.label),
                  }));
                }
              }}
            >
              <span className="organization-nav__chip">
                {group.iconId ? <OrganizationFeatureIcon iconId={group.iconId} /> : null}
              </span>
              <span>{group.label}</span>
              <svg
                aria-hidden="true"
                className="organization-nav__chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m7 10 5 5 5-5" />
              </svg>
            </button>
            <div id={controls} hidden={!expanded} className="organization-nav__children">
              {links(group)}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function Navigation({
  memberStyle = false,
  groups,
  navigate,
  pathname,
  compact = false,
  expandedGroups,
  toggleGroup,
  onExpandGroup,
}: {
  readonly memberStyle?: boolean | undefined;
  readonly groups: readonly NavigationGroup[];
  readonly navigate: (href: string) => void;
  readonly pathname: string;
  readonly compact?: boolean | undefined;
  readonly expandedGroups?: readonly string[] | undefined;
  readonly toggleGroup?: ((id: string) => void) | undefined;
  readonly onExpandGroup?: ((id: string) => void) | undefined;
}) {
  const feature = getAdminFeatureForPath(pathname);
  const activePath = feature?.href.split("?")[0] ?? pathname;
  const navigationItems = groups.flatMap((group) => group.items);
  const matchingItems = navigationItems.filter((item) => {
    const itemPath = item.href.split("?")[0] ?? item.href;
    return (
      activePath === itemPath ||
      (activePath === "/admin/patrons" && itemPath === "/admin/donations") ||
      (itemPath !== "/admin" && activePath.startsWith(`${itemPath}/`))
    );
  });
  // Prefer an exact route, then the most specific parent route. This prevents a
  // parent such as `/admin/settings` from remaining active alongside one of its
  // more specific pages such as `/admin/settings/modules`.
  const currentHref =
    matchingItems.find((item) => {
      const itemPath = item.href.split("?")[0] ?? item.href;
      return (
        itemPath === activePath ||
        (activePath === "/admin/patrons" && itemPath === "/admin/donations")
      );
    })?.href ??
    matchingItems.toSorted((left, right) => right.href.length - left.href.length)[0]?.href;

  if (memberStyle)
    return (
      <MemberNavigation
        groups={groups}
        currentHref={currentHref}
        navigate={navigate}
        compact={compact}
        expandedGroups={expandedGroups}
        toggleGroup={toggleGroup}
        onExpandGroup={onExpandGroup}
      />
    );

  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      {groups.map((group) => (
        <div className="workspace-nav__group" key={group.label}>
          <p className="workspace-nav__label">{group.label}</p>
          <div className="workspace-nav__items">
            {group.items.map((item) => {
              const isCurrent = currentHref === item.href;
              return (
                <AppLink
                  ariaCurrent={isCurrent ? "page" : undefined}
                  href={item.href}
                  key={item.href}
                  onNavigate={navigate}
                >
                  <span>{item.label}</span>
                  {isCurrent ? <span className="sr-only"> (current)</span> : null}
                </AppLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
