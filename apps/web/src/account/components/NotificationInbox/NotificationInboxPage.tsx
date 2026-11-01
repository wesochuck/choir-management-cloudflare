import { useState } from "react";
import type { NotificationFilter, OrganizationNotification } from "@choir/contracts";

import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";
import { canAccessDestination, formatRelativeTime, iconIdForKind } from "./types";
import { useNotifications } from "./useNotifications";

const FILTER_TABS: readonly { readonly id: NotificationFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "audition", label: "Auditions" },
  { id: "ticket_sale", label: "Ticket sales" },
  { id: "donation", label: "Donations" },
];

export function NotificationInboxPage({
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
  const [selectedFilter, setSelectedFilter] = useState<NotificationFilter>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<readonly (string | null)[]>([]);

  const { data, isError, isLoading, isMarkingAllRead, markAllRead, markRead, refetch } =
    useNotifications({
      cursor,
      filter: selectedFilter,
      limit: 25,
      organizationId,
      userId,
    });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const nextCursor = data?.nextCursor ?? null;
  const snapshotBoundary = data?.snapshotBoundary;

  const handleFilterChange = (newFilter: NotificationFilter) => {
    setSelectedFilter(newFilter);
    setCursor(null);
    setCursorStack([]);
  };

  const handleNextPage = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(nextCursor);
    window.scrollTo({ behavior: "smooth", top: 0 });
  };

  const handlePrevPage = () => {
    if (cursorStack.length === 0) return;
    const prevCursor = cursorStack.at(-1) ?? null;
    setCursorStack((prev) => prev.slice(0, -1));
    setCursor(prevCursor);
    window.scrollTo({ behavior: "smooth", top: 0 });
  };

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
    }
  };

  return (
    <div className="workspace-page notification-inbox-page">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-header__title">Notifications</h1>
          <p className="page-header__description">
            Personal alerts for audition inquiries, ticket sales, and donations.
          </p>
        </div>
        {unreadCount > 0 ? (
          <button
            className="button button--secondary"
            disabled={isMarkingAllRead}
            onClick={() => {
              void handleMarkAllRead();
            }}
            type="button"
          >
            Mark all as read
          </button>
        ) : null}
      </header>

      <div aria-label="Notification categories" className="tab-bar mb-4" role="tablist">
        {FILTER_TABS.map((tab) => (
          <button
            aria-selected={selectedFilter === tab.id}
            className={`tab-bar__tab ${selectedFilter === tab.id ? "tab-bar__tab--active" : ""}`}
            key={tab.id}
            onClick={() => {
              handleFilterChange(tab.id);
            }}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="notification-inbox-content">
        {isLoading && notifications.length === 0 ? (
          <div className="surface-card p-6 text-center text-muted">Loading notifications…</div>
        ) : isError ? (
          <div className="notice notice--error form-stack p-6" role="alert">
            <p>Could not load notifications.</p>
            <div>
              <button
                className="button button--secondary button--small"
                onClick={() => void refetch()}
                type="button"
              >
                Retry
              </button>
            </div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="surface-card p-8 text-center text-muted">
            {selectedFilter === "unread"
              ? "No unread notifications."
              : "No notifications found in this view."}
          </div>
        ) : (
          <div className="surface-card overflow-hidden">
            <ul className="notification-page-list divide-y divide-border" role="list">
              {notifications.map((notification) => {
                const isUnread = !notification.readAt;
                const hasAuthorizedDestination = canAccessDestination(
                  notification.destinationPath,
                  userRole,
                );

                return (
                  <li
                    className={`notification-page-item p-4 flex items-start gap-4 transition-colors ${
                      isUnread ? "notification-page-item--unread bg-surface-selected/30" : ""
                    }`}
                    key={notification.id}
                  >
                    <div className="pt-1 flex-shrink-0 flex items-center gap-2">
                      {isUnread ? (
                        <span
                          aria-label="Unread"
                          className="notification-item__dot"
                          title="Unread"
                        />
                      ) : (
                        <span className="w-2" />
                      )}
                      <OrganizationFeatureIcon
                        className="notification-item__icon w-5 h-5 text-muted"
                        iconId={iconIdForKind(notification.kind)}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <h2 className="text-base font-semibold text-text truncate">
                          {notification.title}
                        </h2>
                        <time
                          className="text-xs text-muted flex-shrink-0"
                          dateTime={notification.createdAt}
                          title={new Date(notification.createdAt).toLocaleString()}
                        >
                          {formatRelativeTime(notification.createdAt)}
                        </time>
                      </div>
                      <p className="text-sm text-muted mb-2 line-clamp-2">{notification.body}</p>
                      <div className="flex items-center gap-3">
                        {hasAuthorizedDestination ? (
                          <button
                            className="button button--ghost button--small text-primary font-medium"
                            onClick={() => {
                              handleNotificationClick(notification);
                            }}
                            type="button"
                          >
                            View record →
                          </button>
                        ) : null}
                        {isUnread ? (
                          <button
                            className="button button--ghost button--small text-muted hover:text-text"
                            onClick={() => {
                              void markRead(notification.id);
                            }}
                            type="button"
                          >
                            Mark as read
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <nav
              aria-label="Pagination"
              className="p-4 border-t border-border flex items-center justify-between"
            >
              <button
                className="button button--secondary button--small"
                disabled={cursorStack.length === 0}
                onClick={handlePrevPage}
                type="button"
              >
                ← Previous
              </button>
              <button
                className="button button--secondary button--small"
                disabled={!nextCursor}
                onClick={handleNextPage}
                type="button"
              >
                Next →
              </button>
            </nav>
          </div>
        )}
      </main>
    </div>
  );
}

export default NotificationInboxPage;
