import type {
  CommunicationAudienceRequest,
  CommunicationMessage,
  CommunicationTemplate,
  ContactList,
  OrganizationBranding,
  OrganizationEvent,
  OrganizationProviderStatusResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { removeCommunicationPlaceholder, validateCommunicationContext } from "@choir/domain";
import { TabsContent, useConfirmation } from "@choir/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import {
  getOrganizationBranding,
  getOrganizationCommunicationDeliverySummary,
  getOrganizationProviderStatus,
  getOrganizationRosterConfiguration,
  listOrganizationCommunicationTemplates,
  listOrganizationEventPromotionMessages,
  previewOrganizationCommunicationReach,
  retryOrganizationCommunicationDeliveries,
  saveOrganizationCommunicationDraft,
  saveOrganizationCommunicationTemplate,
  sendOrganizationCommunication,
  sendOrganizationCommunicationTestEmail,
  cancelOrganizationCommunication,
  deleteOrganizationCommunicationDraft,
} from "../../../../auth/api";
import { listOrganizationContactLists } from "../../../../api";
import { CommunicationDeliveryDetails } from "../../CommunicationCenter/CommunicationDeliveryDetails";
import { CommunicationReviewDialog } from "../../CommunicationCenter/CommunicationReviewDialog";
import { CommunicationTestDialog } from "../../CommunicationCenter/CommunicationTestDialog";
import { MessageComposer } from "../../CommunicationCenter/MessageComposer";
import { MessageList } from "../../CommunicationCenter/MessageList";
import { SaveAsTemplateDialog } from "../../CommunicationCenter/SaveAsTemplateDialog";
import type {
  CommunicationReachState,
  UnifiedCommunicationItem,
} from "../../CommunicationCenter/types";
import { audienceOptions, defaultAudience, failureMessage } from "../../CommunicationCenter/utils";

const EMPTY_REACH_STATE: CommunicationReachState = {
  data: null,
  error: null,
  loading: false,
};

function promotionAudience(eventId: string): CommunicationAudienceRequest {
  return {
    ...defaultAudience,
    eventId: null,
    excludeTicketBuyersForEventId: eventId,
    targetAudiences: ["Ticket Buyers"],
    ticketBuyerMode: "marketing",
    ticketBuyerPastEventsOnly: true,
    ticketBuyerSourceEventIds: [],
  };
}

function invitationFor(event: OrganizationEvent | null) {
  const eventTitle = event?.title ?? "{eventTitle}";
  const savedLocation = event?.location.trim();
  const eventLocation = savedLocation && savedLocation.length > 0 ? savedLocation : "the venue";
  return {
    contentMarkdown: `Hello {recipientName},\n\nWe'd love to invite you to ${eventTitle} on {eventDate} at ${eventLocation}.\n\n{{EVENT_TICKET_LINK}}\n\nWe hope you can join us!\n\nThank you,\n{organizationName}`,
    subject: `Tickets are available: ${eventTitle}`,
  };
}

function toHistoryItems(
  messages: readonly CommunicationMessage[],
): readonly UnifiedCommunicationItem[] {
  return messages.map((message) => ({
    automated: false,
    channel: message.channel,
    id: message.id,
    kind: "manual",
    message,
    recipientCount: message.reach.total,
    status: message.status,
    timestamp: message.sentAt ?? message.createdAt,
    title: message.subject || "Event promotion",
  }));
}

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

function isPromotionEligible(event: OrganizationEvent | null, nowMs: number): boolean {
  return (
    event?.type === "Performance" &&
    !event.isCanceled &&
    event.isTicketingEnabled &&
    event.publishOnWebsite &&
    Date.parse(event.startsAt) > nowMs
  );
}

function previousPerformances(
  events: readonly OrganizationEvent[],
  nowMs: number,
): readonly OrganizationEvent[] {
  return events.filter(
    (event) =>
      event.type === "Performance" && !event.isCanceled && Date.parse(event.startsAt) < nowMs,
  );
}

