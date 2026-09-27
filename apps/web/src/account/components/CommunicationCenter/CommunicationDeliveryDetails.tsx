import type {
  CommunicationDeliveryRecipient,
  CommunicationDeliverySummary,
  CommunicationMessage,
} from "@choir/contracts";
import { useEffect, useState } from "react";
import { getOrganizationCommunicationRecipients } from "../../../auth/api";
import { CommunicationPagination } from "./CommunicationPagination";

function deliveryStatusLabel(recipient: CommunicationDeliveryRecipient): string {
  if (recipient.providerStatus === "delivered") return "Delivered";
  return recipient.status.charAt(0).toUpperCase() + recipient.status.slice(1);
}

function deliveryChannelLabel(channel: CommunicationDeliveryRecipient["channel"]): string {
  return channel === "email" ? "Email" : "SMS";
}

interface CommunicationDeliveryDetailsProps {
  readonly busy: boolean;
  readonly message: CommunicationMessage;
  readonly onRetry: () => Promise<void>;
  readonly summary: CommunicationDeliverySummary;
}

export function CommunicationDeliveryDetails({
  busy,
  message,
  onRetry,
  summary,
}: CommunicationDeliveryDetailsProps) {
  const [recipients, setRecipients] = useState<readonly CommunicationDeliveryRecipient[]>(
    summary.recipients.slice(0, 100),
  );
  const [pageNumber, setPageNumber] = useState(1);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    getOrganizationCommunicationRecipients(message.id, { limit: 100 }, controller.signal)
      .then((page) => {
        if (!active) return;
        setRecipients(page.recipients);
        setNextCursor(page.nextCursor);
        setPageNumber(1);
        setCurrentCursor(null);
        setCursorStack([]);
      })
      .catch(() => {
        if (!active) return;
        setRecipients(summary.recipients.slice(0, 100));
        setNextCursor(null);
      })
      .finally(() => {
        if (active) setLoadingRecipients(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [message.id, summary.recipients]);

  async function handleNextPage() {
    if (!nextCursor || loadingRecipients) return;
    setLoadingRecipients(true);
    try {
      const page = await getOrganizationCommunicationRecipients(message.id, {
        cursor: nextCursor,
        limit: 100,
      });
      setCursorStack((prev) => [...prev, currentCursor]);
      setCurrentCursor(nextCursor);
      setRecipients(page.recipients);
      setNextCursor(page.nextCursor);
      setPageNumber((p) => p + 1);
    } catch {
      // ignore
    } finally {
      setLoadingRecipients(false);
    }
  }

  async function handlePreviousPage() {
    if (pageNumber <= 1 || loadingRecipients) return;
    const prevCursor = cursorStack[cursorStack.length - 1] ?? null;
    setLoadingRecipients(true);
    try {
      const page = await getOrganizationCommunicationRecipients(message.id, {
        cursor: prevCursor,
        limit: 100,
      });
      setCursorStack((prev) => prev.slice(0, -1));
      setCurrentCursor(prevCursor);
      setRecipients(page.recipients);
      setNextCursor(page.nextCursor);
      setPageNumber((p) => p - 1);
    } catch {
      // ignore
    } finally {
      setLoadingRecipients(false);
    }
  }

  const messageLabel = message.subject || `${message.channel} message`;
  const totalCount = summary.total.total > 0 ? summary.total.total : recipients.length;

  return (
    <div
      aria-label={`Delivery details for ${messageLabel}`}
      aria-live="polite"
      className="communication-delivery-details notice notice--info"
      role="region"
    >
      <p>
        <strong>Delivery details</strong>
      </p>
      <p>
        Delivery: {summary.state} · {String(summary.total.sent)} sent ·{" "}
        {String(summary.total.failed)} failed ·{" "}
        {String(summary.total.queued + summary.total.processing)} remaining
      </p>
      {summary.provider.total > 0 ? (
        <>
          <p>
            Provider: {String(summary.provider.accepted)} accepted ·{" "}
            {String(summary.provider.delivered)} delivered · {String(summary.provider.deferred)}{" "}
            deferred · {String(summary.provider.bounced)} bounced
          </p>
          <p>
            Provider: {String(summary.provider.failed)} failed · {String(summary.provider.rejected)}{" "}
            rejected · {String(summary.provider.complained)} complained
          </p>
        </>
      ) : null}
      {summary.failures.length > 0 ? (
        <ul>
          {summary.failures.map((failure, index) => (
            <li key={`${failure.maskedDestination}:${String(index)}`}>
              {failure.maskedDestination}: {failure.category}
            </li>
          ))}
        </ul>
      ) : null}
      {recipients.length > 0 ? (
        <details className="communication-delivery-recipients" open>
          <summary>Recipients ({String(totalCount)})</summary>
          <ul className="communication-delivery-recipients__list">
            {recipients.map((recipient, index) => (
              <li
                className="communication-delivery-recipients__item"
                key={recipient.recipientName + ":" + recipient.channel + ":" + String(index)}
              >
                <div>
                  <strong>{recipient.recipientName}</strong>
                  <p>{deliveryChannelLabel(recipient.channel)}</p>
                </div>
                <span className={`status-pill status-pill--${recipient.status}`}>
                  {deliveryStatusLabel(recipient)}
                </span>
              </li>
            ))}
          </ul>
          {nextCursor || pageNumber > 1 ? (
            <CommunicationPagination
              disabled={loadingRecipients}
              hasNextPage={Boolean(nextCursor)}
              hasPreviousPage={pageNumber > 1}
              label="Delivery recipients pagination"
              onNextPage={() => void handleNextPage()}
              onPreviousPage={() => void handlePreviousPage()}
              pageNumber={pageNumber}
            />
          ) : null}
        </details>
      ) : null}
      {summary.total.failed > 0 ? (
        <button disabled={busy} onClick={() => void onRetry()} type="button">
          Retry failed deliveries
        </button>
      ) : null}
    </div>
  );
}
