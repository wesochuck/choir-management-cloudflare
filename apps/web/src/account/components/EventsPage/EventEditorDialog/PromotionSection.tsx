import type { CommunicationMessage, OrganizationEvent } from "@choir/contracts";
import { TabsContent } from "@choir/ui";
import type { ComponentProps } from "react";
import type { getOrganizationCommunicationDeliverySummary } from "../../../../auth/api";
import { CommunicationDeliveryDetails } from "../../CommunicationCenter/CommunicationDeliveryDetails";
import { CommunicationReviewDialog } from "../../CommunicationCenter/CommunicationReviewDialog";
import { MessageComposer } from "../../CommunicationCenter/MessageComposer";
import { MessageList } from "../../CommunicationCenter/MessageList";
import { SaveAsTemplateDialog } from "../../CommunicationCenter/SaveAsTemplateDialog";
import type { UnifiedCommunicationItem } from "../../CommunicationCenter/types";
import { audienceOptions } from "../../CommunicationCenter/utils";
import { useEventPromotionController } from "./useEventPromotionController";

type PromotionHistoryActions = Omit<
  ComponentProps<typeof MessageList>,
  "currentOrigin" | "currentStatus" | "unifiedMessages"
>;

function PromotionSectionHeader({ eligible }: { readonly eligible: boolean }) {
  return (
    <div className="event-editor-panel__header">
      <div className="event-editor-panel__title-row">
        <h3 className="event-editor-panel__title" id="event-promotion-heading" tabIndex={-1}>
          Promotion
        </h3>
        <span className={`status-pill status-pill--${eligible ? "success" : "neutral"}`}>
          {eligible ? "Ready" : "Not ready"}
        </span>
      </div>
      <p className="event-editor-panel__description">
        Prepare an email through Communications. Nothing is sent until you review and confirm.
      </p>
    </div>
  );
}

