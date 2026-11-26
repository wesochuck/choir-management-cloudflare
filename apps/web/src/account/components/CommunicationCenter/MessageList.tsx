import { TicketNotificationDetails } from "./TicketNotificationDetails";
import type {
  CommunicationDeliverySummary,
  CommunicationMessage,
  CommunicationResolveDeliveryEmailRequest,
  CommunicationResolveDeliveryEmailResponse,
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
  readonly onCancelQueued: (messageId: string, reason?: string) => Promise<void>;
  readonly onCreateFollowUp?: ((message: CommunicationMessage) => Promise<void>) | undefined;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResolveDeliveryEmail?:
    | ((
        messageId: string,
        deliveryId: string,
        input: CommunicationResolveDeliveryEmailRequest,
      ) => Promise<CommunicationResolveDeliveryEmailResponse>)
    | undefined;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly onReviewIssues?: ((messageId: string) => Promise<void>) | undefined;
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
  readonly onCancelQueued: (messageId: string, reason?: string) => Promise<void>;
  readonly onCreateFollowUp?: ((message: CommunicationMessage) => Promise<void>) | undefined;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResolveDeliveryEmail?:
    | ((
        messageId: string,
        deliveryId: string,
        input: CommunicationResolveDeliveryEmailRequest,
      ) => Promise<CommunicationResolveDeliveryEmailResponse>)
    | undefined;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly onReviewIssues?: ((messageId: string) => Promise<void>) | undefined;
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
  readonly onCancelQueued: (messageId: string, reason?: string) => Promise<void>;
  readonly onCreateFollowUp?: ((message: CommunicationMessage) => Promise<void>) | undefined;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
}) {
  if (item.kind !== "manual") {
    return item.scheduledMessage.kind.startsWith("ticket_") && !item.scheduledMessage.projected ? (
      <TicketNotificationDetails
        notificationId={item.id}
        onCancel={onCancelQueued}
        timezone={item.scheduledMessage.timezone}
      />
    ) : null;
  }

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

function messageTimestamp(item: UnifiedCommunicationItem): string {
  const timezone = item.kind === "scheduled" ? item.scheduledMessage.timezone : undefined;
  const date = timezone
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone,
      }).format(new Date(item.timestamp))
    : displayDate(item.timestamp);
  const tzLabel = timezone ? formatTimezoneName(timezone, item.timestamp) : "";
  return `${item.status === "Scheduled" ? "Scheduled for " : ""}${date}${tzLabel ? ` (${tzLabel})` : ""}`;
}

function MessageMetadata({ item }: { readonly item: UnifiedCommunicationItem }) {
  const details = [item.channel, messageTimestamp(item)];
  if (item.automated) details.push("Automated");

  if (item.kind === "manual") {
    if (item.recipientCount > 0) {
      details.push(
        `${String(item.recipientCount)} ${item.recipientCount === 1 ? "recipient" : "recipients"}`,
      );
    }
    if (item.message.queuedByName) details.push(`Queued by ${item.message.queuedByName}`);
  } else {
    const { kind, projected, recipientCount, recipientEmail, skipReason } = item.scheduledMessage;
    const kindLabel = scheduledMessageKindLabel(kind);
    if (recipientEmail) details.push(recipientEmail);
    if (skipReason) details.push(skipReason.replaceAll("_", " "));
    if (projected && kind === "ticket_reminder") {
      details.push(
        `${String(recipientCount)} ticket ${recipientCount === 1 ? "purchase" : "purchases"}`,
      );
    }
    if (kindLabel !== item.title) details.push(kindLabel);
  }

  return (
    <p className="communication-history-entry__meta">
      {details.join(" · ")} ·{" "}
      <span className="communication-row-status" data-status={item.status}>
        {item.status}
      </span>
    </p>
  );
}

function MessageDeliveryDetailsPanel({
  branding,
  busy,
  deliverySummary,
  events,
  message,
  onResolveDeliveryEmail,
  onRetryDeliveries,
  onReviewIssues,
  timezone,
  venues,
}: {
  readonly branding?: OrganizationBranding | null | undefined;
  readonly busy: boolean;
  readonly deliverySummary: CommunicationDeliverySummary;
  readonly events?: readonly OrganizationEvent[] | undefined;
  readonly message: CommunicationMessage;
  readonly onResolveDeliveryEmail?:
    | ((
        messageId: string,
        deliveryId: string,
        input: CommunicationResolveDeliveryEmailRequest,
      ) => Promise<CommunicationResolveDeliveryEmailResponse>)
    | undefined;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly onReviewIssues?: ((messageId: string) => Promise<void>) | undefined;
  readonly timezone?: string | null | undefined;
  readonly venues?: readonly OrganizationVenue[] | undefined;
}) {
  return (
    <div className="communication-message-card__details-panel">
      <CommunicationDeliveryDetails
        branding={branding}
        busy={busy}
        events={events}
        message={message}
        onResolveDeliveryEmail={
          onResolveDeliveryEmail
            ? (deliveryId, input) => onResolveDeliveryEmail(message.id, deliveryId, input)
            : undefined
        }
        onRetry={() => onRetryDeliveries(message.id)}
        onReviewIssues={onReviewIssues ? () => onReviewIssues(message.id) : undefined}
        summary={deliverySummary}
        timezone={timezone}
        venues={venues}
      />
    </div>
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
  onResolveDeliveryEmail,
  onResumeDraft,
  onRetryDeliveries,
  onReviewIssues,
  timezone,
  venues,
}: MessageCardProps) {
  const isDetailsOpen =
    item.kind === "manual" && deliveryDetailsMessage?.id === item.id && deliverySummary !== null;
  const scheduled = item.kind === "scheduled" ? item.scheduledMessage : null;
  const automationAction = scheduled ? scheduledMessageActionLink(scheduled) : null;

  return (
    <article
      aria-label={`${item.title} (${item.status})`}
      className="communication-history-entry communication-message-card"
    >
      <div className="communication-history-entry__header">
        <div className="communication-history-entry__title-area">
          <h3 className="communication-history-entry__title">{item.title}</h3>
          <MessageMetadata item={item} />
        </div>

        <div className="communication-history-actions">
          {automationAction ? (
            <a className="text-button" href={automationAction.href}>
              {automationAction.label}
            </a>
          ) : null}
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

      {scheduled?.projected ? (
        <p className="field-help communication-history-preview">
          Automation preview. Recipients and eligibility are checked at send time.
        </p>
      ) : null}
      {isDetailsOpen ? (
        <MessageDeliveryDetailsPanel
          branding={branding}
          busy={busy}
          deliverySummary={deliverySummary}
          events={events}
          message={item.message}
          onResolveDeliveryEmail={onResolveDeliveryEmail}
          onRetryDeliveries={onRetryDeliveries}
          onReviewIssues={onReviewIssues}
          timezone={timezone}
          venues={venues}
        />
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
  onResolveDeliveryEmail,
  onResumeDraft,
  onRetryDeliveries,
  onReviewIssues,
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
          onResolveDeliveryEmail={onResolveDeliveryEmail}
          onResumeDraft={onResumeDraft}
          onRetryDeliveries={onRetryDeliveries}
          onReviewIssues={onReviewIssues}
          timezone={timezone}
          venues={venues}
        />
      ))}
    </div>
  );
}
