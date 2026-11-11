import type { ReactNode } from "react";
import { MessageFilters } from "./MessageFilters";
import type {
  CommunicationDeliverySummary,
  CommunicationMessage,
  OrganizationBranding,
  OrganizationEvent,
  OrganizationVenue,
} from "@choir/contracts";
import { CommunicationPagination } from "./CommunicationPagination";
import { MessageList } from "./MessageList";
import type { MessageOriginFilter, MessageStatusFilter, UnifiedCommunicationItem } from "./types";

interface MessagesPanelProps {
  readonly searchQuery?: string;
  readonly onFiltersChange?: (
    status: MessageStatusFilter,
    origin: MessageOriginFilter,
    search: string,
  ) => void;
  readonly historyError?: string | null;
  readonly onRetryHistory?: () => void;
  readonly showNewMessage?: boolean;
  readonly branding?: OrganizationBranding | null | undefined;
  readonly busy: boolean;
  readonly currentOrigin: MessageOriginFilter;
  readonly currentStatus: MessageStatusFilter;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly draftCount?: number | undefined;
  readonly events?: readonly OrganizationEvent[] | undefined;
  readonly hasNextPage?: boolean;
  readonly hasPreviousPage?: boolean;
  readonly loadingDeliveryId: string | null;
  readonly loadingHistory?: boolean;
  readonly onCancelQueued: (messageId: string, reason?: string) => Promise<void>;
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
  readonly timezone?: string | null | undefined;
  readonly unifiedMessages: readonly UnifiedCommunicationItem[];
  readonly venues?: readonly OrganizationVenue[] | undefined;
}

function HistoryResults({
  error,
  loading,
  emptySearch,
  hasItems,
  retry,
  children,
}: {
  readonly error: string | null;
  readonly loading: boolean | undefined;
  readonly emptySearch: boolean;
  readonly hasItems: boolean;
  readonly retry: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  return (
    <>
      {error ? (
        <div role="alert" className="notice notice--error">
          <p>{error}</p>
          {hasItems ? <p>Showing previous results.</p> : null}
          <button type="button" className="button button--secondary" onClick={retry}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <p role="status">Loading messages…</p>
      ) : null}
      {!error && !loading && emptySearch ? (
        <p className="field-help">No messages match this search.</p>
      ) : null}
      {hasItems || (!loading && !error && !emptySearch) ? children : null}
    </>
  );
}

function HistoryPages({
  pageNumber,
  next,
  previous,
  busy,
  loading,
  error,
  hasNext,
  hasPrevious,
}: {
  readonly pageNumber: number | undefined;
  readonly next: (() => void) | undefined;
  readonly previous: (() => void) | undefined;
  readonly busy: boolean;
  readonly loading: boolean | undefined;
  readonly error: string | null;
  readonly hasNext: boolean | undefined;
  readonly hasPrevious: boolean | undefined;
}) {
  if (pageNumber === undefined || !next || !previous) return null;
  return (
    <CommunicationPagination
      disabled={busy || Boolean(loading) || Boolean(error)}
      hasNextPage={Boolean(hasNext)}
      hasPreviousPage={Boolean(hasPrevious)}
      label="Messages history pagination"
      onNextPage={next}
      onPreviousPage={previous}
      pageNumber={pageNumber}
    />
  );
}

export function MessagesPanel({
  searchQuery = "",
  onFiltersChange,
  historyError = null,
  onRetryHistory,
  showNewMessage = true,
  branding,
  busy,
  currentOrigin,
  currentStatus,
  deliveryDetailsMessage,
  deliverySummary,
  draftCount,
  events,
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
  timezone,
  unifiedMessages,
  venues,
}: MessagesPanelProps) {
  const effectiveDraftCount =
    draftCount ?? unifiedMessages.filter((m) => !m.automated && m.status === "Draft").length;

  return (
    <div className="communication-messages-panel" aria-busy={loadingHistory ?? false}>
      <div className="communication-messages-panel__header">
        <div>
          <div className="communication-messages-panel__title">
            <h2>Messages</h2>
            {effectiveDraftCount > 0 ? (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (onFiltersChange) onFiltersChange("draft", "all", "");
                  else onStatusFilterChange("draft");
                }}
              >
                {String(effectiveDraftCount)} {effectiveDraftCount === 1 ? "draft" : "drafts"}
              </button>
            ) : null}
          </div>
          <p className="field-help">
            Manage drafts, scheduled sends, delivery history, and active messages.
          </p>
        </div>
        {showNewMessage ? (
          <button className="button button--primary" onClick={onNewMessage} type="button">
            New message
          </button>
        ) : null}
      </div>

      <MessageFilters
        search={searchQuery}
        status={currentStatus}
        origin={currentOrigin}
        onChange={(status, origin, query) => {
          if (onFiltersChange) onFiltersChange(status, origin, query);
          else {
            if (status !== currentStatus) onStatusFilterChange(status);
            if (origin !== currentOrigin) onOriginFilterChange(origin);
          }
        }}
      />

      {currentStatus === "scheduled" && currentOrigin !== "manual" ? (
        <p className="field-help">
          Upcoming automation previews cover the next 90 days. Existing scheduled notifications are
          also included.
        </p>
      ) : null}
      <HistoryResults
        error={historyError}
        loading={loadingHistory}
        emptySearch={Boolean(searchQuery) && unifiedMessages.length === 0}
        hasItems={unifiedMessages.length > 0}
        retry={onRetryHistory}
      >
        {/* Message List */}
        <MessageList
          branding={branding}
          busy={busy}
          currentOrigin={currentOrigin}
          currentStatus={currentStatus}
          deliveryDetailsMessage={deliveryDetailsMessage}
          deliverySummary={deliverySummary}
          events={events}
          loadingDeliveryId={loadingDeliveryId}
          onCancelQueued={onCancelQueued}
          onDeleteDraft={onDeleteDraft}
          onOpenDeliveryDetails={onOpenDeliveryDetails}
          onResumeDraft={onResumeDraft}
          onRetryDeliveries={onRetryDeliveries}
          timezone={timezone}
          unifiedMessages={unifiedMessages}
          venues={venues}
        />
      </HistoryResults>

      <HistoryPages
        pageNumber={pageNumber}
        next={onNextPage}
        previous={onPreviousPage}
        busy={busy}
        loading={loadingHistory}
        error={historyError}
        hasNext={hasNextPage}
        hasPrevious={hasPreviousPage}
      />
    </div>
  );
}
