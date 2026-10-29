import { AppLink } from "./navigation";
import type { NavigationItem } from "./types";
import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";

export function ChevronRightIcon() {
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

export function MobileNavItem({
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
