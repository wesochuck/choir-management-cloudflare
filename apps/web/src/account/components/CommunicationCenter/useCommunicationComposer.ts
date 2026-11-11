import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationHistoryItem,
  CommunicationMessage,
  OrganizationEvent,
} from "@choir/contracts";
import {
  filterUpcomingPerformances,
  removeCommunicationPlaceholder,
  shouldIncludeUnpublishedUpcomingPerformances,
  validateCommunicationContext,
} from "@choir/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  deleteOrganizationCommunicationDraft,
  previewOrganizationCommunicationReach,
  saveOrganizationCommunicationDraft,
  sendOrganizationCommunication,
  sendOrganizationCommunicationTestEmail,
} from "../../../auth/api";
import { rsvpNotificationAudience } from "../RsvpManager/rsvpNotification";
import type {
  CommunicationReachState,
  CommunicationSection,
  MessageOriginFilter,
  MessageStatusFilter,
  MessageWorkspaceMode,
} from "./types";
import { defaultAudience, failureMessage } from "./utils";
import type { parseCommunicationSearch } from "./utils";

const EMPTY_REACH_STATE: CommunicationReachState = {
  data: null,
  error: null,
  loading: false,
};

function hasIncompleteTicketServiceAudience(
  audience: CommunicationAudienceRequest,
  channel: CommunicationChannel,
): boolean {
  return (
    audience.ticketBuyerMode === "ticket_service" &&
    (audience.targetAudiences.length !== 1 ||
      audience.targetAudiences[0] !== "Ticket Buyers" ||
      !audience.eventId ||
      channel !== "Email")
  );
}

function reachStateForAudience(
  reachState: CommunicationReachState,
  audience: CommunicationAudienceRequest,
  channel: CommunicationChannel,
): CommunicationReachState {
  return hasIncompleteTicketServiceAudience(audience, channel) ? EMPTY_REACH_STATE : reachState;
}

