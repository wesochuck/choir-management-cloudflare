import { useEffect, useRef } from "react";
import type { OrganizationNotification } from "@choir/contracts";

import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";
import { canAccessDestination, formatRelativeTime, iconIdForKind } from "./types";
import { useNotifications } from "./useNotifications";

export function NotificationPopout({
  isOpen,
  onClose,
  onNavigate,
  organizationId,
  triggerRef,
  userId,
  userRole,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (href: string) => void;
  readonly organizationId: string | null | undefined;
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly userId: string | null | undefined;
  readonly userRole: string | null | undefined;
}) {
  const popoutRef = useRef<HTMLDivElement>(null);

  const { data, isError, isLoading, isMarkingAllRead, markAllRead, markRead, refetch } =
    useNotifications({
      enabled: isOpen,
      limit: 5,
      organizationId,
      userId,
    });

  // Refetch fresh data when opening popout
  useEffect(() => {
    if (isOpen) {
      void refetch();
    }
  }, [isOpen, refetch]);

  // Click outside and escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        triggerRef.current?.focus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (
        popoutRef.current &&
        !popoutRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const snapshotBoundary = data?.snapshotBoundary;

  const handleMarkAllRead = async () => {
    if (!snapshotBoundary) return;
    try {
      await markAllRead(snapshotBoundary);
    } catch {
      // Error handled by query state
    }
  };

  const handleNotificationClick = (notification: OrganizationNotification) => {
    if (!notification.readAt) {
      void markRead(notification.id);
    }
    if (
      notification.destinationPath &&
      canAccessDestination(notification.destinationPath, userRole)
    ) {
      onNavigate(notification.destinationPath);
      onClose();
    }
  };

  return (
    <div
      aria-label="Notifications"
      aria-modal="false"
      className="notification-popout"
      id="notification-popout"
      ref={popoutRef}
      role="region"
    >
      <div className="notification-popout__header">
        <h2 className="notification-popout__title">Notifications</h2>
        {unreadCount > 0 ? (
          <button
            className="button button--secondary button--small"
            disabled={isMarkingAllRead}
            onClick={() => {
              void handleMarkAllRead();
            }}
            type="button"
          >
            Mark all as read
          </button>
        ) : null}
      </div>

      <div className="notification-popout__content">
        {isLoading && notifications.length === 0 ? (
          <div className="notification-popout__empty">Loading notifications…</div>
        ) : isError ? (
          <div className="notification-popout__error">
            <p>Could not load notifications.</p>
            <button
              className="button button--secondary button--small"
              onClick={() => void refetch()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="notification-popout__empty">No notifications yet.</div>
        ) : (
          <ul className="notification-list" role="list">
            {notifications.map((notification) => {
              const isUnread = !notification.readAt;
              const hasAuthorizedDestination = canAccessDestination(
                notification.destinationPath,
                userRole,
              );

              return (
                <li
                  className={`notification-item ${isUnread ? "notification-item--unread" : ""}`}
                  key={notification.id}
                >
                  <button
                    aria-label={`${isUnread ? "Unread notification: " : ""}${notification.title}`}
                    className="notification-item__action"
                    onClick={() => {
                      handleNotificationClick(notification);
                    }}
                    type="button"
                  >
                    {isUnread ? (
                      <span aria-hidden="true" className="notification-item__dot" />
                    ) : null}
                    <OrganizationFeatureIcon
                      className="notification-item__icon"
                      iconId={iconIdForKind(notification.kind)}
                    />
                    <div className="notification-item__content">
                      <div className="notification-item__title">{notification.title}</div>
                      <div className="notification-item__body">{notification.body}</div>
                      <time
                        className="notification-item__time"
                        dateTime={notification.createdAt}
                        title={new Date(notification.createdAt).toLocaleString()}
                      >
                        {formatRelativeTime(notification.createdAt)}
                      </time>
                    </div>
                  </button>
                  {isUnread && !hasAuthorizedDestination ? (
                    <button
                      aria-label={`Mark "${notification.title}" as read`}
                      className="button button--ghost button--small notification-item__read-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void markRead(notification.id);
                      }}
                      type="button"
                    >
                      Mark read
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="notification-popout__footer">
        <button
          className="button button--ghost notification-popout__view-all"
          onClick={() => {
            onNavigate("/account/notifications");
            onClose();
          }}
          type="button"
        >
          View all notifications
        </button>
      </div>
    </div>
  );
}
