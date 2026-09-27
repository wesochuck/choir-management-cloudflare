import type { CommunicationDeliverySummary, CommunicationMessage } from "@choir/contracts";
import { CommunicationPagination } from "./CommunicationPagination";
import { MessageList } from "./MessageList";
import type { MessageFilter, UnifiedCommunicationItem } from "./types";

interface MessagesPanelProps {
  readonly busy: boolean;
  readonly currentFilter: MessageFilter;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly hasNextPage?: boolean;
  readonly hasPreviousPage?: boolean;
  readonly loadingDeliveryId: string | null;
  readonly loadingHistory?: boolean;
  readonly onCancelQueued: (messageId: string) => Promise<void>;
  readonly onDeleteDraft: (messageId: string) => Promise<void>;
  readonly onFilterChange: (filter: MessageFilter) => void;
  readonly onNewMessage: () => void;
  readonly onNextPage?: () => void;
  readonly onOpenDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly onPreviousPage?: () => void;
  readonly onResumeDraft: (draft: CommunicationMessage) => void;
  readonly onRetryDeliveries: (messageId: string) => Promise<void>;
  readonly pageNumber?: number;
  readonly unifiedMessages: readonly UnifiedCommunicationItem[];
}

const filterOptions: readonly { readonly id: MessageFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "drafts", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "queued", label: "Queued" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
  { id: "automated", label: "Automated" },
];

export function MessagesPanel({
  busy,
  currentFilter,
  deliveryDetailsMessage,
  deliverySummary,
  hasNextPage,
  hasPreviousPage,
  loadingDeliveryId,
  loadingHistory,
  onCancelQueued,
  onDeleteDraft,
  onFilterChange,
  onNewMessage,
  onNextPage,
  onOpenDeliveryDetails,
  onPreviousPage,
  onResumeDraft,
  onRetryDeliveries,
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

      {/* Filter Row */}
      <div aria-label="Message filters" className="communication-filter-row" role="toolbar">
        {filterOptions.map((opt) => (
          <button
            aria-pressed={currentFilter === opt.id}
            className={`filter-chip ${currentFilter === opt.id ? "is-active" : ""}`}
            key={opt.id}
            onClick={() => {
              onFilterChange(opt.id);
            }}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Message List */}
      <MessageList
        busy={busy}
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
