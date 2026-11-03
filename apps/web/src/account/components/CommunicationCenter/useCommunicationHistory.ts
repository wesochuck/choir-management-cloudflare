import type {
  CommunicationDeliverySummary,
  CommunicationHistoryItem,
  CommunicationMessage,
  CommunicationScheduledMessage,
} from "@choir/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  cancelOrganizationCommunication,
  getOrganizationCommunicationDeliverySummary,
  getOrganizationCommunicationHistory,
  listOrganizationCommunications,
  listOrganizationScheduledMessages,
  retryOrganizationCommunicationDeliveries,
} from "../../../auth/api";
import type { MessageOriginFilter, MessageStatusFilter, UnifiedCommunicationItem } from "./types";
import { failureMessage, unifiedItemSortTimestamp } from "./utils";

function filterFallbackHistory(
  items: CommunicationHistoryItem[],
  status: MessageStatusFilter,
  origin: MessageOriginFilter,
): CommunicationHistoryItem[] {
  let res = items;
  if (origin === "manual") {
    res = res.filter((i) => i.kind === "manual");
  } else if (origin === "automated") {
    res = res.filter((i) => i.kind === "automated");
  }
  if (status === "draft") {
    res = res.filter((i) => i.kind === "manual" && i.message.status === "Draft");
  } else if (status === "scheduled") {
    res = res.filter((i) => i.kind === "automated" && i.scheduledMessage.status === "Scheduled");
  } else if (status === "queued") {
    res = res.filter(
      (i) =>
        (i.kind === "automated" && i.scheduledMessage.status === "Queued") ||
        (i.kind === "manual" && i.message.status === "Queued"),
    );
  } else if (status === "sent") {
    res = res.filter(
      (i) =>
        (i.kind === "automated" && i.scheduledMessage.status === "Sent") ||
        (i.kind === "manual" && i.message.status === "Sent"),
    );
  } else if (status === "failed") {
    res = res.filter(
      (i) =>
        (i.kind === "automated" && i.scheduledMessage.status === "Failed") ||
        (i.kind === "manual" && i.message.status === "Failed"),
    );
  }
  return res;
}

