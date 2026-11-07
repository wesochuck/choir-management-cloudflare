import type { OrganizationNotification } from "@choir/contracts";

import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";
import { canAccessDestination, formatRelativeTime, iconIdForKind } from "./types";

const CATEGORY_LABELS: Record<OrganizationNotification["kind"], string> = {
  audition: "Audition",
  ticket_sale: "Ticket sale",
  donation: "Donation",
  rsvp_decline: "RSVP decline",
  compliance: "Compliance",
};

export function NotificationInboxRow({
  initiallyExpanded,
  notification,
  onMarkRead,
  onViewRecord,
  userRole,
}: {
  readonly initiallyExpanded: boolean;
  readonly notification: OrganizationNotification;
  readonly onMarkRead: () => void;
  readonly onViewRecord: () => void;
  readonly userRole: string | null | undefined;
}) {
  const isUnread = !notification.readAt;
  return (
    <li className={`notification-page-item${isUnread ? " notification-page-item--unread" : ""}`}>
      <OrganizationFeatureIcon
        className="notification-page-item__icon"
        iconId={iconIdForKind(notification.kind)}
      />
      <div className="notification-page-item__content">
        <div className="notification-page-item__metadata">
          <span>{CATEGORY_LABELS[notification.kind]}</span>
          <time
            dateTime={notification.createdAt}
            title={new Date(notification.createdAt).toLocaleString()}
          >
            {formatRelativeTime(notification.createdAt)}
          </time>
          {isUnread ? <span className="notification-page-item__unread-label">Unread</span> : null}
        </div>
        <details className="notification-page-item__details" open={initiallyExpanded}>
          <summary className="notification-page-item__summary">
            <h2>{notification.title}</h2>
            <span className="notification-page-item__hint">Show details</span>
          </summary>
          <div className="notification-page-item__body">
            <p>{notification.body}</p>
            <div className="notification-page-item__actions">
              {canAccessDestination(notification.destinationPath, userRole) ? (
                <button
                  className="button button--ghost button--small"
                  onClick={onViewRecord}
                  type="button"
                >
                  View record →
                </button>
              ) : null}
              {isUnread ? (
                <button
                  className="button button--ghost button--small"
                  onClick={onMarkRead}
                  type="button"
                >
                  Mark as read
                </button>
              ) : null}
            </div>
          </div>
        </details>
      </div>
    </li>
  );
}
