import { useState } from "react";
import type { NotificationFilter, OrganizationNotification } from "@choir/contracts";

import { NotificationInboxRow } from "./NotificationInboxRow";
import { canAccessDestination } from "./types";
import { useNotifications } from "./useNotifications";

const FILTER_OPTIONS: readonly { readonly id: NotificationFilter; readonly label: string }[] = [
  { id: "all", label: "All notifications" },
  { id: "unread", label: "Unread" },
  { id: "audition", label: "Auditions" },
  { id: "ticket_sale", label: "Ticket sales" },
  { id: "donation", label: "Donations" },
  { id: "rsvp_decline", label: "RSVP declines" },
  { id: "compliance", label: "Compliance" },
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
          <p className="page-header__description">Your recent activity.</p>
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

      <div className="notification-inbox-filter">
        <label className="sr-only" htmlFor="notification-filter">
          Show notifications
        </label>
        <select
          id="notification-filter"
          value={selectedFilter}
          onChange={(event) => {
            const filter = FILTER_OPTIONS.find((candidate) => candidate.id === event.target.value);
            if (filter) handleFilterChange(filter.id);
          }}
        >
          {FILTER_OPTIONS.map((filter) => (
            <option key={filter.id} value={filter.id}>
              {filter.label}
            </option>
          ))}
        </select>
      </div>

      <section aria-label="Notification inbox" className="notification-inbox-content">
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
          <>
            <ul className="notification-page-list" aria-label="Notifications">
              {notifications.map((notification, index) => (
                <NotificationInboxRow
                  initiallyExpanded={index === 0}
                  key={`${organizationId ?? ""}:${userId ?? ""}:${selectedFilter}:${cursor ?? "first"}:${notification.id}`}
                  notification={notification}
                  onMarkRead={() => {
                    void markRead(notification.id);
                  }}
                  onViewRecord={() => {
                    handleNotificationClick(notification);
                  }}
                  userRole={userRole}
                />
              ))}
            </ul>
            <p className="notification-inbox-count" role="status">
              {notifications.length} {notifications.length === 1 ? "notification" : "notifications"}{" "}
              on this page
            </p>
            <nav aria-label="Pagination" className="notification-inbox-pagination">
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
          </>
        )}
      </section>
    </div>
  );
}

export default NotificationInboxPage;
