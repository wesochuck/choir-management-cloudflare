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

type ResolveMode = "update_email" | "clear_email" | "delete_contact" | "archive_profile";

function resolveSubmitLabel(mode: ResolveMode, saving: boolean, resend: boolean): string {
  if (mode === "delete_contact") return saving ? "Deleting…" : "Delete contact";
  if (mode === "archive_profile") return saving ? "Archiving…" : "Archive profile";
  if (mode === "clear_email") return saving ? "Removing…" : "Remove email";
  if (saving) return "Saving…";
  return resend ? "Save & resend" : "Save email";
}

function ResolveModeChoices({
  canArchiveProfile,
  canClearEmail,
  canDeleteContact,
  mode,
  onSelect,
  recipientKind,
  saving,
}: {
  readonly canArchiveProfile: boolean;
  readonly canClearEmail: boolean;
  readonly canDeleteContact: boolean;
  readonly mode: ResolveMode;
  readonly onSelect: (nextMode: ResolveMode) => void;
  readonly recipientKind: CommunicationDeliveryIssue["recipientKind"];
  readonly saving: boolean;
}) {
  return (
    <fieldset className="field">
      <legend>Fix option</legend>
      <div className="choice-group">
        <label className="choice-field" htmlFor="resolve-mode-update">
          <input
            checked={mode === "update_email"}
            disabled={saving}
            id="resolve-mode-update"
            name="resolve-delivery-mode"
            onChange={() => {
              onSelect("update_email");
            }}
            type="radio"
            value="update_email"
          />
          <span className="choice-field__content">
            <span className="choice-field__title">Update email address</span>
            <span className="choice-field__description">
              Replace the bounced address with a working email.
            </span>
          </span>
        </label>
        {canClearEmail ? (
          <label className="choice-field" htmlFor="resolve-mode-clear">
            <input
              checked={mode === "clear_email"}
              disabled={saving}
              id="resolve-mode-clear"
              name="resolve-delivery-mode"
              onChange={() => {
                onSelect("clear_email");
              }}
              type="radio"
              value="clear_email"
            />
            <span className="choice-field__content">
              <span className="choice-field__title">Remove email address</span>
              <span className="choice-field__description">
                Clear this email while keeping the{" "}
                {recipientKind === "profile" ? "Organization Profile" : "contact"}.
              </span>
            </span>
          </label>
        ) : null}
        {canArchiveProfile ? (
          <label className="choice-field" htmlFor="resolve-mode-archive">
            <input
              checked={mode === "archive_profile"}
              disabled={saving}
              id="resolve-mode-archive"
              name="resolve-delivery-mode"
              onChange={() => {
                onSelect("archive_profile");
              }}
              type="radio"
              value="archive_profile"
            />
            <span className="choice-field__content">
              <span className="choice-field__title">Archive Organization Profile</span>
              <span className="choice-field__description">
                Hide from the active roster while preserving message and roster history.
              </span>
            </span>
          </label>
        ) : null}
        {canDeleteContact ? (
          <label className="choice-field" htmlFor="resolve-mode-delete">
            <input
              checked={mode === "delete_contact"}
              disabled={saving}
              id="resolve-mode-delete"
              name="resolve-delivery-mode"
              onChange={() => {
                onSelect("delete_contact");
              }}
              type="radio"
              value="delete_contact"
            />
            <span className="choice-field__content">
              <span className="choice-field__title">Remove contact</span>
              <span className="choice-field__description">
                Permanently delete this contact from Contacts and its lists.
              </span>
            </span>
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}

function ResolveModeBody({
  email,
  issue,
  mode,
  onEmailChange,
  onResendChange,
  resend,
  saving,
}: {
  readonly email: string;
  readonly issue: CommunicationDeliveryIssue;
  readonly mode: ResolveMode;
  readonly onEmailChange: (value: string) => void;
  readonly onResendChange: (value: boolean) => void;
  readonly resend: boolean;
  readonly saving: boolean;
}) {
  if (mode === "clear_email") {
    return (
      <div className="notice notice--warning">
        <p>
          This removes <strong>{issue.destination}</strong> from{" "}
          <strong>{issue.recipientName}</strong> so future emails will not be sent to this address.
          The {issue.recipientKind === "profile" ? "Organization Profile" : "contact record"} will
          be kept.
        </p>
      </div>
    );
  }
  if (mode === "archive_profile") {
    return (
      <div className="notice notice--warning">
        <p>
          Organization Profiles with message or roster history cannot be permanently deleted.
          Archiving hides <strong>{issue.recipientName}</strong> from the active roster while
          preserving their history. You can restore archived profiles at any time.
        </p>
      </div>
    );
  }
  if (mode === "delete_contact") {
    return (
      <div className="notice notice--error">
        <p>
          This permanently deletes <strong>{issue.recipientName}</strong> from Contacts, including
          communication preferences and list memberships. This action cannot be undone.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="field">
        <label htmlFor="resolve-delivery-email-input">Updated email address</label>
        <input
          autoComplete="email"
          disabled={saving}
          id="resolve-delivery-email-input"
          maxLength={320}
          onChange={(event) => {
            onEmailChange(event.target.value);
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
            onResendChange(event.target.checked);
          }}
          type="checkbox"
        />
        <span>Also resend this message to the updated email</span>
      </label>
      <p className="field-help">
        Saving a new email address automatically clears provider bounce suppression on the old
        address. Explicit unsubscribes and spam complaints are preserved.
      </p>
    </>
  );
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
  const initialEmail = issue?.recipientStatus === "email_removed" ? "" : (issue?.destination ?? "");
  const [mode, setMode] = useState<ResolveMode>("update_email");
  const [email, setEmail] = useState(initialEmail);
  const [resend, setResend] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!issue) return null;

  const canArchiveProfile = issue.canArchiveProfile === true;
  const canClearEmail = issue.canClearEmail === true;
  const canDeleteContact = issue.canDeleteContact === true;
  const trimmedEmail = email.trim();
  const isDirty = mode !== "update_email" || trimmedEmail !== initialEmail.trim() || !resend;
  const isDestructive = mode !== "update_email";

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issue) return;
    if (mode === "update_email" && !trimmedEmail.includes("@")) {
      setFormError("Enter a valid email address.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: CommunicationResolveDeliveryEmailRequest =
        mode === "clear_email"
          ? { action: "clear_email" }
          : mode === "delete_contact"
            ? { action: "delete_contact" }
            : mode === "archive_profile"
              ? { action: "archive_profile" }
              : { email: trimmedEmail, resend };
      await onSubmit(issue.deliveryId, payload);
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
            className={isDestructive ? "button button--danger" : "button button--primary"}
            disabled={busy || saving}
            form="resolve-delivery-email-form"
            type="submit"
          >
            {resolveSubmitLabel(mode, saving, resend)}
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

        {canArchiveProfile || canClearEmail || canDeleteContact ? (
          <ResolveModeChoices
            canArchiveProfile={canArchiveProfile}
            canClearEmail={canClearEmail}
            canDeleteContact={canDeleteContact}
            mode={mode}
            onSelect={(nextMode) => {
              setMode(nextMode);
              setFormError(null);
            }}
            recipientKind={issue.recipientKind}
            saving={saving}
          />
        ) : null}

        <ResolveModeBody
          email={email}
          issue={issue}
          mode={mode}
          onEmailChange={(value) => {
            setEmail(value);
            setFormError(null);
          }}
          onResendChange={setResend}
          resend={resend}
          saving={saving}
        />
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
                  {issue.recipientStatus === "contact_removed" ? (
                    <span className="status-pill status-pill--neutral">Contact removed</span>
                  ) : issue.recipientStatus === "profile_archived" ? (
                    <span className="status-pill status-pill--neutral">Archived</span>
                  ) : issue.recipientStatus === "email_removed" ? (
                    <span className="status-pill status-pill--neutral">Email removed</span>
                  ) : null}
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
