import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  OrganizationEvent,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import {
  communicationPreviewValues,
  renderCommunicationMarkdownPreview,
} from "../../communicationMarkdown";
import type { CommunicationReachState } from "./types";
import { memberFiltersSummary, reachSummaryText, recipientTypeSummary } from "./utils";

interface CommunicationReviewDialogProps {
  readonly audience: CommunicationAudienceRequest;
  readonly busy: boolean;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSend: () => void;
  readonly open: boolean;
  readonly reachState: CommunicationReachState;
  readonly rosterConfiguration: OrganizationRosterConfiguration | null;
  readonly selectedEvent: OrganizationEvent | null;
  readonly subject: string;
}

export function CommunicationReviewDialog({
  audience,
  busy,
  channel,
  contentMarkdown,
  error,
  onClose,
  onSend,
  open,
  reachState,
  rosterConfiguration,
  selectedEvent,
  subject,
}: CommunicationReviewDialogProps) {
  const recipientSummary = recipientTypeSummary(audience);
  const memberSummary = audience.targetAudiences.includes("Members")
    ? memberFiltersSummary(audience, rosterConfiguration)
    : "";

  const totalCount = reachState.data?.total ?? 0;
  const previewValues = communicationPreviewValues(selectedEvent);

  return (
    <Dialog
      description="Review recipients and message content before queueing delivery."
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
      title="Review message"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="communication-review-content">
        <dl className="communication-review-summary-grid">
          <div>
            <dt>Recipients</dt>
            <dd>
              <strong>{recipientSummary}</strong>
              {memberSummary ? ` · ${memberSummary}` : ""}
              {selectedEvent ? ` · ${selectedEvent.title}` : ""}
            </dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>{channel}</dd>
          </div>
          <div>
            <dt>Reach</dt>
            <dd>
              {reachState.data ? reachSummaryText(reachState.data, channel) : "Calculating reach…"}
            </dd>
          </div>
          {channel !== "SMS" && subject ? (
            <div>
              <dt>Subject</dt>
              <dd>{subject}</dd>
            </div>
          ) : null}
        </dl>

        <div className="communication-review-message-preview">
          <span className="field-label">Message preview</span>
          <div
            className="communication-composer__preview preview-body"
            dangerouslySetInnerHTML={{
              __html: renderCommunicationMarkdownPreview(contentMarkdown, previewValues),
            }}
          />
        </div>

        <p className="field-help">
          Delivery will be queued immediately and sent to recipients according to your organization
          delivery settings.
        </p>

        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Back to edit
            </button>
          </DialogClose>
          <button
            className="button button--primary"
            disabled={busy || totalCount === 0}
            onClick={onSend}
            type="button"
          >
            {busy
              ? "Queueing…"
              : `Send to ${String(totalCount)} ${totalCount === 1 ? "recipient" : "recipients"}`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
