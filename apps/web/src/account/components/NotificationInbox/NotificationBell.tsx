import { useRef, useState } from "react";

import { readNarrowViewport } from "../AuthenticatedShell/sidebarTransitions";
import { NotificationPopout } from "./NotificationPopout";
import { useNotifications } from "./useNotifications";

export function NotificationBell({
  onNavigate,
  organizationId,
  userId,
  userRole,
}: {
  readonly onNavigate: (href: string) => void;
  readonly organizationId: string | null | undefined;
  readonly userId: string | null | undefined;
  readonly userRole: string | null | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { data } = useNotifications({
    enabled: Boolean(organizationId && userId),
    limit: 1,
    organizationId,
    userId,
  });

  const unreadCount = data?.unreadCount ?? 0;
  const hasMoreUnread = data?.hasMoreUnread ?? false;
  const badgeLabel = unreadCount > 99 || hasMoreUnread ? "99+" : String(unreadCount);

  const handleClick = () => {
    if (readNarrowViewport()) {
      setIsOpen(false);
      onNavigate("/account/notifications");
    } else {
      setIsOpen((prev) => !prev);
    }
  };

  const accessibleLabel = `Notifications${unreadCount > 0 ? `, ${badgeLabel} unread` : ""}`;

  return (
    <div className="notification-bell-container">
      <button
        aria-controls="notification-popout"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={accessibleLabel}
        className="notification-bell-button theme-switcher"
        onClick={handleClick}
        ref={triggerRef}
        title={accessibleLabel}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="notification-bell-icon"
          fill="none"
          focusable="false"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
          viewBox="0 0 24 24"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 ? (
          <span aria-hidden="true" className="notification-bell__badge">
            {badgeLabel}
          </span>
        ) : null}
      </button>

      <NotificationPopout
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
        }}
        onNavigate={onNavigate}
        organizationId={organizationId}
        triggerRef={triggerRef}
        userId={userId}
        userRole={userRole}
      />
    </div>
  );
}
