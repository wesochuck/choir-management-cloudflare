import { Dialog } from "@choir/ui";
import { useRef, useState, useSyncExternalStore } from "react";
import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";
import { activeHref } from "../../organizationFeatures/navigationUtils";
import { AppLink } from "./navigation";
import { MobileNavItem } from "./mobileNavigation";
import type { NavigationGroup, NavigationItem } from "./types";

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
  moreOpen,
  go,
  onOpen,
  onMoreToggle,
}: {
  readonly home: NavigationItem | undefined;
  readonly schedule: NavigationItem | undefined;
  readonly practice: NavigationItem | undefined;
  readonly more: readonly NavigationItem[];
  readonly current: string | undefined;
  readonly moreOpen: boolean;
  readonly go: (href: string) => void;
  readonly onOpen: (element: HTMLElement) => void;
  readonly onMoreToggle: () => void;
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
  return (
    <div className="mobile-bottom-nav__items">
      {direct(home, "Home")}
      {direct(schedule, "Schedule")}
      {direct(practice, "Practice")}
      {more.length ? (
        <button
          type="button"
          className="mobile-bottom-nav__item"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          data-open={moreOpen ? "true" : undefined}
          data-active={more.some((item) => item.href === current) ? "true" : undefined}
          onClick={(event) => {
            if (!moreOpen) onOpen(event.currentTarget);
            onMoreToggle();
          }}
        >
          <span className="mobile-bottom-nav__icon-wrap">
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
          </span>
          <span className="mobile-bottom-nav__label">More</span>
        </button>
      ) : null}
    </div>
  );
}

function projectMemberNavigation(groups: readonly NavigationGroup[]) {
  // Project only the already-filtered Member catalog. Desktop placement stays intact.
  // Practice opens the player directly; every other music item (Resources) joins More.
  const home = groups.find((group) => group.id === "home")?.items[0];
  const membership = groups.find((group) => group.id === "people");
  const schedule = membership?.items.find((item) => item.module === "events");
  const music = groups.find((group) => group.id === "music")?.items ?? [];
  const practice = music.find((item) => item.module === "practice_player");
  const more = [
    ...(membership?.items.filter((item) => item !== schedule) ?? []),
    ...music.filter((item) => item !== practice),
  ];
  return { home, schedule, practice, more };
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
  const [menuOpen, setMenuOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const [previousContext, setPreviousContext] = useState({ path, phone });
  if (previousContext.path !== path || previousContext.phone !== phone) {
    setPreviousContext({ path, phone });
    setMenuOpen(false);
  }
  const { home, schedule, practice, more } = projectMemberNavigation(groups);
  const current = activeHref(groups, path.replace(/^\/calendar(?=[/?]|$)/, "/schedule"));
  const moreOpen = menuOpen && more.length > 0;
  // Drop unavailable menu state immediately, including during reactive module refreshes.
  if (menuOpen !== moreOpen) setMenuOpen(moreOpen);
  if (!phone) return null;
  const close = () => {
    setMenuOpen(false);
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
      moreOpen={moreOpen}
      go={go}
      onOpen={(element) => {
        opener.current = element;
      }}
      onMoreToggle={() => {
        setMenuOpen(!moreOpen);
      }}
    />
  );
  return (
    <>
      <nav aria-label="Mobile Member navigation" className="mobile-bottom-nav">
        {controls}
      </nav>
      <Dialog
        open={moreOpen}
        onClose={close}
        title="More"
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
          {more.map((item) => (
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
