import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useId, useState } from "react";
import { AppLink } from "../components/AuthenticatedShell/navigation";
import type { NavigationGroup, NavigationItem } from "../components/AuthenticatedShell/types";
import { activeHref } from "./navigationUtils";
import { OrganizationFeatureIcon } from "./OrganizationFeatureIcon";
import type { OrganizationGroupId } from "./types";

export interface MobileOrganizationAdminNavigationProps {
  readonly groups: readonly NavigationGroup[];
  readonly path: string;
  readonly navigate: (href: string) => Promise<boolean>;
  readonly onSearch: () => void;
}

type ActiveMenu = "people" | "events" | "more" | null;

function isOrganizationGroupId(id: string | undefined): id is OrganizationGroupId {
  return (
    id === "people" ||
    id === "events" ||
    id === "music" ||
    id === "communications" ||
    id === "finance" ||
    id === "insights"
  );
}

function MoreHorizontalIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-bottom-nav__icon"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-bottom-sheet__chevron"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

interface BottomNavButtonsProps {
  readonly activeMenu: ActiveMenu;
  readonly onToggleMenu: (menu: "people" | "events" | "more") => void;
  readonly onHomeClick: () => void;
  readonly isHomeActive: boolean;
  readonly isPeopleActive: boolean;
  readonly isEventsActive: boolean;
  readonly isMoreActive: boolean;
  readonly sheetId?: string | undefined;
}

function BottomNavButtons({
  activeMenu,
  isEventsActive,
  isHomeActive,
  isMoreActive,
  isPeopleActive,
  onHomeClick,
  onToggleMenu,
  sheetId,
}: BottomNavButtonsProps) {
  return (
    <div className="mobile-bottom-nav__items" role="group" aria-label="Main navigation items">
      <button
        aria-label="Home"
        className="mobile-bottom-nav__item"
        data-active={isHomeActive ? "true" : undefined}
        onClick={onHomeClick}
        type="button"
      >
        <span className="mobile-bottom-nav__icon-wrap">
          <OrganizationFeatureIcon className="mobile-bottom-nav__icon" iconId="home" />
        </span>
        <span className="mobile-bottom-nav__label">Home</span>
      </button>

      <button
        aria-controls={sheetId}
        aria-expanded={activeMenu === "people"}
        aria-haspopup="dialog"
        aria-label="People"
        className="mobile-bottom-nav__item"
        data-active={isPeopleActive ? "true" : undefined}
        data-open={activeMenu === "people" ? "true" : undefined}
        onClick={() => {
          onToggleMenu("people");
        }}
        type="button"
      >
        <span className="mobile-bottom-nav__icon-wrap">
          <OrganizationFeatureIcon className="mobile-bottom-nav__icon" iconId="roster" />
        </span>
        <span className="mobile-bottom-nav__label">People</span>
      </button>

      <button
        aria-controls={sheetId}
        aria-expanded={activeMenu === "events"}
        aria-haspopup="dialog"
        aria-label="Events"
        className="mobile-bottom-nav__item"
        data-active={isEventsActive ? "true" : undefined}
        data-open={activeMenu === "events" ? "true" : undefined}
        onClick={() => {
          onToggleMenu("events");
        }}
        type="button"
      >
        <span className="mobile-bottom-nav__icon-wrap">
          <OrganizationFeatureIcon className="mobile-bottom-nav__icon" iconId="events" />
        </span>
        <span className="mobile-bottom-nav__label">Events</span>
      </button>

      <button
        aria-controls={sheetId}
        aria-expanded={activeMenu === "more"}
        aria-haspopup="dialog"
        aria-label="More"
        className="mobile-bottom-nav__item"
        data-active={isMoreActive ? "true" : undefined}
        data-open={activeMenu === "more" ? "true" : undefined}
        onClick={() => {
          onToggleMenu("more");
        }}
        type="button"
      >
        <span className="mobile-bottom-nav__icon-wrap">
          <MoreHorizontalIcon />
        </span>
        <span className="mobile-bottom-nav__label">More</span>
      </button>
    </div>
  );
}

