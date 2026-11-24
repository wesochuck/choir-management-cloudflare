import type {
  CommunicationDeliveryIssue,
  CommunicationResolveDeliveryEmailRequest,
  CommunicationResolveDeliveryEmailResponse,
} from "@choir/contracts";
import { communicationDeliveryIssueGuidance, communicationDeliveryIssueLabel } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import { type SyntheticEvent, useState } from "react";
import { failureMessage } from "./utils";

function formatTimestamp(value: string, timezone?: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}

function issueDetailText(issue: CommunicationDeliveryIssue): string | null {
  const detail = (issue.providerReason || issue.failureDetail).trim();
  return detail.length > 0 ? detail : null;
}

function ResolveDeliveryEmailDialog({
  busy,
  issue,
  onClose,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly issue: CommunicationDeliveryIssue | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    deliveryId: string,
    input: CommunicationResolveDeliveryEmailRequest,
  ) => Promise<CommunicationResolveDeliveryEmailResponse>;
}) {
  const [email, setEmail] = useState(issue?.destination ?? "");
  const [resend, setResend] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!issue) return null;

  const trimmedEmail = email.trim();
  const isDirty = trimmedEmail !== issue.destination.trim() || !resend;

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issue) return;
    if (!trimmedEmail.includes("@")) {
      setFormError("Enter a valid email address.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit(issue.deliveryId, { email: trimmedEmail, resend });
      onClose();
    } catch (error: unknown) {
      setFormError(failureMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      dirty={isDirty && !saving}
      footer={
        <>
          <DialogClose asChild>
            <button className="button button--secondary" disabled={saving} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--primary"
            disabled={busy || saving}
            form="resolve-delivery-email-form"
            type="submit"
          >
            {saving ? "Saving…" : resend ? "Save & resend" : "Save email"}
          </button>
        </>
      }
      onClose={onClose}
      open
      title={`Fix email for ${issue.recipientName}`}
    >
      <form
        className="form-stack"
        id="resolve-delivery-email-form"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {formError ? (
          <div className="notice notice--error" role="alert">
            <p>{formError}</p>
          </div>
        ) : null}
        <p className="field-help">
          Previous address: <strong>{issue.destination}</strong> (
          {communicationDeliveryIssueLabel(issue.issueKind)})
        </p>
        <div className="field">
          <label htmlFor="resolve-delivery-email-input">Updated email address</label>
          <input
            autoComplete="email"
            disabled={saving}
            id="resolve-delivery-email-input"
            maxLength={320}
            onChange={(event) => {
              setEmail(event.target.value);
              if (formError) setFormError(null);
            }}
            required
            type="email"
            value={email}
          />
        </div>
        <label className="checkbox-row" htmlFor="resolve-delivery-resend-checkbox">
          <input
            checked={resend}
            disabled={saving}
            id="resolve-delivery-resend-checkbox"
            onChange={(event) => {
              setResend(event.target.checked);
            }}
            type="checkbox"
          />
          <span>Also resend this message to the updated email</span>
        </label>
        <p className="field-help">
          Saving a new email address automatically clears provider bounce suppression on the old
          address. Explicit unsubscribes and spam complaints are preserved.
        </p>
      </form>
    </Dialog>
  );
}

export function DeliveryIssuesSection({
  busy,
  hasMoreIssues,
  issues,
  issuesReviewedAt,
  onResolveDeliveryEmail,
  onReviewIssues,
  timezone,
  unresolvedIssueCount,
}: {
  readonly busy: boolean;
  readonly hasMoreIssues: boolean;
  readonly issues: readonly CommunicationDeliveryIssue[];
  readonly issuesReviewedAt: string | null;
  readonly onResolveDeliveryEmail?:
    | ((
        deliveryId: string,
        input: CommunicationResolveDeliveryEmailRequest,
      ) => Promise<CommunicationResolveDeliveryEmailResponse>)
    | undefined;
  readonly onReviewIssues?: (() => Promise<void>) | undefined;
  readonly timezone?: string | null | undefined;
  readonly unresolvedIssueCount: number;
}) {
  const [editingIssue, setEditingIssue] = useState<CommunicationDeliveryIssue | null>(null);

  if (issues.length === 0) return null;

  const isReviewed = unresolvedIssueCount === 0 && issuesReviewedAt !== null;

  return (
    <section aria-label="Delivery issues" className="communication-delivery-issues">
      <div className="communication-delivery-issues__header">
        <div>
          <strong>
            Delivery issues ({String(issues.length)}
            {hasMoreIssues ? "+" : ""})
          </strong>
          {isReviewed ? (
            <p className="field-help">Reviewed {formatTimestamp(issuesReviewedAt, timezone)}</p>
          ) : (
            <p className="field-help">
              Fix bounced email addresses below or mark these issues as reviewed once handled.
            </p>
          )}
        </div>
        {unresolvedIssueCount > 0 && onReviewIssues ? (
          <button
            className="button button--secondary button--sm"
            disabled={busy}
            onClick={() => void onReviewIssues()}
            type="button"
          >
            Mark issues reviewed
          </button>
        ) : null}
      </div>

      <ul className="communication-delivery-issues__list">
        {issues.map((issue) => {
          const detail = issueDetailText(issue);
          return (
            <li className="communication-delivery-issues__item" key={issue.deliveryId}>
              <div className="communication-delivery-issues__copy">
                <div className="communication-delivery-issues__title-row">
                  <strong>{issue.recipientName}</strong>
                  <span className="status-pill status-pill--failed">
                    {communicationDeliveryIssueLabel(issue.issueKind)}
                  </span>
                </div>
                <p className="communication-delivery-issues__destination">{issue.destination}</p>
                <p className="field-help">
                  {communicationDeliveryIssueGuidance({
                    category: issue.category,
                    issueKind: issue.issueKind,
                  })}
                </p>
                {detail ? (
                  <p className="field-help communication-delivery-issues__detail">
                    Provider details: {detail}
                  </p>
                ) : null}
              </div>
              {issue.canEditEmail && onResolveDeliveryEmail ? (
                <div className="communication-delivery-issues__actions">
                  <button
                    className="button button--secondary button--sm"
                    disabled={busy}
                    onClick={() => {
                      setEditingIssue(issue);
                    }}
                    type="button"
                  >
                    Fix email
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {hasMoreIssues ? (
        <p className="field-help">Showing the first 100 delivery issues for this message.</p>
      ) : null}

      {editingIssue && onResolveDeliveryEmail ? (
        <ResolveDeliveryEmailDialog
          busy={busy}
          issue={editingIssue}
          key={editingIssue.deliveryId}
          onClose={() => {
            setEditingIssue(null);
          }}
          onSubmit={onResolveDeliveryEmail}
        />
      ) : null}
    </section>
  );
}
