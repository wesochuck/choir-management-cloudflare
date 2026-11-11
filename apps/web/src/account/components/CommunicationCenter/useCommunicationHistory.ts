import type {
  CommunicationDeliverySummary,
  CommunicationHistoryItem,
  CommunicationMessage,
} from "@choir/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  cancelOrganizationCommunication,
  cancelTicketNotification,
  getOrganizationCommunicationDeliverySummary,
  getOrganizationCommunicationHistory,
  listOrganizationCommunications,
  retryOrganizationCommunicationDeliveries,
} from "../../../auth/api";
import type { MessageOriginFilter, MessageStatusFilter, UnifiedCommunicationItem } from "./types";
import { failureMessage, unifiedItemSortTimestamp } from "./utils";

function historyQuery(
  status: MessageStatusFilter,
  origin: MessageOriginFilter,
  cursor: string | null,
  search: string,
) {
  return {
    cursor,
    includePreviews: status === "scheduled",
    limit: 50,
    ...(search ? { search } : {}),
    ...(origin !== "all" ? { origin } : {}),
    ...(status !== "all" ? { status } : {}),
  };
}
function firstPageDraftCount(
  page: Awaited<ReturnType<typeof getOrganizationCommunicationHistory>>,
  status: MessageStatusFilter,
  cursor: string | null,
  search: string,
) {
  if (search || cursor !== null) return null;
  if (status === "draft") return page.items.length;
  if (status === "all" && !page.nextCursor)
    return page.items.filter((item) => item.kind === "manual" && item.message.status === "Draft")
      .length;
  return null;
}

