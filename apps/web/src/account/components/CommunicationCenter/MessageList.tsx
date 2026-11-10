import type {
  CommunicationDeliverySummary,
  CommunicationMessage,
  OrganizationBranding,
  OrganizationEvent,
  OrganizationVenue,
} from "@choir/contracts";
import { formatTimezoneName } from "@choir/domain";
import { CommunicationDeliveryDetails } from "./CommunicationDeliveryDetails";
import type { MessageOriginFilter, MessageStatusFilter, UnifiedCommunicationItem } from "./types";
import {
  displayDate,
  getEmptyStateText,
  scheduledMessageActionLink,
  scheduledMessageKindLabel,
} from "./utils";

interface MessageListProps {
  readonly branding?: OrganizationBranding | null | undefined;
  readonly busy: boolean;
  readonly currentOrigin: MessageOriginFilter;
  readonly currentStatus: MessageStatusFilter;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly events?: readonly OrganizationEvent[] | undefined;
  readonly loadingDeliveryId: string | null;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
  readonly onCreateFollowUp?: ((message: CommunicationMessage) => Promise<void>) | undefined;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly timezone?: string | null | undefined;
  readonly unifiedMessages: readonly UnifiedCommunicationItem[];
  readonly venues?: readonly OrganizationVenue[] | undefined;
}

interface MessageCardProps {
  readonly branding?: OrganizationBranding | null | undefined;
  readonly busy: boolean;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly events?: readonly OrganizationEvent[] | undefined;
  readonly isLoadingThis: boolean;
  readonly item: UnifiedCommunicationItem;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
  readonly onCreateFollowUp?: ((message: CommunicationMessage) => Promise<void>) | undefined;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly timezone?: string | null | undefined;
  readonly venues?: readonly OrganizationVenue[] | undefined;
}

function MessageCardActions({
  busy,
  isLoadingThis,
  item,
  onCancelQueued,
  onCreateFollowUp,
  onDeleteDraft,
  onOpenDeliveryDetails,
  onResumeDraft,
}: {
  readonly busy: boolean;
  readonly isLoadingThis: boolean;
  readonly item: UnifiedCommunicationItem;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
  readonly onCreateFollowUp?: ((message: CommunicationMessage) => Promise<void>) | undefined;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
}) {
  if (item.kind !== "manual") return null;

  if (item.status === "Draft") {
    return (
      <>
        <button
          className="button button--secondary button--sm"
          disabled={busy}
          onClick={() => {
            onResumeDraft(item.message);
          }}
          type="button"
        >
          Open draft
        </button>
        <button
          className="button button--danger button--sm"
          disabled={busy}
          onClick={() => void onDeleteDraft(item.id)}
          type="button"
        >
          Delete
        </button>
      </>
    );
  }

  if (item.status === "Queued") {
    return (
      <>
        {!item.message.eventPromotion ? (
          <button
            className="button button--secondary button--sm"
            disabled={busy}
            onClick={() => {
              onResumeDraft(item.message);
            }}
            type="button"
          >
            Edit &amp; requeue
          </button>
        ) : null}
        <button
          className="button button--secondary button--sm"
          disabled={busy}
          onClick={() => void onCancelQueued(item.id)}
          type="button"
        >
          Cancel message
        </button>
        <button
          className="button button--secondary button--sm"
          disabled={busy || isLoadingThis}
          onClick={() => void onOpenDeliveryDetails(item.message)}
          type="button"
        >
          {isLoadingThis ? "Loading…" : "View delivery details"}
        </button>
      </>
    );
  }

  return (
    <>
      <button
        className="button button--secondary button--sm"
        disabled={busy || isLoadingThis}
        onClick={() => void onOpenDeliveryDetails(item.message)}
        type="button"
      >
        {isLoadingThis ? "Loading…" : "View delivery details"}
      </button>
      {item.message.eventPromotion && onCreateFollowUp ? (
        <button
          className="button button--secondary button--sm"
          disabled={busy}
          onClick={() => void onCreateFollowUp(item.message)}
          type="button"
        >
          Create follow-up
        </button>
      ) : null}
    </>
  );
}

function MessageTimestamp({ item }: { readonly item: UnifiedCommunicationItem }) {
  const timezone = item.kind === "scheduled" ? item.scheduledMessage.timezone : undefined;
  const date = timezone
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone,
      }).format(new Date(item.timestamp))
    : displayDate(item.timestamp);
  const tzLabel = timezone ? formatTimezoneName(timezone, item.timestamp) : "";
  return (
    <span>
      {item.status === "Scheduled" ? "Scheduled for " : ""}
      {date}
      {tzLabel ? ` (${tzLabel})` : ""}
    </span>
  );
}

function AutomationContext({ item }: { readonly item: UnifiedCommunicationItem }) {
  if (item.kind !== "scheduled") return null;
  const action = scheduledMessageActionLink(item.scheduledMessage);
  return (
    <>
      {item.scheduledMessage.projected ? (
        <p className="field-help">
          Automation preview. Recipients and eligibility are checked at send time.
        </p>
      ) : null}
      {action ? (
        <a className="text-link" href={action.href}>
          {action.label}
        </a>
      ) : null}
    </>
  );
}

