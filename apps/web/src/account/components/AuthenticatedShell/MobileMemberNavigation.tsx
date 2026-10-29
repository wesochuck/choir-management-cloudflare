import { Dialog } from "@choir/ui";
import { useRef, useState, useSyncExternalStore } from "react";
import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";
import { activeHref } from "../../organizationFeatures/navigationUtils";
import { AppLink } from "./navigation";
import { MobileNavItem } from "./mobileNavigation";
import type { NavigationGroup, NavigationItem } from "./types";

type Menu = "practice" | "more";
const phoneQuery = "(max-width: 48rem)";
function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(phoneQuery);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}
function isPhone() {
  return window.matchMedia(phoneQuery).matches;
}

function MemberBottomControls({
  home,
  schedule,
  practice,
  more,
  current,
  activeMenu,
  go,
  onOpen,
  onMenuChange,
}: {
  readonly home: NavigationItem | undefined;
  readonly schedule: NavigationItem | undefined;
  readonly practice: NavigationGroup | undefined;
  readonly more: readonly NavigationItem[];
  readonly current: string | undefined;
  readonly activeMenu: Menu | null;
  readonly go: (href: string) => void;
  readonly onOpen: (element: HTMLElement) => void;
  readonly onMenuChange: (menu: Menu | null) => void;
}) {
  const direct = (item: NavigationItem | undefined, label: string) =>
    item ? (
      <AppLink
        ariaCurrent={current === item.href ? "page" : undefined}
        className="mobile-bottom-nav__item"
        href={item.href}
        onNavigate={go}
      >
        <span className="mobile-bottom-nav__icon-wrap">
          {item.iconId ? (
            <OrganizationFeatureIcon className="mobile-bottom-nav__icon" iconId={item.iconId} />
          ) : null}
        </span>
        <span className="mobile-bottom-nav__label">{label}</span>
      </AppLink>
    ) : null;
  const trigger = (id: Menu, label: string, items: readonly NavigationItem[]) =>
    items.length ? (
      <button
        type="button"
        className="mobile-bottom-nav__item"
        aria-haspopup="dialog"
        aria-expanded={activeMenu === id}
        data-open={activeMenu === id ? "true" : undefined}
        data-active={items.some((item) => item.href === current) ? "true" : undefined}
        onClick={(event) => {
          if (!activeMenu) onOpen(event.currentTarget);
          onMenuChange(activeMenu === id ? null : id);
        }}
      >
        <span className="mobile-bottom-nav__icon-wrap">
          {id === "practice" ? (
            <OrganizationFeatureIcon
              className="mobile-bottom-nav__icon"
              iconId={practice?.iconId ?? "music"}
            />
          ) : (
            <svg
              aria-hidden="true"
              className="mobile-bottom-nav__icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          )}
        </span>
        <span className="mobile-bottom-nav__label">{label}</span>
      </button>
    ) : null;
  return (
    <div className="mobile-bottom-nav__items">
      {direct(home, "Home")}
      {direct(schedule, "Schedule")}
      {trigger("practice", "Practice", practice?.items ?? [])}
      {trigger("more", "More", more)}
    </div>
  );
}

function projectMemberNavigation(groups: readonly NavigationGroup[]) {
  // Project only the already-filtered Member catalog. Desktop placement stays intact.
  const home = groups.find((group) => group.id === "home")?.items[0];
  const membership = groups.find((group) => group.id === "people");
  const schedule = membership?.items.find((item) => item.module === "events");
  const more = membership?.items.filter((item) => item !== schedule) ?? [];
  const practice = groups.find((group) => group.id === "music");
  return {
    home,
    schedule,
    more,
    practice,
    membershipTitle: membership?.label ?? "Your membership",
  };
}

export function MobileMemberNavigation({
  groups,
  navigate,
  path,
}: {
  readonly groups: readonly NavigationGroup[];
  readonly path: string;
  readonly navigate: (href: string) => Promise<boolean>;
}) {
  const phone = useSyncExternalStore(subscribePhone, isPhone);
  const [menu, setMenu] = useState<Menu | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [previousContext, setPreviousContext] = useState({ path, phone });
  if (previousContext.path !== path || previousContext.phone !== phone) {
    setPreviousContext({ path, phone });
    setMenu(null);
  }
  const { home, schedule, more, practice, membershipTitle } = projectMemberNavigation(groups);
  const current = activeHref(groups, path.replace(/^\/calendar(?=[/?]|$)/, "/schedule"));
  const available = { practice: Boolean(practice?.items.length), more: more.length > 0 };
  const activeMenu = menu && available[menu] ? menu : null;
  // Drop unavailable menu state immediately, including during reactive module refreshes.
  if (menu !== activeMenu) setMenu(activeMenu);
  if (!phone) return null;
  const close = () => {
    setMenu(null);
  };
  const go = (href: string) => {
    void navigate(href).then((accepted) => {
      if (accepted) close();
    });
  };
  const controls = (
    <MemberBottomControls
      home={home}
      schedule={schedule}
      practice={practice}
      more={more}
      current={current}
      activeMenu={activeMenu}
      go={go}
      onOpen={(element) => {
        opener.current = element;
      }}
      onMenuChange={setMenu}
    />
  );
  const title =
    activeMenu === "practice" ? (practice?.label ?? "Practice & resources") : membershipTitle;
  return (
    <>
      <nav aria-label="Mobile Member navigation" className="mobile-bottom-nav">
        {controls}
      </nav>
      <Dialog
        open={activeMenu !== null}
        onClose={close}
        title={title}
        dirty={false}
        className="mobile-member-sheet"
        bodyClassName="mobile-bottom-sheet__body"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
        }}
        footer={
          <nav
            aria-label="Mobile Member navigation"
            className="mobile-bottom-nav mobile-bottom-nav--in-sheet"
          >
            {controls}
          </nav>
        }
      >
        <div className="mobile-bottom-sheet__links">
          {(activeMenu === "practice" ? (practice?.items ?? []) : more).map((item) => (
            <MobileNavItem
              key={item.href}
              currentHref={current}
              item={item}
              navigate={navigate}
              onClose={close}
            />
          ))}
        </div>
      </Dialog>
    </>
  );
}