export function useCommunicationHistory({
  confirm,
  enabled,
  initialSearchQuery = "",
  initialOriginFilter,
  initialStatusFilter,
  setBusy,
  setError,
  setSuccessNotice,
}: {
  readonly confirm: (options: {
    readonly confirmLabel: string;
    readonly description: string;
    readonly destructive?: boolean;
    readonly title: string;
  }) => Promise<boolean>;
  readonly enabled: boolean;
  readonly initialSearchQuery?: string;
  readonly initialOriginFilter: MessageOriginFilter;
  readonly initialStatusFilter: MessageStatusFilter;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setSuccessNotice: Dispatch<SetStateAction<string | null>>;
}) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const searchRef = useRef(initialSearchQuery);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<MessageStatusFilter>(initialStatusFilter);
  const [originFilter, setOriginFilter] = useState<MessageOriginFilter>(initialOriginFilter);
  const historyAbortControllerRef = useRef<AbortController | null>(null);

  const [messages, setMessages] = useState<readonly CommunicationMessage[]>([]);
  const [historyItems, setHistoryItems] = useState<readonly CommunicationHistoryItem[]>([]);
  const [draftCount, setDraftCount] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyCursorStack, setHistoryCursorStack] = useState<(string | null)[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(enabled);

  const [deliverySummary, setDeliverySummary] = useState<CommunicationDeliverySummary | null>(null);
  const [deliveryDetailsMessage, setDeliveryDetailsMessage] = useState<CommunicationMessage | null>(
    null,
  );
  const [loadingDeliveryId, setLoadingDeliveryId] = useState<string | null>(null);

  useEffect(
    () => () => {
      historyAbortControllerRef.current?.abort();
    },
    [],
  );

  const loadHistoryPage = useCallback(
    async (
      targetStatus: MessageStatusFilter,
      targetOrigin: MessageOriginFilter,
      cursor: string | null,
      signal?: AbortSignal,
    ): Promise<void> => {
      historyAbortControllerRef.current?.abort();
      const controller = new AbortController();
      historyAbortControllerRef.current = controller;
      const abort = () => {
        controller.abort();
      };
      if (signal?.aborted) controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const requestSignal = controller.signal;
      const requestSearch = searchRef.current;
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const query = historyQuery(targetStatus, targetOrigin, cursor, requestSearch);
        const page = await getOrganizationCommunicationHistory(query, requestSignal);
        if (requestSignal.aborted) return;
        setHistoryItems(page.items);
        setNextCursor(page.nextCursor);
        const count = firstPageDraftCount(page, targetStatus, cursor, requestSearch);
        if (count !== null) setDraftCount(count);
      } catch (err: unknown) {
        if (!requestSignal.aborted) setHistoryError(failureMessage(err));
      } finally {
        signal?.removeEventListener("abort", abort);
        if (!requestSignal.aborted) setLoadingHistory(false);
      }
    },
    [],
  );

  const refreshDraftCount = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const page = await getOrganizationCommunicationHistory(
        { limit: 50, status: "draft" },
        signal,
      );
      if (!signal?.aborted) {
        setDraftCount(page.items.length);
      }
    } catch {
      // Ignored
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        void refreshDraftCount(controller.signal);
      }
    });
    return () => {
      controller.abort();
    };
  }, [enabled, refreshDraftCount]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadHistoryPage(statusFilter, originFilter, currentCursor, controller.signal);
        void refreshDraftCount(controller.signal);
      }
    };
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [currentCursor, enabled, loadHistoryPage, originFilter, refreshDraftCount, statusFilter]);

  const unifiedMessages: readonly UnifiedCommunicationItem[] = useMemo(() => {
    if (historyItems.length > 0 || searchQuery) {
      return historyItems.map((item): UnifiedCommunicationItem => {
        if (item.kind === "manual") {
          return {
            automated: item.automatic ?? false,
            channel: item.message.channel,
            id: item.message.id,
            kind: "manual",
            message: item.message,
            recipientCount: item.message.reach.total,
            status: item.message.status,
            timestamp: item.sortTimestamp,
            title:
              item.message.subject.length > 0
                ? item.message.subject
                : `${item.message.channel} message`,
          };
        }
        return {
          automated: true,
          channel: "Email",
          id: item.scheduledMessage.id,
          kind: "scheduled",
          recipientCount: null,
          scheduledMessage: item.scheduledMessage,
          status: item.scheduledMessage.status,
          timestamp: item.sortTimestamp,
          title:
            item.scheduledMessage.subject || item.scheduledMessage.eventTitle || "Automated send",
        };
      });
    }

    const manualItems: UnifiedCommunicationItem[] = messages.map((message) => ({
      automated: false,
      channel: message.channel,
      id: message.id,
      kind: "manual",
      message,
      recipientCount: message.reach.total,
      status: message.status,
      timestamp: message.sentAt ?? message.createdAt,
      title: message.subject.length > 0 ? message.subject : `${message.channel} message`,
    }));

    let all = [...manualItems].sort(
      (a, b) => unifiedItemSortTimestamp(b) - unifiedItemSortTimestamp(a),
    );

    if (originFilter === "manual") {
      all = all.filter((item) => !item.automated);
    } else if (originFilter === "automated") {
      all = all.filter((item) => item.automated);
    }

    switch (statusFilter) {
      case "draft":
        return all.filter((item) => item.status === "Draft");
      case "scheduled":
        return all
          .filter((item) => item.status === "Scheduled")
          .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      case "queued":
        return all.filter((item) => item.status === "Queued");
      case "sent":
        return all.filter((item) => item.status === "Sent");
      case "failed":
        return all.filter((item) => item.status === "Failed");
      case "all":
      default:
        return all;
    }
  }, [historyItems, messages, searchQuery, originFilter, statusFilter]);

  const applyFilters = useCallback(
    (status: MessageStatusFilter, origin: MessageOriginFilter, search = searchRef.current) => {
      searchRef.current = search;
      setSearchQuery(search);
      setStatusFilter(status);
      setOriginFilter(origin);
      setPageNumber(1);
      setCurrentCursor(null);
      setHistoryCursorStack([]);
      setNextCursor(null);
      setLoadingHistory(true);
      setDeliveryDetailsMessage(null);
      setDeliverySummary(null);
      void loadHistoryPage(status, origin, null);
    },
    [loadHistoryPage],
  );
  const changeStatusFilter = useCallback(
    (status: MessageStatusFilter) => {
      applyFilters(status, originFilter);
    },
    [applyFilters, originFilter],
  );
  const changeOriginFilter = useCallback(
    (origin: MessageOriginFilter) => {
      applyFilters(statusFilter, origin);
    },
    [applyFilters, statusFilter],
  );

  const nextPage = useCallback(async () => {
    if (!nextCursor) return;
    setHistoryCursorStack((prev) => [...prev, currentCursor]);
    setCurrentCursor(nextCursor);
    setPageNumber((prev) => prev + 1);
    setLoadingHistory(true);
    await loadHistoryPage(statusFilter, originFilter, nextCursor);
  }, [currentCursor, loadHistoryPage, nextCursor, originFilter, statusFilter]);

  const previousPage = useCallback(async () => {
    if (historyCursorStack.length === 0) return;
    const prevCursor = historyCursorStack[historyCursorStack.length - 1] ?? null;
    setHistoryCursorStack((prev) => prev.slice(0, -1));
    setCurrentCursor(prevCursor);
    setPageNumber((prev) => Math.max(1, prev - 1));
    setLoadingHistory(true);
    await loadHistoryPage(statusFilter, originFilter, prevCursor);
  }, [historyCursorStack, loadHistoryPage, originFilter, statusFilter]);

  const cancelQueuedAction = useCallback(
    async (messageId: string, reason?: string) => {
      const ticketId = messageId.startsWith("ticket:") ? messageId.slice(7) : null;
      const ok =
        ticketId !== null ||
        (await confirm({
          confirmLabel: "Cancel communication",
          description:
            "Cancel this queued communication? Pending recipients will not be delivered.",
          destructive: true,
          title: "Cancel queued communication",
        }));
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        if (ticketId) {
          await cancelTicketNotification(
            ticketId,
            reason ?? "Canceled by Organization administrator.",
          );
        } else {
          const canceled = await cancelOrganizationCommunication(messageId);
          setMessages((current) =>
            current.map((m) => (m.id === messageId ? { ...m, ...canceled } : m)),
          );
        }
        await loadHistoryPage(statusFilter, originFilter, currentCursor);
        setSuccessNotice(
          ticketId ? "Ticket notification canceled." : "Queued communication canceled.",
        );
      } catch (err: unknown) {
        setError(failureMessage(err));
        if (ticketId) throw err;
      } finally {
        setBusy(false);
      }
    },
    [
      confirm,
      currentCursor,
      loadHistoryPage,
      originFilter,
      setBusy,
      setError,
      setSuccessNotice,
      statusFilter,
    ],
  );

  const openDeliveryDetails = useCallback(
    async (message: CommunicationMessage) => {
      setLoadingDeliveryId(message.id);
      setError(null);
      try {
        const summary = await getOrganizationCommunicationDeliverySummary(message.id);
        setDeliverySummary(summary);
        setDeliveryDetailsMessage(message);
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setLoadingDeliveryId(null);
      }
    },
    [setError],
  );

  const retryDeliveriesAction = useCallback(
    async (messageId: string) => {
      setBusy(true);
      setError(null);
      try {
        const retried = await retryOrganizationCommunicationDeliveries(messageId);
        const summary = await getOrganizationCommunicationDeliverySummary(messageId);
        setDeliverySummary(summary);
        setMessages(await listOrganizationCommunications());
        void loadHistoryPage(statusFilter, originFilter, currentCursor);
        setSuccessNotice(`Retried delivery for ${String(retried)} recipients.`);
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [
      currentCursor,
      loadHistoryPage,
      originFilter,
      setBusy,
      setError,
      setSuccessNotice,
      statusFilter,
    ],
  );

  const clearDeliveryDetails = useCallback(() => {
    setDeliverySummary(null);
    setDeliveryDetailsMessage(null);
    setLoadingDeliveryId(null);
  }, []);

  return {
    applyFilters,
    cancelQueuedAction,
    changeOriginFilter,
    changeStatusFilter,
    clearDeliveryDetails,
    currentCursor,
    deliveryDetailsMessage,
    deliverySummary,
    draftCount,
    hasNextPage: Boolean(nextCursor),
    hasPreviousPage: pageNumber > 1,
    historyCursorStack,
    historyError,
    searchQuery,
    retryHistory: () => {
      void loadHistoryPage(statusFilter, originFilter, currentCursor);
    },
    loadHistoryPage,
    loadingDeliveryId,
    loadingHistory,
    nextPage,
    openDeliveryDetails,
    originFilter,
    pageNumber,
    previousPage,
    refreshDraftCount,
    retryDeliveriesAction,
    setDraftCount,
    setHistoryItems,
    setMessages,
    statusFilter,
    unifiedMessages,
  };
}