function QueuedByMetadata({ item }: { readonly item: UnifiedCommunicationItem }) {
  if (item.kind !== "manual" || !item.message.queuedByName) return null;
  return (
    <>
      <span>·</span>
      <span>Queued by {item.message.queuedByName}</span>
    </>
  );
}

function MessageCard({
  branding,
  busy,
  deliveryDetailsMessage,
  deliverySummary,
  events,
  isLoadingThis,
  item,
  onCancelQueued,
  onCreateFollowUp,
  onDeleteDraft,
  onOpenDeliveryDetails,
  onResumeDraft,
  onRetryDeliveries,
  timezone,
  venues,
}: MessageCardProps) {
  const isDetailsOpen =
    item.kind === "manual" && deliveryDetailsMessage?.id === item.id && deliverySummary !== null;

  return (
    <article
      aria-label={`${item.title} (${item.status})`}
      className={`communication-history-entry communication-message-card communication-message-card--${item.status.toLowerCase()}`}
    >
      <div className="communication-history-entry__header">
        <div className="communication-history-entry__title-area">
          <div className="communication-history-entry__title-row">
            <h3 className="communication-history-entry__title">{item.title}</h3>
            <div className="communication-history-entry__badges">
              {item.automated ? (
                <span className="status-pill status-pill--automated">Automated</span>
              ) : null}
              <span className={`status-pill status-pill--${item.status.toLowerCase()}`}>
                {item.status}
              </span>
            </div>
          </div>

          <div className="communication-history-entry__meta">
            <span>{item.channel}</span>
            <span>·</span>
            <MessageTimestamp item={item} />
            {item.kind === "manual" && item.recipientCount > 0 ? (
              <>
                <span>·</span>
                <span>
                  {String(item.recipientCount)}{" "}
                  {item.recipientCount === 1 ? "recipient" : "recipients"}
                </span>
              </>
            ) : null}
            <QueuedByMetadata item={item} />
            <CheckoutReminderMetadata item={item} />
            {item.kind === "scheduled" &&
            item.scheduledMessage.projected &&
            item.scheduledMessage.kind === "ticket_reminder" ? (
              <>
                <span>·</span>
                <span>
                  {String(item.scheduledMessage.recipientCount)} ticket{" "}
                  {item.scheduledMessage.recipientCount === 1 ? "purchase" : "purchases"}
                </span>
              </>
            ) : null}
            {item.automated ? (
              <>
                <span>·</span>
                <span>{scheduledMessageKindLabel(item.scheduledMessage.kind)}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="communication-history-actions">
          <MessageCardActions
            busy={busy}
            isLoadingThis={isLoadingThis}
            item={item}
            onCancelQueued={onCancelQueued}
            onCreateFollowUp={onCreateFollowUp}
            onDeleteDraft={onDeleteDraft}
            onOpenDeliveryDetails={onOpenDeliveryDetails}
            onResumeDraft={onResumeDraft}
          />
        </div>
      </div>

      <AutomationContext item={item} />
      {isDetailsOpen ? (
        <div className="communication-message-card__details-panel">
          <CommunicationDeliveryDetails
            branding={branding}
            busy={busy}
            events={events}
            message={item.message}
            onRetry={() => onRetryDeliveries(item.id)}
            summary={deliverySummary}
            timezone={timezone}
            venues={venues}
          />
        </div>
      ) : null}
    </article>
  );
}

export function MessageList({
  branding,
  busy,
  currentOrigin,
  currentStatus,
  deliveryDetailsMessage,
  deliverySummary,
  events,
  loadingDeliveryId,
  onCancelQueued,
  onCreateFollowUp,
  onDeleteDraft,
  onOpenDeliveryDetails,
  onResumeDraft,
  onRetryDeliveries,
  timezone,
  unifiedMessages,
  venues,
}: MessageListProps) {
  if (unifiedMessages.length === 0) {
    return (
      <div className="communication-empty-state notice notice--info" role="status">
        <p>{getEmptyStateText(currentStatus, currentOrigin)}</p>
      </div>
    );
  }

  return (
    <div className="communication-message-list">
      {unifiedMessages.map((item) => (
        <MessageCard
          branding={branding}
          busy={busy}
          deliveryDetailsMessage={deliveryDetailsMessage}
          deliverySummary={deliverySummary}
          events={events}
          isLoadingThis={loadingDeliveryId === item.id}
          item={item}
          key={`${item.kind}:${item.id}`}
          onCancelQueued={onCancelQueued}
          onCreateFollowUp={onCreateFollowUp}
          onDeleteDraft={onDeleteDraft}
          onOpenDeliveryDetails={onOpenDeliveryDetails}
          onResumeDraft={onResumeDraft}
          onRetryDeliveries={onRetryDeliveries}
          timezone={timezone}
          venues={venues}
        />
      ))}
    </div>
  );
}

function CheckoutReminderMetadata({ item }: { readonly item: UnifiedCommunicationItem }) {
  return (
    <>
      {item.automated && item.scheduledMessage.recipientEmail ? (
        <span>{item.scheduledMessage.recipientEmail}</span>
      ) : null}
      {item.automated && item.scheduledMessage.skipReason ? (
        <span>{item.scheduledMessage.skipReason.replaceAll("_", " ")}</span>
      ) : null}
    </>
  );
}
