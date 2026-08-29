import type {
  CommunicationDeliveryRecipient,
  CommunicationDeliverySummary,
  CommunicationMessage,
} from "@choir/contracts";

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
  const messageLabel = message.subject || `${message.channel} message`;
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
      {summary.recipients.length > 0 ? (
        <details className="communication-delivery-recipients" open>
          <summary>Recipients ({String(summary.recipients.length)})</summary>
          <ul className="communication-delivery-recipients__list">
            {summary.recipients.map((recipient, index) => (
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