function PromotionNotices({
  dataError,
  dirty,
  eligibilityReason,
  eligible,
  error,
  senderReady,
  success,
}: {
  readonly dataError: string | null;
  readonly dirty: boolean;
  readonly eligibilityReason: string | null;
  readonly eligible: boolean;
  readonly error: string | null;
  readonly senderReady: boolean;
  readonly success: string | null;
}) {
  return (
    <>
      {dirty ? (
        <p className="notice notice--warning" role="status">
          Save event changes before preparing or sending an announcement. Existing promotion history
          remains available below.
        </p>
      ) : !eligible ? (
        <p className="notice notice--info" role="status">
          {eligibilityReason}
        </p>
      ) : null}
      {dataError ? (
        <p className="notice notice--error" role="alert">
          {dataError}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {eligible && !senderReady ? (
        <p className="notice notice--warning" role="status">
          Configure the Organization email sender before preparing a promotion.{" "}
          <a href="/admin/settings/email-settings">Open Email &amp; Sender Settings</a>.
        </p>
      ) : null}
    </>
  );
}

function PromotionHistory({
  historyError,
  historyItems,
  historyLoading,
  messageActions,
  messages,
}: {
  readonly historyError: string | null;
  readonly historyItems: readonly UnifiedCommunicationItem[];
  readonly historyLoading: boolean;
  readonly messageActions: PromotionHistoryActions;
  readonly messages: readonly CommunicationMessage[];
}) {
  if (historyLoading) return <p role="status">Loading promotion history…</p>;
  if (historyError) {
    return (
      <p className="notice notice--error" role="alert">
        {historyError}
      </p>
    );
  }
  if (messages.length === 0) {
    return (
      <p className="notice notice--info" role="status">
        No announcement has been sent for this event.
      </p>
    );
  }
  return (
    <div className="event-promotion-history">
      <h4>Announcement history</h4>
      {messages.map((message) => (
        <div className="event-promotion-history__item" key={message.id}>
          <p className="field-help">
            {message.eventPromotion?.announcementKind === "initial"
              ? "Initial announcement"
              : "Follow-up"}
            {message.eventPromotion?.parentMessageId ? " · Linked to the prior message" : ""}
          </p>
          <MessageList
            {...messageActions}
            currentOrigin="manual"
            currentStatus="all"
            unifiedMessages={historyItems.filter((item) => item.id === message.id)}
          />
        </div>
      ))}
    </div>
  );
}

function InitialDraftNotice({ visible }: { readonly visible: boolean }) {
  if (!visible) return null;
  return (
    <p className="notice notice--info" role="status">
      An initial announcement draft already exists. Open it from the history above to continue.
    </p>
  );
}

function InitialRecordedNotice({
  status,
  visible,
}: {
  readonly status: CommunicationMessage["status"] | undefined;
  readonly visible: boolean;
}) {
  if (!visible) return null;
  return (
    <p className="notice notice--info" role="status">
      The initial announcement is {status?.toLocaleLowerCase() ?? "recorded"}. Use its history and
      delivery details, or create a deliberate follow-up.
    </p>
  );
}

function PrepareAnnouncementButton({
  onStart,
  visible,
}: {
  readonly onStart: () => void;
  readonly visible: boolean;
}) {
  if (!visible) return null;
  return (
    <button className="button button--primary" onClick={onStart} type="button">
      Prepare announcement
    </button>
  );
}

function PromotionInitialState({
  activeDraft,
  eligible,
  eventPromotion,
  hasInitialDraft,
  hasInitialQueuedOrSent,
  initialStatus,
  noInitialMessage,
  onStart,
  senderReady,
  dirty,
}: {
  readonly activeDraft: CommunicationMessage | null;
  readonly eligible: boolean;
  readonly eventPromotion: CommunicationMessage["eventPromotion"];
  readonly hasInitialDraft: boolean;
  readonly hasInitialQueuedOrSent: boolean;
  readonly initialStatus: CommunicationMessage["status"] | undefined;
  readonly noInitialMessage: boolean;
  readonly onStart: () => void;
  readonly senderReady: boolean;
  readonly dirty: boolean;
}) {
  const eligibleToStart = eligible && senderReady && !dirty && noInitialMessage && !eventPromotion;
  const showInitialDraftNotice =
    eligible && senderReady && !dirty && !activeDraft && hasInitialDraft;
  const showInitialRecordedNotice =
    eligible && senderReady && !dirty && !activeDraft && hasInitialQueuedOrSent;
  return (
    <>
      <InitialDraftNotice visible={showInitialDraftNotice} />
      <InitialRecordedNotice status={initialStatus} visible={showInitialRecordedNotice} />
      <PrepareAnnouncementButton onStart={onStart} visible={eligibleToStart} />
    </>
  );
}

function PromotionComposerPanel({
  visible,
  eventPromotion,
  ...composerProps
}: {
  readonly visible: boolean;
  readonly eventPromotion: CommunicationMessage["eventPromotion"];
} & Omit<ComponentProps<typeof MessageComposer>, "eventPromotion">) {
  if (!visible) return null;
  return (
    <div className="event-promotion-composer">
      {eventPromotion?.announcementKind === "follow_up" ? (
        <h4>Create follow-up draft</h4>
      ) : (
        <h4>Prepare announcement</h4>
      )}
      <MessageComposer {...composerProps} eventPromotion={eventPromotion} />
    </div>
  );
}

function PromotionDeliveryDetailsPanel({
  busy,
  events,
  message,
  onClose,
  onRetry,
  summary,
  timezone,
}: {
  readonly busy: boolean;
  readonly events?: readonly OrganizationEvent[] | undefined;
  readonly message: CommunicationMessage | null;
  readonly onClose: () => void;
  readonly onRetry: () => Promise<void>;
  readonly summary: Awaited<ReturnType<typeof getOrganizationCommunicationDeliverySummary>> | null;
  readonly timezone?: string | null | undefined;
}) {
  if (!message || !summary) return null;
  return (
    <div className="event-promotion-delivery-details">
      <button className="text-button" onClick={onClose} type="button">
        Hide delivery details
      </button>
      <CommunicationDeliveryDetails
        busy={busy}
        events={events}
        message={message}
        onRetry={onRetry}
        summary={summary}
        timezone={timezone}
      />
    </div>
  );
}

export function PromotionSection({
  dirty,
  editingId,
  events,
  onDraftDirtyChange,
  savedEvent,
  timezone,
}: {
  readonly dirty: boolean;
  readonly editingId: string | null;
  readonly events: readonly OrganizationEvent[];
  readonly onDraftDirtyChange: (dirty: boolean) => void;
  readonly savedEvent: OrganizationEvent | null;
  readonly timezone: string | null;
}) {
  const controller = useEventPromotionController({
    dirty,
    editingId,
    events,
    onDraftDirtyChange,
    savedEvent,
  });

  return (
    <TabsContent
      aria-labelledby="event-editor-promotion-tab"
      className="event-editor-panel"
      forceMount
      id="event-editor-promotion-panel"
      value="promotion"
    >
      <div className="event-promotion-section">
        <PromotionSectionHeader eligible={controller.eligible} />
        <PromotionNotices
          dataError={controller.dataError}
          dirty={dirty}
          eligibilityReason={controller.eligibilityReason}
          eligible={controller.eligible}
          error={controller.error}
          senderReady={controller.senderReady}
          success={controller.success}
        />
        <PromotionHistory
          historyError={controller.historyError}
          historyItems={controller.historyItems}
          historyLoading={controller.historyLoading}
          messageActions={controller.historyActions}
          messages={controller.messages}
        />
        <PromotionInitialState
          activeDraft={controller.activeDraft}
          dirty={dirty}
          eligible={controller.eligible}
          eventPromotion={controller.eventPromotion}
          hasInitialDraft={controller.hasInitialDraft}
          hasInitialQueuedOrSent={controller.hasInitialQueuedOrSent}
          initialStatus={controller.initialMessage?.status}
          noInitialMessage={controller.noInitialMessage}
          onStart={controller.startInitialComposer}
          senderReady={controller.senderReady}
        />
        <PromotionComposerPanel
          allEvents={events}
          audience={controller.audience}
          audienceOptions={audienceOptions.filter(
            (option) => option === "Ticket Buyers" || option === "Contacts",
          )}
          branding={controller.branding}
          busy={controller.busy}
          channel={controller.channel}
          contactLists={controller.contactLists}
          contentMarkdown={controller.contentMarkdown}
          contextIssues={controller.contextIssues}
          eventPromotion={controller.composerEventPromotion}
          events={controller.sourceEvents}
          idPrefix="event-promotion"
          onChannelChange={() => {
            controller.setChannel("Email");
          }}
          onContentChange={controller.updateContentMarkdown}
          onOpenReview={() => {
            void controller.openReview();
          }}
          onOpenSaveTemplate={() => {
            controller.setSaveTemplateOpen(true);
          }}
          onSendTestEmail={controller.sendTestEmail}
          testEmailError={controller.error}
          onRemoveConflictingPlaceholder={controller.removeConflictingPlaceholder}
          onSaveDraft={() => {
            void controller.persistDraft();
          }}
          onSubjectChange={controller.updateSubject}
          onToggleRecipientsExpanded={controller.setRecipientsExpanded}
          onUpdateAudience={controller.updateAudience}
          reachState={controller.composerReachState}
          recipientsExpanded={controller.recipientsExpanded}
          rosterConfiguration={controller.rosterConfiguration}
          selectedEvent={controller.currentEvent}
          subject={controller.subject}
          timezone={timezone}
          templates={controller.templates}
          visible={controller.showComposer}
        />
        <PromotionDeliveryDetailsPanel
          busy={controller.busy}
          events={events}
          message={controller.deliveryMessage}
          onClose={() => {
            controller.setDeliveryMessage(null);
          }}
          onRetry={() => {
            return controller.deliveryMessage
              ? controller.retryDeliveries(controller.deliveryMessage.id)
              : Promise.resolve();
          }}
          summary={controller.deliverySummary}
          timezone={timezone}
        />

        <CommunicationReviewDialog
          audience={controller.audience}
          busy={controller.busy}
          channel={controller.channel}
          contactLists={controller.contactLists}
          contentMarkdown={controller.contentMarkdown}
          error={controller.error}
          events={events}
          onClose={() => {
            controller.setReviewOpen(false);
            controller.setReviewSnapshot(null);
          }}
          onSend={() => {
            void controller.sendPromotion();
          }}
          open={controller.reviewOpen}
          reachState={controller.composerReachState}
          rosterConfiguration={controller.rosterConfiguration}
          selectedEvent={controller.currentEvent}
          subject={controller.subject}
          timezone={timezone}
          branding={controller.branding}
        />
        <SaveAsTemplateDialog
          busy={controller.busy}
          error={controller.error}
          onClose={() => {
            controller.setSaveTemplateOpen(false);
          }}
          onSave={controller.saveTemplate}
          open={controller.saveTemplateOpen}
        />
        {controller.confirmationDialog}
      </div>
    </TabsContent>
  );
}
