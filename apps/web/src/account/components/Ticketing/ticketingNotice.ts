import { useCallback, useEffect, useRef, useState } from "react";

import type { TicketingTab } from "./shared";

export const TICKETING_NOTICE_SUCCESS_TIMEOUT_MS = 5_000;

export type TicketingNoticeKind = "success" | "info" | "error";

export interface TicketingNotice {
  readonly kind: TicketingNoticeKind;
  readonly message: string;
  readonly scope?: TicketingTab;
}

export function getVisibleTicketingNotice(
  notice: TicketingNotice | null,
  activeTab: TicketingTab,
): TicketingNotice | null {
  if (notice === null) return null;
  if (notice.scope !== undefined && notice.scope !== activeTab) return null;
  return notice;
}

export function useTicketingNotice() {
  const [notice, setNotice] = useState<TicketingNotice | null>(null);
  const noticeRef = useRef<TicketingNotice | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const noticeVersionRef = useRef(0);

  const cancelTimeout = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const clearNotice = useCallback(() => {
    noticeVersionRef.current += 1;
    noticeRef.current = null;
    cancelTimeout();
    setNotice(null);
  }, [cancelTimeout]);

  const showNotice = useCallback(
    (message: string, kind: TicketingNoticeKind, scope?: TicketingTab) => {
      cancelTimeout();
      const noticeVersion = noticeVersionRef.current + 1;
      noticeVersionRef.current = noticeVersion;

      const nextNotice: TicketingNotice = {
        kind,
        message,
        ...(scope ? { scope } : {}),
      };
      noticeRef.current = nextNotice;
      setNotice(nextNotice);

      if (kind === "success") {
        timeoutRef.current = window.setTimeout(() => {
          if (noticeVersionRef.current !== noticeVersion) return;
          timeoutRef.current = null;
          noticeRef.current = null;
          setNotice(null);
        }, TICKETING_NOTICE_SUCCESS_TIMEOUT_MS);
      }
    },
    [cancelTimeout],
  );

  const clearSuccessNotice = useCallback(() => {
    if (noticeRef.current?.kind === "success") clearNotice();
  }, [clearNotice]);

  const clearScopedNoticeWhenLeavingTab = useCallback(
    (nextTab: TicketingTab) => {
      const currentNotice = noticeRef.current;
      if (currentNotice?.scope && currentNotice.scope !== nextTab) clearNotice();
    },
    [clearNotice],
  );

  useEffect(() => cancelTimeout, [cancelTimeout]);

  return { clearScopedNoticeWhenLeavingTab, clearSuccessNotice, notice, showNotice };
}
