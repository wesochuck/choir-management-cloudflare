import type { CommunicationDeliverySummary, CommunicationMessage } from "@choir/contracts";
import { CommunicationDeliveryDetails } from "./CommunicationDeliveryDetails";
import type { UnifiedCommunicationItem } from "./types";
import { displayDate, scheduledMessageKindLabel } from "./utils";

interface MessageListProps {
  readonly busy: boolean;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly loadingDeliveryId: string | null;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly unifiedMessages: readonly UnifiedCommunicationItem[];
}

interface MessageCardProps {
  readonly busy: boolean;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly isLoadingThis: boolean;
  readonly item: UnifiedCommunicationItem;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
}

function MessageCardActions({
  busy,
  isLoadingThis,
  item,
  onCancelQueued,
  onDeleteDraft,
  onOpenDeliveryDetails,
  onResumeDraft,
}: {
  readonly busy: boolean;
  readonly isLoadingThis: boolean;
  readonly item: UnifiedCommunicationItem;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
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

  if (item.status === "Sent" || item.status === "Failed") {
    return (
      <button
        className="button button--secondary button--sm"
        disabled={busy || isLoadingThis}
        onClick={() => void onOpenDeliveryDetails(item.message)}
        type="button"
      >
        {isLoadingThis ? "Loading…" : "View delivery details"}
      </button>
    );
  }

  return null;
}

function MessageCard({
  busy,
  deliveryDetailsMessage,
  deliverySummary,
  isLoadingThis,
  item,
  onCancelQueued,
  onDeleteDraft,
  onOpenDeliveryDetails,
  onResumeDraft,
  onRetryDeliveries,
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
            <span>{displayDate(item.timestamp)}</span>
            {item.kind === "manual" && item.recipientCount > 0 ? (
              <>
                <span>·</span>
                <span>
                  {String(item.recipientCount)}{" "}
                  {item.recipientCount === 1 ? "recipient" : "recipients"}
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
            onDeleteDraft={onDeleteDraft}
            onOpenDeliveryDetails={onOpenDeliveryDetails}
            onResumeDraft={onResumeDraft}
          />
        </div>
      </div>

      {isDetailsOpen ? (
        <div className="communication-message-card__details-panel">
          <CommunicationDeliveryDetails
            busy={busy}
            message={item.message}
            onRetry={() => onRetryDeliveries(item.id)}
            summary={deliverySummary}
          />
        </div>
      ) : null}
    </article>
  );
}

export function MessageList({
  busy,
  deliveryDetailsMessage,
  deliverySummary,
  loadingDeliveryId,
  onCancelQueued,
  onDeleteDraft,
  onOpenDeliveryDetails,
  onResumeDraft,
  onRetryDeliveries,
  unifiedMessages,
}: MessageListProps) {
  if (unifiedMessages.length === 0) {
    return (
      <div className="communication-empty-state notice notice--info" role="status">
        <p>No messages found matching the selected filter.</p>
      </div>
    );
  }

  return (
    <div className="communication-message-list">
      {unifiedMessages.map((item) => (
        <MessageCard
          busy={busy}
          deliveryDetailsMessage={deliveryDetailsMessage}
          deliverySummary={deliverySummary}
          isLoadingThis={loadingDeliveryId === item.id}
          item={item}
          key={`${item.kind}:${item.id}`}
          onCancelQueued={onCancelQueued}
          onDeleteDraft={onDeleteDraft}
          onOpenDeliveryDetails={onOpenDeliveryDetails}
          onResumeDraft={onResumeDraft}
          onRetryDeliveries={onRetryDeliveries}
        />
      ))}
    </div>
  );
}
