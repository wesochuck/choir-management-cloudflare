import type { CommunicationDeliverySummary, CommunicationMessage } from "@choir/contracts";
import { CommunicationPagination } from "./CommunicationPagination";
import { MessageList } from "./MessageList";
import type { MessageOriginFilter, MessageStatusFilter, UnifiedCommunicationItem } from "./types";

interface MessagesPanelProps {
  readonly busy: boolean;
  readonly currentOrigin: MessageOriginFilter;
  readonly currentStatus: MessageStatusFilter;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly hasNextPage?: boolean;
  readonly hasPreviousPage?: boolean;
  readonly loadingDeliveryId: string | null;
  readonly loadingHistory?: boolean;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onNewMessage: () => void;
  readonly onNextPage?: () => void;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onOriginFilterChange: (origin: MessageOriginFilter) => void;
  readonly onPreviousPage?: () => void;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly onStatusFilterChange: (status: MessageStatusFilter) => void;
  readonly pageNumber?: number;
  readonly unifiedMessages: readonly UnifiedCommunicationItem[];
}

const statusFilterOptions: readonly { readonly id: MessageStatusFilter; readonly label: string }[] =
  [
    { id: "all", label: "All" },
    { id: "draft", label: "Drafts" },
    { id: "scheduled", label: "Scheduled" },
    { id: "queued", label: "Queued" },
    { id: "sent", label: "Sent" },
    { id: "failed", label: "Failed" },
  ];

const originFilterOptions: readonly { readonly id: MessageOriginFilter; readonly label: string }[] =
  [
    { id: "all", label: "All messages" },
    { id: "manual", label: "Manual" },
    { id: "automated", label: "Automated" },
  ];

export function MessagesPanel({
  busy,
  currentOrigin,
  currentStatus,
  deliveryDetailsMessage,
  deliverySummary,
  hasNextPage,
  hasPreviousPage,
  loadingDeliveryId,
  loadingHistory,
  onCancelQueued,
  onDeleteDraft,
  onNewMessage,
  onNextPage,
  onOpenDeliveryDetails,
  onOriginFilterChange,
  onPreviousPage,
  onResumeDraft,
  onRetryDeliveries,
  onStatusFilterChange,
  pageNumber,
  unifiedMessages,
}: MessagesPanelProps) {
  return (
    <div className="communication-messages-panel">
      <div className="communication-messages-panel__header">
        <div>
          <h2>Messages</h2>
          <p className="field-help">
            Manage drafts, scheduled sends, delivery history, and active messages.
          </p>
        </div>
        <button className="button button--primary" onClick={onNewMessage} type="button">
          New message
        </button>
      </div>

      {/* Filter Groups */}
      <div aria-label="Message filter options" className="communication-filter-groups">
        <div className="communication-filter-group communication-filter-group--status">
          <span className="communication-filter-group__label" id="status-filter-label">
            Status
          </span>
          <div
            aria-labelledby="status-filter-label"
            className="communication-filter-group__chips"
            role="toolbar"
          >
            {statusFilterOptions.map((opt) => (
              <button
                aria-pressed={currentStatus === opt.id}
                className={`filter-chip ${currentStatus === opt.id ? "is-active" : ""}`}
                key={opt.id}
                onClick={() => {
                  onStatusFilterChange(opt.id);
                }}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="communication-filter-group communication-filter-group--type">
          <span className="communication-filter-group__label" id="type-filter-label">
            Type
          </span>
          <div
            aria-labelledby="type-filter-label"
            className="communication-filter-group__chips"
            role="toolbar"
          >
            {originFilterOptions.map((opt) => (
              <button
                aria-pressed={currentOrigin === opt.id}
                className={`filter-chip ${currentOrigin === opt.id ? "is-active" : ""}`}
                key={opt.id}
                onClick={() => {
                  onOriginFilterChange(opt.id);
                }}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Message List */}
      <MessageList
        busy={busy}
        currentOrigin={currentOrigin}
        currentStatus={currentStatus}
        deliveryDetailsMessage={deliveryDetailsMessage}
        deliverySummary={deliverySummary}
        loadingDeliveryId={loadingDeliveryId}
        onCancelQueued={onCancelQueued}
        onDeleteDraft={onDeleteDraft}
        onOpenDeliveryDetails={onOpenDeliveryDetails}
        onResumeDraft={onResumeDraft}
        onRetryDeliveries={onRetryDeliveries}
        unifiedMessages={unifiedMessages}
      />

      {pageNumber !== undefined && onNextPage && onPreviousPage ? (
        <CommunicationPagination
          disabled={busy || loadingHistory}
          hasNextPage={Boolean(hasNextPage)}
          hasPreviousPage={Boolean(hasPreviousPage)}
          label="Messages history pagination"
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
          pageNumber={pageNumber}
        />
      ) : null}
    </div>
  );
}