export function useCommunicationComposer({
  clearDeliveryDetails,
  confirm,
  currentCursor,
  enabled,
  events,
  eventsLoaded,
  initialNav,
  loadHistoryPage,
  messageMode,
  originFilter,
  refreshDraftCount,
  refreshEvents,
  setActiveSection,
  setBusy,
  setDraftCount,
  setError,
  setHistoryItems,
  setMessageMode,
  setMessages,
  setSuccessNotice,
  statusFilter,
}: {
  readonly clearDeliveryDetails: () => void;
  readonly confirm: (options: {
    readonly confirmLabel: string;
    readonly description: string;
    readonly destructive?: boolean;
    readonly title: string;
  }) => Promise<boolean>;
  readonly currentCursor: string | null;
  readonly enabled: boolean;
  readonly events?: readonly OrganizationEvent[] | undefined;
  readonly eventsLoaded?: boolean | undefined;
  readonly initialNav: ReturnType<typeof parseCommunicationSearch>;
  readonly loadHistoryPage: (
    targetStatus: MessageStatusFilter,
    targetOrigin: MessageOriginFilter,
    cursor: string | null,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly messageMode: MessageWorkspaceMode;
  readonly originFilter: MessageOriginFilter;
  readonly refreshDraftCount?: (signal?: AbortSignal) => Promise<void>;
  readonly refreshEvents?: (signal?: AbortSignal) => Promise<void>;
  readonly setActiveSection: Dispatch<SetStateAction<CommunicationSection>>;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setDraftCount?: Dispatch<SetStateAction<number>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setHistoryItems: Dispatch<SetStateAction<readonly CommunicationHistoryItem[]>>;
  readonly setMessageMode: Dispatch<SetStateAction<MessageWorkspaceMode>>;
  readonly setMessages: Dispatch<SetStateAction<readonly CommunicationMessage[]>>;
  readonly setSuccessNotice: Dispatch<SetStateAction<string | null>>;
  readonly statusFilter: MessageStatusFilter;
}) {
  const initialAudience = useMemo<CommunicationAudienceRequest>(
    () =>
      initialNav.rsvpRequest
        ? rsvpNotificationAudience(
            initialNav.rsvpRequest.eventId,
            initialNav.rsvpRequest.voiceParts,
            initialNav.rsvpRequest.globalStatuses,
          )
        : initialNav.attendeeEventId
          ? { ...defaultAudience, eventId: initialNav.attendeeEventId, rsvp: "Yes" }
          : initialNav.contactListId !== undefined
            ? {
                ...defaultAudience,
                targetAudiences: ["Contacts"],
                contactListIds: [initialNav.contactListId],
              }
            : defaultAudience,
    [initialNav.attendeeEventId, initialNav.contactListId, initialNav.rsvpRequest],
  );
  const [audience, setAudience] = useState<CommunicationAudienceRequest>(initialAudience);
  const audienceRef = useRef<CommunicationAudienceRequest>(initialAudience);
  const [recipientsExpanded, setRecipientsExpanded] = useState(Boolean(initialNav.attendeeEventId));

  const [channel, setChannel] = useState<CommunicationChannel>("Email");
  const [contentMarkdown, setContentMarkdown] = useState(
    initialNav.rsvpRequest
      ? "Hello {recipientName},\n\nPlease let us know whether you can attend {eventTitle}.\n\n{{RSVP_LINKS}}\n\nThank you!"
      : "",
  );
  const [subject, setSubject] = useState(initialNav.rsvpRequest ? "Please RSVP: {eventTitle}" : "");
  const [voiceParts, setVoiceParts] = useState(initialAudience.voiceParts.join(", "));
  const [eventPromotion, setEventPromotion] =
    useState<CommunicationMessage["eventPromotion"]>(null);
  const [activeDraft, setActiveDraft] = useState<CommunicationMessage | null>(null);

  const [reachState, setReachState] = useState<CommunicationReachState>(EMPTY_REACH_STATE);

  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewSnapshot, setReviewSnapshot] = useState<string | null>(null);
  const [isTestEmailOpen, setIsTestEmailOpen] = useState(false);
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState(() => crypto.randomUUID());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const replaceAudience = useCallback((nextAudience: CommunicationAudienceRequest) => {
    audienceRef.current = nextAudience;
    setAudience(nextAudience);
    setReviewSnapshot(null);
  }, []);

  const updateChannel = useCallback((value: CommunicationChannel): void => {
    setChannel(value);
    setReviewSnapshot(null);
  }, []);

  const updateContent = useCallback((value: string): void => {
    setContentMarkdown(value);
    setReviewSnapshot(null);
  }, []);

  const updateSubject = useCallback((value: string): void => {
    setSubject(value);
    setReviewSnapshot(null);
  }, []);

  const updateAudience = useCallback(
    (updater: (current: CommunicationAudienceRequest) => CommunicationAudienceRequest) => {
      replaceAudience(updater(audienceRef.current));
    },
    [replaceAudience],
  );

  const resumeDraft = useCallback(
    (draft: CommunicationMessage) => {
      setSendIdempotencyKey(crypto.randomUUID());
      setNowMs(Date.now());
      if (refreshEvents) {
        void refreshEvents();
      }
      setActiveDraft(draft);
      setEventPromotion(draft.eventPromotion);
      audienceRef.current = draft.audience;
      setAudience(draft.audience);
      setChannel(draft.channel);
      setContentMarkdown(draft.contentMarkdown);
      setSubject(draft.subject);
      setReviewSnapshot(null);
      setVoiceParts(draft.audience.voiceParts.join(", "));
      setRecipientsExpanded(false);
      setMessageMode("compose");
      setActiveSection("messages");
      setError(null);
      setSuccessNotice("Draft loaded. Make your edits and send when ready.");
    },
    [refreshEvents, setActiveSection, setError, setMessageMode, setSuccessNotice],
  );

  const openNewMessage = useCallback(() => {
    setSendIdempotencyKey(crypto.randomUUID());
    setNowMs(Date.now());
    if (refreshEvents) {
      void refreshEvents();
    }
    setActiveDraft(null);
    setEventPromotion(null);
    replaceAudience(defaultAudience);
    setChannel("Email");
    setContentMarkdown("");
    setSubject("");
    setVoiceParts("");
    setReachState(EMPTY_REACH_STATE);
    clearDeliveryDetails();
    setError(null);
    setSuccessNotice(null);
    setRecipientsExpanded(false);
    setMessageMode("compose");
    setActiveSection("messages");
  }, [
    clearDeliveryDetails,
    refreshEvents,
    replaceAudience,
    setActiveSection,
    setError,
    setMessageMode,
    setSuccessNotice,
  ]);

  useEffect(() => {
    if (!enabled || messageMode !== "compose") return;
    if (hasIncompleteTicketServiceAudience(audience, channel)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setReachState((prev) => ({ ...prev, loading: true, error: null }));
      previewOrganizationCommunicationReach({ audience, channel }, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setReachState({ data, error: null, loading: false });
          }
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) {
            setReachState({ data: null, error: failureMessage(err), loading: false });
          }
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [audience, channel, enabled, messageMode]);

  const upcomingPerformanceCount = useMemo(() => {
    if (!eventsLoaded || !events) return undefined;
    return filterUpcomingPerformances(events, {
      includeUnpublished: shouldIncludeUnpublishedUpcomingPerformances(audience.targetAudiences),
      nowMs,
    }).length;
  }, [audience.targetAudiences, events, eventsLoaded, nowMs]);

  const contextIssues = useMemo(
    () =>
      validateCommunicationContext({
        audience,
        channel,
        contentMarkdown,
        ...(eventPromotion ? { eventId: eventPromotion.eventId } : {}),
        subject,
        upcomingPerformanceCount,
      }),
    [audience, channel, contentMarkdown, eventPromotion, subject, upcomingPerformanceCount],
  );

  const removeConflictingPlaceholder = useCallback((tag: string) => {
    setContentMarkdown((prev) => removeCommunicationPlaceholder(prev, tag));
    setSubject((prev) => removeCommunicationPlaceholder(prev, tag));
    setReviewSnapshot(null);
  }, []);

  const deleteDraftAction = useCallback(
    async (messageId: string) => {
      const ok = await confirm({
        confirmLabel: "Delete draft",
        description: "Delete this communication draft permanently?",
        destructive: true,
        title: "Delete draft",
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        await deleteOrganizationCommunicationDraft(messageId);
        setMessages((current) => current.filter((m) => m.id !== messageId));
        setHistoryItems((current) =>
          current.filter((item) => !(item.kind === "manual" && item.message.id === messageId)),
        );
        setDraftCount?.((prev) => Math.max(0, prev - 1));
        void refreshDraftCount?.();
        void loadHistoryPage(statusFilter, originFilter, currentCursor);
        setSuccessNotice("Draft deleted.");
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
      refreshDraftCount,
      setBusy,
      setDraftCount,
      setError,
      setHistoryItems,
      setMessages,
      setSuccessNotice,
      statusFilter,
    ],
  );

  const saveDraftAction = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSuccessNotice(null);
    try {
      const saved = await saveOrganizationCommunicationDraft({
        audience,
        channel,
        contentMarkdown,
        ...(eventPromotion ? { eventPromotion } : {}),
        ...(activeDraft
          ? { expectedRevision: activeDraft.draftRevision, messageId: activeDraft.id }
          : {}),
        subject,
      });
      setActiveDraft(saved);
      setReviewSnapshot(null);
      setMessages((current) => [saved, ...current.filter((m) => m.id !== saved.id)]);
      void refreshDraftCount?.();
      void loadHistoryPage(statusFilter, originFilter, currentCursor);
      setSuccessNotice("Draft saved successfully.");
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }, [
    activeDraft,
    audience,
    channel,
    contentMarkdown,
    currentCursor,
    eventPromotion,
    loadHistoryPage,
    originFilter,
    refreshDraftCount,
    setBusy,
    setError,
    setMessages,
    setSuccessNotice,
    statusFilter,
    subject,
  ]);

  const needsPersistedReview = Boolean(eventPromotion) || (reachState.data?.total ?? 0) > 500;

  const openReviewAndSend = useCallback(async () => {
    if (contextIssues.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      let previewRequest: Parameters<typeof previewOrganizationCommunicationReach>[0] = {
        audience,
        channel,
      };
      if (needsPersistedReview) {
        if (eventPromotion && !activeDraft) {
          setError("Save the event promotion draft before reviewing it in Communications.");
          return;
        }
        const saved = await saveOrganizationCommunicationDraft({
          audience,
          channel,
          contentMarkdown,
          ...(eventPromotion ? { eventPromotion } : {}),
          ...(activeDraft
            ? { expectedRevision: activeDraft.draftRevision, messageId: activeDraft.id }
            : {}),
          subject,
        });
        setActiveDraft(saved);
        setMessages((current) => [saved, ...current.filter((message) => message.id !== saved.id)]);
        previewRequest = {
          audience,
          channel,
          contentMarkdown,
          draftRevision: saved.draftRevision,
          ...(eventPromotion ? { eventPromotion } : {}),
          messageId: saved.id,
          subject,
        };
      }
      const freshReach = await previewOrganizationCommunicationReach(previewRequest);
      setReachState({ data: freshReach, error: null, loading: false });
      if (freshReach.total === 0) {
        setError("No reachable recipients found for the selected criteria.");
        return;
      }
      if (freshReach.ticketBuyerPurchasesOverLimit > 0 || freshReach.audienceOverLimit) {
        setError(
          "This audience exceeds the 10,000-recipient limit. Narrow the audience before sending.",
        );
        return;
      }
      if (needsPersistedReview && !freshReach.reviewSnapshot) {
        setError("The recipient review could not be verified. Reopen it before sending.");
        return;
      }
      setReviewSnapshot(freshReach.reviewSnapshot ?? null);
      setIsReviewOpen(true);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }, [
    activeDraft,
    needsPersistedReview,
    audience,
    channel,
    contentMarkdown,
    contextIssues.length,
    eventPromotion,
    setBusy,
    setError,
    setMessages,
    subject,
  ]);

  const sendCommunicationAction = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const queued = await sendOrganizationCommunication(
        {
          audience,
          channel,
          contentMarkdown,
          ...(eventPromotion ? { eventPromotion } : {}),
          ...(activeDraft
            ? { expectedRevision: activeDraft.draftRevision, messageId: activeDraft.id }
            : {}),
          ...(reviewSnapshot ? { reviewSnapshot } : {}),
          subject,
        },
        sendIdempotencyKey,
      );
      setMessages((current) => [queued, ...current.filter((m) => m.id !== queued.id)]);
      if (activeDraft) {
        setDraftCount?.((prev) => Math.max(0, prev - 1));
        void refreshDraftCount?.();
      }
      setIsReviewOpen(false);
      setMessageMode("list");
      setActiveSection("messages");
      setActiveDraft(null);
      setEventPromotion(null);
      setReviewSnapshot(null);
      void loadHistoryPage(statusFilter, originFilter, null);
      setSuccessNotice(`Message queued for ${String(queued.reach.total)} recipients.`);
      replaceAudience(defaultAudience);
      setContentMarkdown("");
      setSubject("");
      setVoiceParts("");
      setSendIdempotencyKey(crypto.randomUUID());
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }, [
    activeDraft,
    audience,
    channel,
    contentMarkdown,
    eventPromotion,
    loadHistoryPage,
    originFilter,
    refreshDraftCount,
    replaceAudience,
    reviewSnapshot,
    sendIdempotencyKey,
    setActiveSection,
    setBusy,
    setDraftCount,
    setError,
    setMessageMode,
    setMessages,
    setSuccessNotice,
    statusFilter,
    subject,
  ]);

  const sendTestEmailAction = useCallback(
    async (email: string) => {
      setBusy(true);
      setError(null);
      try {
        if (eventPromotion) {
          await saveDraftAction();
        }
        await sendOrganizationCommunicationTestEmail(
          {
            audience,
            contentMarkdown,
            email,
            ...(eventPromotion ? { eventId: eventPromotion.eventId } : {}),
            subject,
          },
          crypto.randomUUID(),
        );
        setIsTestEmailOpen(false);
        setSuccessNotice(`Test email sent to ${email}.`);
      } catch (err: unknown) {
        setError(failureMessage(err));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [
      audience,
      contentMarkdown,
      eventPromotion,
      saveDraftAction,
      setBusy,
      setError,
      setSuccessNotice,
      subject,
    ],
  );

  return {
    audience,
    channel,
    contentMarkdown,
    contextIssues,
    deleteDraftAction,
    eventPromotion,
    isReviewOpen,
    isTestEmailOpen,
    nowMs,
    openNewMessage,
    openReviewAndSend,
    reachState: reachStateForAudience(reachState, audience, channel),
    recipientsExpanded,
    removeConflictingPlaceholder,
    replaceAudience,
    resumeDraft,
    saveDraftAction,
    sendCommunicationAction,
    sendTestEmailAction,
    setIsReviewOpen,
    setIsTestEmailOpen,
    setRecipientsExpanded,
    setVoiceParts,
    subject,
    updateAudience,
    updateChannel,
    updateContent,
    updateSubject,
    voiceParts,
  };
}
