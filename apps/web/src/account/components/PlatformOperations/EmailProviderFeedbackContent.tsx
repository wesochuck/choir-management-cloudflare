import { EmailFeedbackDeadLetterRow, EmailProviderEventRow } from "./EmailProviderFeedbackRows";
import type { EmailFeedbackActionTarget, EmailFeedbackState } from "./shared";

export function EmailProviderFeedbackContent({
  feedback,
  openAction,
}: {
  readonly feedback: Extract<EmailFeedbackState, { readonly status: "ready" }>;
  readonly openAction: (target: EmailFeedbackActionTarget) => void;
}) {
  return (
    <>
      <h5>Normalized provider events</h5>
      {feedback.events.length === 0 ? (
        <p className="empty-state">No provider events need review.</p>
      ) : (
        <ul className="account-list platform-dead-letter-list">
          {feedback.events.map((event) => (
            <EmailProviderEventRow event={event} key={event.eventId} openAction={openAction} />
          ))}
        </ul>
      )}
      {feedback.hasMoreEvents ? <p>Showing the 25 most recent provider events.</p> : null}
      <h5>Queue dead letters</h5>
      {feedback.deadLetters.length === 0 ? (
        <p className="empty-state">No email feedback queue dead letters need review.</p>
      ) : (
        <ul className="account-list platform-dead-letter-list">
          {feedback.deadLetters.map((deadLetter) => (
            <EmailFeedbackDeadLetterRow
              deadLetter={deadLetter}
              key={deadLetter.id}
              openAction={openAction}
            />
          ))}
        </ul>
      )}
      {feedback.hasMoreDeadLetters ? (
        <p>Showing the 25 most recent email queue dead letters.</p>
      ) : null}
    </>
  );
}