function promotionEligibilityReason(event: OrganizationEvent | null, nowMs: number): string | null {
  if (!event) return "Save this event before preparing an announcement.";
  if (event.type !== "Performance") return "Promotion is available for Performances.";
  if (!event.isTicketingEnabled) return "Enable ticket sales before preparing an announcement.";
  if (!event.publishOnWebsite) return "Publish this Performance before preparing an announcement.";
  if (event.isCanceled) return "Canceled or archived events cannot start a promotion.";
  if (Date.parse(event.startsAt) <= nowMs) {
    return "Ticket promotion is unavailable after the Performance has started.";
  }
  return null;
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
  message,
  onClose,
  onRetry,
  summary,
}: {
  readonly busy: boolean;
  readonly message: CommunicationMessage | null;
  readonly onClose: () => void;
  readonly onRetry: () => Promise<void>;
  readonly summary: Awaited<ReturnType<typeof getOrganizationCommunicationDeliverySummary>> | null;
}) {
  if (!message || !summary) return null;
  return (
    <div className="event-promotion-delivery-details">
      <button className="text-button" onClick={onClose} type="button">
        Hide delivery details
      </button>
      <CommunicationDeliveryDetails
        busy={busy}
        message={message}
        onRetry={onRetry}
        summary={summary}
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
  const { confirm, confirmationDialog } = useConfirmation();
  const [messages, setMessages] = useState<readonly CommunicationMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(!editingId);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<CommunicationMessage | null>(null);
  const [messageBaseline, setMessageBaseline] = useState<{
    readonly audience: CommunicationAudienceRequest;
    readonly channel: "Email";
    readonly contentMarkdown: string;
    readonly subject: string;
  } | null>(null);
  const [draftMessageId, setDraftMessageId] = useState<string | null>(null);
  const [eventPromotion, setEventPromotion] =
    useState<CommunicationMessage["eventPromotion"]>(null);
  const [audience, setAudience] = useState<CommunicationAudienceRequest>(() =>
    editingId ? promotionAudience(editingId) : defaultAudience,
  );
  const [channel, setChannel] = useState<"Email">("Email");
  const [subject, setSubject] = useState("");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [contactLists, setContactLists] = useState<readonly ContactList[]>([]);
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [providerStatus, setProviderStatus] = useState<OrganizationProviderStatusResponse | null>(
    null,
  );
  const [rosterConfiguration, setRosterConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reachState, setReachState] = useState<CommunicationReachState>(EMPTY_REACH_STATE);
  const [recipientsExpanded, setRecipientsExpanded] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSnapshot, setReviewSnapshot] = useState<string | null>(null);
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState<CommunicationMessage | null>(null);
  const [deliverySummary, setDeliverySummary] = useState<Awaited<
    ReturnType<typeof getOrganizationCommunicationDeliverySummary>
  > | null>(null);
  const [loadingDeliveryId, setLoadingDeliveryId] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());
  const historyLoading = Boolean(editingId) && !historyLoaded;

  const currentEvent = savedEvent;
  const eligible = isPromotionEligible(savedEvent, nowMs);
  const sourceEvents = useMemo(() => previousPerformances(events, nowMs), [events, nowMs]);

  const loadHistory = useCallback(async (eventId: string, signal?: AbortSignal) => {
    try {
      const loadedMessages = await listOrganizationEventPromotionMessages(eventId, signal);
      if (!signal?.aborted) setMessages(loadedMessages);
    } catch (loadError: unknown) {
      if (!signal?.aborted) setHistoryError(failureMessage(loadError));
    } finally {
      if (!signal?.aborted) setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!editingId) return;
    const controller = new AbortController();
    const historyTimer = window.setTimeout(() => {
      void loadHistory(editingId, controller.signal);
    }, 0);
    Promise.all([
      getOrganizationBranding(controller.signal).catch(() => null),
      getOrganizationProviderStatus(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationCommunicationTemplates(controller.signal),
      listOrganizationContactLists(controller.signal).catch(() => []),
    ])
      .then(([loadedBranding, loadedProviderStatus, loadedRoster, loadedTemplates, lists]) => {
        if (controller.signal.aborted) return;
        setBranding(loadedBranding);
        setProviderStatus(loadedProviderStatus);
        setRosterConfiguration(loadedRoster);
        setTemplates(loadedTemplates);
        setContactLists(lists);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setDataError(failureMessage(loadError));
      });
    return () => {
      window.clearTimeout(historyTimer);
      controller.abort();
    };
  }, [editingId, loadHistory]);

  useEffect(() => {
    if (!editingId || !eventPromotion || dirty || !eligible) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setReachState((previous) => ({ ...previous, error: null, loading: true }));
      void previewOrganizationCommunicationReach({ audience, channel }, controller.signal)
        .then((reach) => {
          if (!controller.signal.aborted)
            setReachState({ data: reach, error: null, loading: false });
        })
        .catch((reachError: unknown) => {
          if (!controller.signal.aborted) {
            setReachState({ data: null, error: failureMessage(reachError), loading: false });
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [audience, channel, dirty, editingId, eligible, eventPromotion]);

  const contextIssues = useMemo(
    () =>
      validateCommunicationContext({
        audience,
        channel,
        contentMarkdown,
        ...(eventPromotion ? { eventId: eventPromotion.eventId } : {}),
        subject,
      }),
    [audience, channel, contentMarkdown, eventPromotion, subject],
  );

  const historyItems = useMemo(() => toHistoryItems(messages), [messages]);
  const initialMessage = messages.find(
    (message) => message.eventPromotion?.announcementKind === "initial",
  );
  const hasInitialDraft = initialMessage?.status === "Draft";
  const hasInitialQueuedOrSent = Boolean(initialMessage && initialMessage.status !== "Draft");

  function updateAudience(
    updater: (current: CommunicationAudienceRequest) => CommunicationAudienceRequest,
  ): void {
    const nextAudience = updater(audience);
    setAudience(nextAudience);
    setReachState(EMPTY_REACH_STATE);
    setReviewSnapshot(null);
    markDraftDirty({ audience: nextAudience });
  }

  function updateSubject(value: string): void {
    setSubject(value);
    setReviewSnapshot(null);
    markDraftDirty({ subject: value });
  }

  function updateContentMarkdown(value: string): void {
    setContentMarkdown(value);
    setReviewSnapshot(null);
    markDraftDirty({ contentMarkdown: value });
  }

  function setComposerBaseline(
    baseline: {
      readonly audience: CommunicationAudienceRequest;
      readonly channel: "Email";
      readonly contentMarkdown: string;
      readonly subject: string;
    } | null,
  ): void {
    setMessageBaseline(baseline);
    onDraftDirtyChange(false);
  }

  function markDraftDirty(
    changes: Partial<{
      readonly audience: CommunicationAudienceRequest;
      readonly channel: "Email";
      readonly contentMarkdown: string;
      readonly subject: string;
    }>,
  ): void {
    if (!eventPromotion || !messageBaseline) {
      onDraftDirtyChange(false);
      return;
    }
    const current = {
      audience,
      channel,
      contentMarkdown,
      subject,
      ...changes,
    };
    onDraftDirtyChange(JSON.stringify(current) !== JSON.stringify(messageBaseline));
  }

  async function refreshHistory(): Promise<void> {
    if (!editingId) return;
    setHistoryError(null);
    setHistoryLoaded(false);
    await loadHistory(editingId);
  }

  function startInitialComposer(): void {
    if (!editingId) return;
    const initial = invitationFor(savedEvent);
    setDraftMessageId(crypto.randomUUID());
    setEventPromotion({ announcementKind: "initial", eventId: editingId, parentMessageId: null });
    setActiveDraft(null);
    setAudience(promotionAudience(editingId));
    setSubject(initial.subject);
    setContentMarkdown(initial.contentMarkdown);
    setComposerBaseline({
      audience: promotionAudience(editingId),
      channel: "Email",
      contentMarkdown: initial.contentMarkdown,
      subject: initial.subject,
    });
    setReachState(EMPTY_REACH_STATE);
    setReviewSnapshot(null);
    setSuccess(null);
    setError(null);
  }

  function resumeDraft(draft: CommunicationMessage): void {
    setActiveDraft(draft);
    setDraftMessageId(draft.id);
    setEventPromotion(draft.eventPromotion);
    setAudience(draft.audience);
    setChannel("Email");
    setSubject(draft.subject);
    setContentMarkdown(draft.contentMarkdown);
    setComposerBaseline({
      audience: draft.audience,
      channel: "Email",
      contentMarkdown: draft.contentMarkdown,
      subject: draft.subject,
    });
    setReachState(EMPTY_REACH_STATE);
    setReviewSnapshot(null);
    setError(null);
    setSuccess("Draft loaded. Review the recipients and message before sending.");
  }

  async function persistDraft(): Promise<CommunicationMessage | null> {
    if (!editingId || !eventPromotion) return null;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const messageId = activeDraft?.id ?? draftMessageId ?? crypto.randomUUID();
      setDraftMessageId(messageId);
      const saved = await saveOrganizationCommunicationDraft({
        audience,
        channel,
        contentMarkdown,
        eventPromotion,
        ...(activeDraft ? { expectedRevision: activeDraft.draftRevision } : {}),
        messageId,
        subject,
      });
      setActiveDraft(saved);
      setComposerBaseline({ audience, channel: "Email", contentMarkdown, subject });
      setMessages((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSuccess("Draft saved. It is not sent until you review and confirm.");
      return saved;
    } catch (saveError: unknown) {
      setError(failureMessage(saveError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openReview(): Promise<void> {
    const promotion = eventPromotion;
    if (dirty || !eligible || !promotion || contextIssues.length > 0) return;
    const saved = await persistDraft();
    if (!saved) return;
    try {
      const freshReach = await previewOrganizationCommunicationReach({
        audience,
        channel,
        contentMarkdown,
        draftRevision: saved.draftRevision,
        eventPromotion: promotion,
        messageId: saved.id,
        subject,
      });
      setReachState({ data: freshReach, error: null, loading: false });
      if (freshReach.total === 0) {
        setError("There are no reachable recipients for these selections.");
        return;
      }
      if (freshReach.ticketBuyerPurchasesOverLimit > 0 || freshReach.audienceOverLimit) {
        setError(
          "This audience exceeds the 500-recipient promotion limit. Narrow the source events or Contact filters.",
        );
        return;
      }
      if (!freshReach.reviewSnapshot) {
        setError("The recipient review could not be verified. Reopen it before sending.");
        return;
      }
      setReviewSnapshot(freshReach.reviewSnapshot);
      setReviewOpen(true);
    } catch (reviewError: unknown) {
      setError(failureMessage(reviewError));
    }
  }

  async function sendPromotion(): Promise<void> {
    if (!eventPromotion || !activeDraft || !reviewSnapshot) {
      setError("Review the current recipients again before sending this announcement.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const queued = await sendOrganizationCommunication(
        {
          audience,
          channel,
          contentMarkdown,
          eventPromotion,
          expectedRevision: activeDraft.draftRevision,
          messageId: activeDraft.id,
          reviewSnapshot,
          subject,
        },
        crypto.randomUUID(),
      );
      setReviewOpen(false);
      setActiveDraft(null);
      setDraftMessageId(null);
      setEventPromotion(null);
      setComposerBaseline(null);
      setReviewSnapshot(null);
      setSuccess(`Announcement queued for ${String(queued.reach.total)} recipients.`);
      await refreshHistory();
    } catch (sendError: unknown) {
      setError(failureMessage(sendError));
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail(email: string): Promise<void> {
    if (!eventPromotion) return;
    setBusy(true);
    setError(null);
    try {
      await sendOrganizationCommunicationTestEmail(
        { audience, contentMarkdown, email, eventId: eventPromotion.eventId, subject },
        crypto.randomUUID(),
      );
      setTestEmailOpen(false);
      setSuccess(`Test email sent to ${email}.`);
    } catch (testError: unknown) {
      setError(failureMessage(testError));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(title: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrganizationCommunicationTemplate({
        channel,
        contentMarkdown,
        subject,
        title,
      });
      setTemplates((current) => [saved, ...current.filter((template) => template.id !== saved.id)]);
      setSaveTemplateOpen(false);
      setSuccess(`Template “${title}” saved.`);
    } catch (templateError: unknown) {
      setError(failureMessage(templateError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft(messageId: string): Promise<void> {
    const accepted = await confirm({
      confirmLabel: "Delete draft",
      description: "Delete this unsent event promotion draft?",
      destructive: true,
      title: "Delete promotion draft",
    });
    if (!accepted) return;
    setBusy(true);
    try {
      await deleteOrganizationCommunicationDraft(messageId);
      setMessages((current) => current.filter((message) => message.id !== messageId));
      if (activeDraft?.id === messageId) {
        setActiveDraft(null);
        setDraftMessageId(null);
        setEventPromotion(null);
        setComposerBaseline(null);
      }
      setSuccess("Draft deleted.");
    } catch (deleteError: unknown) {
      setError(failureMessage(deleteError));
    } finally {
      setBusy(false);
    }
  }

  async function cancelQueued(messageId: string): Promise<void> {
    const accepted = await confirm({
      confirmLabel: "Cancel message",
      description:
        "Cancel remaining queued deliveries? Already completed deliveries remain in history.",
      destructive: true,
      title: "Cancel event promotion",
    });
    if (!accepted) return;
    setBusy(true);
    try {
      const canceled = await cancelOrganizationCommunication(messageId);
      setMessages((current) =>
        current.map((message) => (message.id === messageId ? canceled : message)),
      );
    } catch (cancelError: unknown) {
      setError(failureMessage(cancelError));
    } finally {
      setBusy(false);
    }
  }

  async function openDeliveryDetails(message: CommunicationMessage): Promise<void> {
    setLoadingDeliveryId(message.id);
    try {
      setDeliverySummary(await getOrganizationCommunicationDeliverySummary(message.id));
      setDeliveryMessage(message);
    } catch (detailsError: unknown) {
      setError(failureMessage(detailsError));
    } finally {
      setLoadingDeliveryId(null);
    }
  }

  async function retryDeliveries(messageId: string): Promise<void> {
    setBusy(true);
    try {
      await retryOrganizationCommunicationDeliveries(messageId);
      await refreshHistory();
      if (deliveryMessage?.id === messageId) {
        setDeliverySummary(await getOrganizationCommunicationDeliverySummary(messageId));
      }
      setSuccess("Failed deliveries retried through the existing communication queue.");
    } catch (retryError: unknown) {
      setError(failureMessage(retryError));
    } finally {
      setBusy(false);
    }
  }

  async function createFollowUp(parent: CommunicationMessage): Promise<void> {
    if (!editingId || !eligible) return;
    const existingFollowUp = messages.find(
      (message) =>
        message.status === "Draft" &&
        message.eventPromotion?.announcementKind === "follow_up" &&
        message.eventPromotion.parentMessageId === parent.id,
    );
    if (existingFollowUp) {
      resumeDraft(existingFollowUp);
      return;
    }
    if (parent.status === "Canceled") {
      const accepted = await confirm({
        confirmLabel: "Create follow-up draft",
        description:
          "Some recipients may already have received the canceled announcement. Review its delivery results before sending a follow-up.",
        title: "Create a replacement follow-up?",
      });
      if (!accepted) return;
    }
    setEventPromotion({
      announcementKind: "follow_up",
      eventId: editingId,
      parentMessageId: parent.id,
    });
    setDraftMessageId(crypto.randomUUID());
    setActiveDraft(null);
    setAudience(promotionAudience(editingId));
    setSubject(`Follow-up: ${parent.subject}`);
    setContentMarkdown(parent.contentMarkdown);
    setComposerBaseline({
      audience: promotionAudience(editingId),
      channel: "Email",
      contentMarkdown: parent.contentMarkdown,
      subject: `Follow-up: ${parent.subject}`,
    });
    setReachState(EMPTY_REACH_STATE);
    setReviewSnapshot(null);
    setError(null);
    setSuccess(
      "A follow-up draft is ready. Edit it, save it, and review the current audience before sending.",
    );
  }

  function removeConflictingPlaceholder(tag: string): void {
    updateContentMarkdown(removeCommunicationPlaceholder(contentMarkdown, tag));
    updateSubject(removeCommunicationPlaceholder(subject, tag));
  }

  function onResume(draft: CommunicationMessage): void {
    resumeDraft(draft);
  }

  const composerEventPromotion = eventPromotion;
  const composerReachState = dirty || !eligible || !eventPromotion ? EMPTY_REACH_STATE : reachState;
  const senderReady = Boolean(providerStatus?.emailSender.fromEmail);
  const noInitialMessage = !initialMessage;
  const showComposer =
    editingId !== null &&
    eventPromotion !== null &&
    !dirty &&
    eligible &&
    (activeDraft !== null || !hasInitialDraft);
  const historyActions = {
    busy,
    currentOrigin: "manual" as const,
    currentStatus: "all" as const,
    deliveryDetailsMessage: deliveryMessage,
    deliverySummary,
    loadingDeliveryId,
    onCancelQueued: cancelQueued,
    onCreateFollowUp: createFollowUp,
    onDeleteDraft: deleteDraft,
    onOpenDeliveryDetails: openDeliveryDetails,
    onResumeDraft: onResume,
    onRetryDeliveries: retryDeliveries,
    unifiedMessages: historyItems,
  };

  const eligibilityReason = promotionEligibilityReason(savedEvent, nowMs);

  return (
    <TabsContent
      aria-labelledby="event-editor-promotion-tab"
      className="event-editor-panel"
      forceMount
      id="event-editor-promotion-panel"
      value="promotion"
    >
      <div className="event-promotion-section">
        <PromotionSectionHeader eligible={eligible} />
        <PromotionNotices
          dataError={dataError}
          dirty={dirty}
          eligibilityReason={eligibilityReason}
          eligible={eligible}
          error={error}
          senderReady={senderReady}
          success={success}
        />
        <PromotionHistory
          historyError={historyError}
          historyItems={historyItems}
          historyLoading={historyLoading}
          messageActions={historyActions}
          messages={messages}
        />
        <PromotionInitialState
          activeDraft={activeDraft}
          dirty={dirty}
          eligible={eligible}
          eventPromotion={eventPromotion}
          hasInitialDraft={hasInitialDraft}
          hasInitialQueuedOrSent={hasInitialQueuedOrSent}
          initialStatus={initialMessage?.status}
          noInitialMessage={noInitialMessage}
          onStart={startInitialComposer}
          senderReady={senderReady}
        />
        <PromotionComposerPanel
          audience={audience}
          audienceOptions={audienceOptions.filter(
            (option) => option === "Ticket Buyers" || option === "Contacts",
          )}
          branding={branding}
          busy={busy}
          channel={channel}
          contactLists={contactLists}
          contentMarkdown={contentMarkdown}
          contextIssues={contextIssues}
          eventPromotion={composerEventPromotion}
          events={sourceEvents}
          idPrefix="event-promotion"
          onChannelChange={() => {
            setChannel("Email");
          }}
          onContentChange={updateContentMarkdown}
          onOpenReview={() => {
            void openReview();
          }}
          onOpenSaveTemplate={() => {
            setSaveTemplateOpen(true);
          }}
          onOpenTestEmail={() => {
            setTestEmailOpen(true);
          }}
          onRemoveConflictingPlaceholder={removeConflictingPlaceholder}
          onSaveDraft={() => {
            void persistDraft();
          }}
          onSubjectChange={updateSubject}
          onToggleRecipientsExpanded={setRecipientsExpanded}
          onUpdateAudience={updateAudience}
          reachState={composerReachState}
          recipientsExpanded={recipientsExpanded}
          rosterConfiguration={rosterConfiguration}
          selectedEvent={currentEvent}
          subject={subject}
          timezone={timezone}
          templates={templates}
          visible={showComposer}
        />
        <PromotionDeliveryDetailsPanel
          busy={busy}
          message={deliveryMessage}
          onClose={() => {
            setDeliveryMessage(null);
          }}
          onRetry={() => {
            return deliveryMessage ? retryDeliveries(deliveryMessage.id) : Promise.resolve();
          }}
          summary={deliverySummary}
        />

        <CommunicationReviewDialog
          audience={audience}
          busy={busy}
          channel={channel}
          contactLists={contactLists}
          contentMarkdown={contentMarkdown}
          error={error}
          onClose={() => {
            setReviewOpen(false);
            setReviewSnapshot(null);
          }}
          onSend={() => {
            void sendPromotion();
          }}
          open={reviewOpen}
          reachState={composerReachState}
          rosterConfiguration={rosterConfiguration}
          selectedEvent={currentEvent}
          subject={subject}
          timezone={timezone}
          branding={branding}
        />
        <CommunicationTestDialog
          busy={busy}
          error={error}
          onClose={() => {
            setTestEmailOpen(false);
          }}
          onSend={sendTestEmail}
          open={testEmailOpen}
        />
        <SaveAsTemplateDialog
          busy={busy}
          error={error}
          onClose={() => {
            setSaveTemplateOpen(false);
          }}
          onSave={saveTemplate}
          open={saveTemplateOpen}
        />
        {confirmationDialog}
      </div>
    </TabsContent>
  );
}