export function useCommunicationHistory({
  confirm,
  enabled,
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
  readonly initialOriginFilter: MessageOriginFilter;
  readonly initialStatusFilter: MessageStatusFilter;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setSuccessNotice: Dispatch<SetStateAction<string | null>>;
}) {
  const [statusFilter, setStatusFilter] = useState<MessageStatusFilter>(initialStatusFilter);
  const [originFilter, setOriginFilter] = useState<MessageOriginFilter>(initialOriginFilter);
  const historyAbortControllerRef = useRef<AbortController | null>(null);

  const [messages, setMessages] = useState<readonly CommunicationMessage[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<
    readonly CommunicationScheduledMessage[]
  >([]);
  const [historyItems, setHistoryItems] = useState<readonly CommunicationHistoryItem[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyCursorStack, setHistoryCursorStack] = useState<(string | null)[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [deliverySummary, setDeliverySummary] = useState<CommunicationDeliverySummary | null>(null);
  const [deliveryDetailsMessage, setDeliveryDetailsMessage] = useState<CommunicationMessage | null>(
    null,
  );
  const [loadingDeliveryId, setLoadingDeliveryId] = useState<string | null>(null);

  const loadHistoryPage = useCallback(
    async (
      targetStatus: MessageStatusFilter,
      targetOrigin: MessageOriginFilter,
      cursor: string | null,
      signal?: AbortSignal,
    ): Promise<void> => {
      if (cursor !== null) setLoadingHistory(true);
      try {
        const query: {
          cursor: string | null;
          limit: number;
          origin?: "manual" | "automated";
          status?: "draft" | "scheduled" | "queued" | "sent" | "failed" | "skipped";
        } = {
          cursor,
          limit: 50,
        };
        if (targetOrigin !== "all") {
          query.origin = targetOrigin;
        }
        if (targetStatus !== "all") {
          query.status = targetStatus;
        }
        const page = await getOrganizationCommunicationHistory(query, signal);
        setHistoryItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (err: unknown) {
        if (!signal?.aborted) {
          try {
            const [manual, scheduled] = await Promise.all([
              listOrganizationCommunications(signal),
              listOrganizationScheduledMessages(signal),
            ]);
            setMessages(manual);
            setScheduledMessages(scheduled);
            const manualItems: CommunicationHistoryItem[] = manual.map((m) => ({
              kind: "manual",
              message: m,
              sortTimestamp: m.sentAt ?? m.createdAt,
            }));
            const scheduledItems: CommunicationHistoryItem[] = scheduled.map((s) => ({
              kind: "automated",
              scheduledMessage: s,
              sortTimestamp: s.scheduledAt,
            }));
            const merged = [...manualItems, ...scheduledItems].sort(
              (a, b) =>
                (targetStatus === "scheduled" ? 1 : -1) *
                (Date.parse(a.sortTimestamp) - Date.parse(b.sortTimestamp)),
            );
            const filtered = filterFallbackHistory(merged, targetStatus, targetOrigin);
            setHistoryItems(filtered.slice(0, 50));
            setNextCursor(null);
          } catch {
            setError(failureMessage(err));
          }
        }
      } finally {
        if (!signal?.aborted) setLoadingHistory(false);
      }
    },
    [setError],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadHistoryPage(statusFilter, originFilter, null, controller.signal);
        setHistoryCursorStack([]);
        setCurrentCursor(null);
      }
    };
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, loadHistoryPage, originFilter, statusFilter]);

  const unifiedMessages: readonly UnifiedCommunicationItem[] = useMemo(() => {
    if (historyItems.length > 0) {
      return historyItems.map((item): UnifiedCommunicationItem => {
        if (item.kind === "manual") {
          return {
            automated: false,
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

    const scheduledItems: UnifiedCommunicationItem[] = scheduledMessages.map((scheduled) => ({
      automated: true,
      channel: "Email",
      id: scheduled.id,
      kind: "scheduled",
      recipientCount: null,
      scheduledMessage: scheduled,
      status: scheduled.status,
      timestamp: scheduled.scheduledAt,
      title: scheduled.subject || scheduled.eventTitle || "Automated send",
    }));

    let all = [...manualItems, ...scheduledItems].sort(
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
  }, [historyItems, messages, scheduledMessages, originFilter, statusFilter]);

  const changeStatusFilter = useCallback(
    (nextStatus: MessageStatusFilter) => {
      historyAbortControllerRef.current?.abort();
      const controller = new AbortController();
      historyAbortControllerRef.current = controller;

      setStatusFilter(nextStatus);
      setPageNumber(1);
      setCurrentCursor(null);
      setNextCursor(null);
      setHistoryCursorStack([]);
      setDeliveryDetailsMessage(null);
      setDeliverySummary(null);
      setLoadingHistory(true);
      void loadHistoryPage(nextStatus, originFilter, null, controller.signal);
    },
    [loadHistoryPage, originFilter],
  );

  const changeOriginFilter = useCallback(
    (nextOrigin: MessageOriginFilter) => {
      historyAbortControllerRef.current?.abort();
      const controller = new AbortController();
      historyAbortControllerRef.current = controller;

      setOriginFilter(nextOrigin);
      setPageNumber(1);
      setCurrentCursor(null);
      setNextCursor(null);
      setHistoryCursorStack([]);
      setDeliveryDetailsMessage(null);
      setDeliverySummary(null);
      setLoadingHistory(true);
      void loadHistoryPage(statusFilter, nextOrigin, null, controller.signal);
    },
    [loadHistoryPage, statusFilter],
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
    async (messageId: string) => {
      const ok = await confirm({
        confirmLabel: "Cancel communication",
        description: "Cancel this queued communication? Pending recipients will not be delivered.",
        destructive: true,
        title: "Cancel queued communication",
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        const canceled = await cancelOrganizationCommunication(messageId);
        setMessages((current) =>
          current.map((m) => (m.id === messageId ? { ...m, ...canceled } : m)),
        );
        void loadHistoryPage(statusFilter, originFilter, currentCursor);
        setSuccessNotice("Queued communication canceled.");
      } catch (err: unknown) {
        setError(failureMessage(err));
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
    cancelQueuedAction,
    changeOriginFilter,
    changeStatusFilter,
    clearDeliveryDetails,
    currentCursor,
    deliveryDetailsMessage,
    deliverySummary,
    hasNextPage: Boolean(nextCursor),
    hasPreviousPage: pageNumber > 1,
    historyCursorStack,
    loadHistoryPage,
    loadingDeliveryId,
    loadingHistory,
    nextPage,
    openDeliveryDetails,
    originFilter,
    pageNumber,
    previousPage,
    retryDeliveriesAction,
    setHistoryItems,
    setMessages,
    statusFilter,
    unifiedMessages,
  };
}