function MobileNavItem({
  currentHref,
  item,
  navigate,
  onClose,
}: {
  readonly item: NavigationItem;
  readonly currentHref: string | undefined;
  readonly navigate: (href: string) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const isCurrent = item.href === currentHref;
  return (
    <AppLink
      ariaCurrent={isCurrent ? "page" : undefined}
      className={`mobile-bottom-sheet__link${isCurrent ? " mobile-bottom-sheet__link--active" : ""}`}
      href={item.href}
      onNavigate={(href) => {
        void navigate(href).then((allowed) => {
          if (allowed) onClose();
        });
      }}
    >
      <span className="mobile-bottom-sheet__link-icon">
        {item.iconId ? <OrganizationFeatureIcon iconId={item.iconId} /> : null}
      </span>
      <span className="mobile-bottom-sheet__link-label">{item.label}</span>
      <ChevronRightIcon />
    </AppLink>
  );
}

function MoreCategoriesList({
  categories,
  onOpenCategory,
  onSearch,
}: {
  readonly categories: readonly NavigationGroup[];
  readonly onOpenCategory: (id: OrganizationGroupId) => void;
  readonly onSearch: () => void;
}) {
  return (
    <div className="mobile-bottom-sheet__links" role="group" aria-label="More sections">
      {categories.map((group) => {
        if (!isOrganizationGroupId(group.id)) return null;
        const groupId = group.id;
        return (
          <button
            className="mobile-bottom-sheet__category-button"
            data-tone={group.tone}
            key={group.id}
            onClick={() => {
              onOpenCategory(groupId);
            }}
            type="button"
          >
            <span className="mobile-bottom-sheet__category-chip">
              {group.iconId ? <OrganizationFeatureIcon iconId={group.iconId} /> : null}
            </span>
            <span className="mobile-bottom-sheet__link-label">{group.label}</span>
            <ChevronRightIcon />
          </button>
        );
      })}
      <button className="mobile-bottom-sheet__category-button" onClick={onSearch} type="button">
        <span className="mobile-bottom-sheet__category-chip">
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <circle cx="10" cy="10" r="7" />
            <path d="m15 15 6 6" />
          </svg>
        </span>
        <span className="mobile-bottom-sheet__link-label">Quick search</span>
        <ChevronRightIcon />
      </button>
    </div>
  );
}

interface MobileAdminSheetContentProps {
  readonly activeMenu: ActiveMenu;
  readonly current: string | undefined;
  readonly handleClose: () => void;
  readonly handleHomeClick: () => void;
  readonly handleSearchClick: () => void;
  readonly handleToggleMenu: (menu: "people" | "events" | "more") => void;
  readonly isEventsActive: boolean;
  readonly isHomeActive: boolean;
  readonly isMoreActive: boolean;
  readonly isPeopleActive: boolean;
  readonly itemsToRender: readonly NavigationItem[];
  readonly moreGroups: readonly NavigationGroup[];
  readonly navigate: (href: string) => Promise<boolean>;
  readonly selectedMoreGroup: NavigationGroup | null;
  readonly setMoreCategory: (category: OrganizationGroupId | null) => void;
  readonly sheetId: string;
  readonly sheetTitle: string;
}

function MobileAdminSheetContent({
  activeMenu,
  current,
  handleClose,
  handleHomeClick,
  handleSearchClick,
  handleToggleMenu,
  isEventsActive,
  isHomeActive,
  isMoreActive,
  isPeopleActive,
  itemsToRender,
  moreGroups,
  navigate,
  selectedMoreGroup,
  setMoreCategory,
  sheetId,
  sheetTitle,
}: MobileAdminSheetContentProps) {
  return (
    <DialogPrimitive.Content aria-modal="true" className="sheet mobile-bottom-sheet" id={sheetId}>
      <div aria-hidden="true" className="mobile-bottom-sheet__handle" />
      <div className="mobile-bottom-sheet__header">
        {activeMenu === "more" && selectedMoreGroup ? (
          <button
            aria-label="Back to More"
            className="mobile-bottom-sheet__back"
            onClick={() => {
              setMoreCategory(null);
            }}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              focusable="false"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>Back</span>
          </button>
        ) : null}
        <DialogPrimitive.Title className="mobile-bottom-sheet__title">
          {sheetTitle}
        </DialogPrimitive.Title>
        <DialogPrimitive.Close asChild>
          <button
            aria-label={`Close ${sheetTitle}`}
            className="mobile-bottom-sheet__close"
            onClick={handleClose}
            type="button"
          >
            &times;
          </button>
        </DialogPrimitive.Close>
      </div>

      <div className="mobile-bottom-sheet__body">
        {activeMenu === "more" && !selectedMoreGroup ? (
          <MoreCategoriesList
            categories={moreGroups}
            onOpenCategory={setMoreCategory}
            onSearch={handleSearchClick}
          />
        ) : (
          <div className="mobile-bottom-sheet__links" role="group" aria-label={sheetTitle}>
            {itemsToRender.map((item) => (
              <MobileNavItem
                currentHref={current}
                item={item}
                key={item.href}
                navigate={navigate}
                onClose={handleClose}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mobile-bottom-nav mobile-bottom-nav--in-sheet">
        <BottomNavButtons
          activeMenu={activeMenu}
          isEventsActive={isEventsActive}
          isHomeActive={isHomeActive}
          isMoreActive={isMoreActive}
          isPeopleActive={isPeopleActive}
          onHomeClick={handleHomeClick}
          onToggleMenu={handleToggleMenu}
          sheetId={sheetId}
        />
      </div>
    </DialogPrimitive.Content>
  );
}

function resolveSheetContent(
  activeMenu: ActiveMenu,
  peopleGroup: NavigationGroup | undefined,
  eventsGroup: NavigationGroup | undefined,
  selectedMoreGroup: NavigationGroup | null,
): { readonly itemsToRender: readonly NavigationItem[]; readonly sheetTitle: string } {
  if (activeMenu === "people") {
    return {
      itemsToRender: peopleGroup?.items ?? [],
      sheetTitle: peopleGroup?.label ?? "People & membership",
    };
  }
  if (activeMenu === "events") {
    return {
      itemsToRender: eventsGroup?.items ?? [],
      sheetTitle: eventsGroup?.label ?? "Events & attendance",
    };
  }
  if (activeMenu === "more") {
    return {
      itemsToRender: selectedMoreGroup?.items ?? [],
      sheetTitle: selectedMoreGroup ? selectedMoreGroup.label : "More",
    };
  }
  return { itemsToRender: [], sheetTitle: "" };
}

export function MobileOrganizationAdminNavigation({
  groups,
  navigate,
  onSearch,
  path,
}: MobileOrganizationAdminNavigationProps) {
  const sheetId = useId();
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [moreCategory, setMoreCategory] = useState<OrganizationGroupId | null>(null);

  const [prevPath, setPrevPath] = useState(path);

  if (prevPath !== path) {
    setPrevPath(path);
    setActiveMenu(null);
    setMoreCategory(null);
  }

  const current = activeHref(groups, path);

  const activeGroupId = groups.find((g) =>
    g.items.some((item) => {
      const target = item.href.split("?")[0];
      const canonical = current?.split("?")[0];
      return (
        target === canonical ||
        (target && target !== "/admin" && canonical?.startsWith(`${target}/`))
      );
    }),
  )?.id;

  const peopleGroup = groups.find((g) => g.id === "people");
  const eventsGroup = groups.find((g) => g.id === "events");
  const moreGroups = groups.filter(
    (g) => g.id && g.id !== "home" && g.id !== "people" && g.id !== "events",
  );

  const isHomeActive = current === "/admin" || activeGroupId === "home";
  const isPeopleActive = activeGroupId === "people";
  const isEventsActive = activeGroupId === "events";
  const isMoreActive = moreGroups.some((g) => g.id === activeGroupId);

  const handleToggleMenu = (menu: "people" | "events" | "more") => {
    if (activeMenu === menu) {
      setActiveMenu(null);
      setMoreCategory(null);
    } else {
      setActiveMenu(menu);
      setMoreCategory(null);
    }
  };

  const handleClose = () => {
    setActiveMenu(null);
    setMoreCategory(null);
  };

  const handleHomeClick = () => {
    void navigate("/admin").then((allowed) => {
      if (allowed) handleClose();
    });
  };

  const handleSearchClick = () => {
    handleClose();
    onSearch();
  };

  const selectedMoreGroup = moreCategory
    ? (moreGroups.find((g) => g.id === moreCategory) ?? null)
    : null;

  const { itemsToRender, sheetTitle } = resolveSheetContent(
    activeMenu,
    peopleGroup,
    eventsGroup,
    selectedMoreGroup,
  );

  return (
    <>
      <nav aria-label="Mobile workspace navigation" className="mobile-bottom-nav">
        <BottomNavButtons
          activeMenu={activeMenu}
          isEventsActive={isEventsActive}
          isHomeActive={isHomeActive}
          isMoreActive={isMoreActive}
          isPeopleActive={isPeopleActive}
          onHomeClick={handleHomeClick}
          onToggleMenu={handleToggleMenu}
          sheetId={sheetId}
        />
      </nav>

      <DialogPrimitive.Root
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
        open={activeMenu !== null}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="dialog__overlay mobile-bottom-sheet__overlay" />
          <MobileAdminSheetContent
            activeMenu={activeMenu}
            current={current}
            handleClose={handleClose}
            handleHomeClick={handleHomeClick}
            handleSearchClick={handleSearchClick}
            handleToggleMenu={handleToggleMenu}
            isEventsActive={isEventsActive}
            isHomeActive={isHomeActive}
            isMoreActive={isMoreActive}
            isPeopleActive={isPeopleActive}
            itemsToRender={itemsToRender}
            moreGroups={moreGroups}
            navigate={navigate}
            selectedMoreGroup={selectedMoreGroup}
            setMoreCategory={setMoreCategory}
            sheetId={sheetId}
            sheetTitle={sheetTitle}
          />
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
