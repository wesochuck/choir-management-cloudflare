import { QuickSearchTrigger } from "../components/CommandPalette/QuickSearchTrigger";
import { useId } from "react";
import { Tooltip } from "@choir/ui";
import { AppLink, RailGroup } from "../components/AuthenticatedShell/navigation";
import type { NavigationGroup, NavigationItem } from "../components/AuthenticatedShell/types";
import type { OrganizationGroupId } from "./types";
import { getAdminFeatureForPath } from "./selectors";
import { OrganizationFeatureIcon } from "./OrganizationFeatureIcon";

function activeHref(groups: readonly NavigationGroup[], path: string): string | undefined {
  const feature = getAdminFeatureForPath(path);
  const targetPath = feature?.href.split("?")[0] ?? path.split("?")[0] ?? path;
  // Patrons is a contextual Donations destination without its own sidebar link.
  const canonical = targetPath === "/admin/patrons" ? "/admin/donations" : targetPath;
  return groups
    .flatMap((g) => g.items)
    .filter((item) => {
      const target = item.href.split("?")[0];
      return (
        target === canonical ||
        (target && target !== "/admin" && canonical.startsWith(`${target}/`))
      );
    })
    .toSorted((a, b) => b.href.length - a.href.length)[0]?.href;
}

function FeatureLinks({
  items,
  currentHref,
  navigate,
}: {
  readonly items: readonly NavigationItem[];
  readonly currentHref: string | undefined;
  readonly navigate: (href: string) => void;
}) {
  return (
    <>
      {items.map((item) => (
        <AppLink
          key={item.href}
          href={item.href}
          onNavigate={navigate}
          ariaCurrent={item.href === currentHref ? "page" : undefined}
          className="organization-nav__link"
        >
          {item.iconId ? <OrganizationFeatureIcon iconId={item.iconId} /> : null}
          <span>{item.label}</span>
        </AppLink>
      ))}
    </>
  );
}

export function OrganizationAdminNavigation({
  groups,
  path,
  compact = false,
  expanded,
  toggleGroup,
  navigate,
  onSearch,
}: {
  readonly groups: readonly NavigationGroup[];
  readonly path: string;
  readonly compact?: boolean | undefined;
  readonly expanded: readonly OrganizationGroupId[];
  readonly toggleGroup: (id: OrganizationGroupId) => void;
  readonly onExpandGroup?: ((id: OrganizationGroupId) => void) | undefined;
  readonly navigate: (href: string) => Promise<boolean>;
  readonly onSearch: () => void;
}) {
  const prefix = useId();
  const current = activeHref(groups, path);
  const home = groups.find((group) => group.id === "home");
  const categories = groups.filter((group) => group.id && group.id !== "home");
  return (
    <nav
      aria-label="Workspace navigation"
      className={`organization-nav ${compact ? "organization-nav--compact" : ""}`}
    >
      {home ? (
        compact ? (
          home.items.map((item) => (
            <Tooltip key={item.href} content={item.label}>
              <AppLink
                href={item.href}
                onNavigate={(href) => {
                  void navigate(href);
                }}
                ariaLabel={item.label}
                ariaCurrent={item.href === current ? "page" : undefined}
                className="organization-nav__link"
              >
                {item.iconId ? <OrganizationFeatureIcon iconId={item.iconId} /> : null}
                <span>{item.label}</span>
              </AppLink>
            </Tooltip>
          ))
        ) : (
          <FeatureLinks
            items={home.items}
            currentHref={current}
            navigate={(href) => {
              void navigate(href);
            }}
          />
        )
      ) : null}
      {compact ? (
        <Tooltip content="Global search">
          <button
            type="button"
            className="organization-nav__rail-button"
            aria-label="Quick search"
            onClick={onSearch}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="10" cy="10" r="7" />
              <path d="m15 15 6 6" />
            </svg>
          </button>
        </Tooltip>
      ) : (
        <QuickSearchTrigger onClick={onSearch} variant="sidebar" />
      )}
      {categories.map((group) => {
        const id = group.id;
        if (!id || id === "home") return null;
        if (compact) {
          return (
            <RailGroup
              key={id}
              group={group}
              currentHref={current}
              navigate={navigate}
              routeKey={path}
            />
          );
        }
        const isExpanded = expanded.includes(id);
        const controls = `${prefix}-${id}`;
        return (
          <div key={id} className="organization-nav__group" data-tone={group.tone}>
            <button
              type="button"
              className="organization-nav__group-button"
              aria-expanded={isExpanded}
              aria-controls={controls}
              onClick={() => {
                toggleGroup(id);
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
            <div id={controls} hidden={!isExpanded} className="organization-nav__children">
              <FeatureLinks
                items={group.items}
                currentHref={current}
                navigate={(href) => {
                  void navigate(href);
                }}
              />
            </div>
          </div>
        );
      })}
    </nav>
  );
}
