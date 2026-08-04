import { type ReactNode } from "react";
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
  children,
  href,
  onNavigate,
}: {
  readonly ariaCurrent?: "page" | undefined;
  readonly children: ReactNode;
  readonly href: string;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <a
      href={href}
      aria-current={ariaCurrent}
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

export function Navigation({
  groups,
  navigate,
  pathname,
}: {
  readonly groups: readonly NavigationGroup[];
  readonly navigate: (href: string) => void;
  readonly pathname: string;
}) {
  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      {groups.map((group) => (
        <div className="workspace-nav__group" key={group.label}>
          <p className="workspace-nav__label">{group.label}</p>
          <div className="workspace-nav__items">
            {group.items.map((item) => {
              // Keep nested pages grouped with their primary navigation item. For example,
              // library settings should still highlight Music library in the sidebar.
              // The organization home is `/admin`, which is also the prefix for every
              // organization page. It should only be active on the exact home route.
              const isCurrent =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
              return (
                <AppLink
                  ariaCurrent={isCurrent ? "page" : undefined}
                  href={item.href}
                  key={item.href}
                  onNavigate={navigate}
                >
                  <span aria-hidden="true" className="workspace-nav__dot" />
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
