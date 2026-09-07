import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationDeliverySummary,
  CommunicationMessage,
  CommunicationScheduledMessage,
  CommunicationTemplate,
  ContactList,
  OrganizationEmailSettings,
  OrganizationEvent,
  OrganizationProviderStatusResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { removeCommunicationPlaceholder, validateCommunicationContext } from "@choir/domain";
import { useConfirmation } from "@choir/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelOrganizationCommunication,
  deleteOrganizationCommunicationDraft,
  deleteOrganizationCommunicationTemplate,
  getOrganizationCommunicationDeliverySummary,
  getOrganizationEmailSettings,
  getOrganizationProviderStatus,
  getOrganizationRosterConfiguration,
  listOrganizationCommunicationTemplates,
  listOrganizationCommunications,
  listOrganizationEvents,
  listOrganizationScheduledMessages,
  previewOrganizationCommunicationReach,
  retryOrganizationCommunicationDeliveries,
  saveOrganizationCommunicationDraft,
  saveOrganizationCommunicationTemplate,
  sendOrganizationCommunication,
  sendOrganizationCommunicationTestEmail,
} from "../../../auth/api";
import { listOrganizationContactLists } from "../../../api";
import type {
  CommunicationCenterControllerModel,
  CommunicationReachState,
  CommunicationSection,
  MessageFilter,
  MessageWorkspaceMode,
  UnifiedCommunicationItem,
} from "./types";
import {
  audienceOptions,
  defaultAudience,
  failureMessage,
  parseCommunicationSearch,
  unifiedItemSortTimestamp,
} from "./utils";

export type { CommunicationCenterControllerModel } from "./types";

export function useCommunicationCenterController({
  enabled,
}: {
  readonly enabled: boolean;
}): CommunicationCenterControllerModel {
  const initialNav = useMemo(
    () => parseCommunicationSearch(typeof window !== "undefined" ? window.location.search : ""),
    [],
  );

  const [activeSection, setActiveSection] = useState<CommunicationSection>(initialNav.section);
  const [messageMode, setMessageMode] = useState<MessageWorkspaceMode>(initialNav.messageMode);
  const [messageFilter, setMessageFilter] = useState<MessageFilter>(initialNav.messageFilter);

  const [audience, setAudience] = useState<CommunicationAudienceRequest>(defaultAudience);
  const audienceRef = useRef<CommunicationAudienceRequest>(defaultAudience);
  const [recipientsExpanded, setRecipientsExpanded] = useState(true);

  const [channel, setChannel] = useState<CommunicationChannel>("Email");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [subject, setSubject] = useState("");
  const [voiceParts, setVoiceParts] = useState("");

  const [messages, setMessages] = useState<readonly CommunicationMessage[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<
    readonly CommunicationScheduledMessage[]
  >([]);
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [contactLists, setContactLists] = useState<readonly ContactList[]>([]);
  const [providerStatus, setProviderStatus] = useState<OrganizationProviderStatusResponse | null>(
    null,
  );
  const [emailSettings, setEmailSettings] = useState<OrganizationEmailSettings | null>(null);
  const [rosterConfiguration, setRosterConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);

  const [reachState, setReachState] = useState<CommunicationReachState>({
    data: null,
    error: null,
    loading: false,
  });

  const [deliverySummary, setDeliverySummary] = useState<CommunicationDeliverySummary | null>(null);
  const [deliveryDetailsMessage, setDeliveryDetailsMessage] = useState<CommunicationMessage | null>(
    null,
  );
  const [loadingDeliveryId, setLoadingDeliveryId] = useState<string | null>(null);

  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isTestEmailOpen, setIsTestEmailOpen] = useState(false);
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const [sendIdempotencyKey, setSendIdempotencyKey] = useState(() => crypto.randomUUID());
  const { confirm, confirmationDialog } = useConfirmation();

  function replaceAudience(nextAudience: CommunicationAudienceRequest) {
    audienceRef.current = nextAudience;
    setAudience(nextAudience);
  }

  function updateAudience(
    updater: (current: CommunicationAudienceRequest) => CommunicationAudienceRequest,
  ) {
    replaceAudience(updater(audienceRef.current));
  }

  const resumeDraft = useCallback((draft: CommunicationMessage) => {
    setSendIdempotencyKey(crypto.randomUUID());
    audienceRef.current = draft.audience;
    setAudience(draft.audience);
    setChannel(draft.channel);
    setContentMarkdown(draft.contentMarkdown);
    setSubject(draft.subject);
    setVoiceParts(draft.audience.voiceParts.join(", "));
    setRecipientsExpanded(false);
    setMessageMode("compose");
    setActiveSection("messages");
    setError(null);
    setSuccessNotice("Draft loaded. Make your edits and send when ready.");
  }, []);

  function openNewMessage() {
    setSendIdempotencyKey(crypto.randomUUID());
    replaceAudience(defaultAudience);
    setChannel("Email");
    setContentMarkdown("");
    setSubject("");
    setVoiceParts("");
    setReachState({ data: null, error: null, loading: false });
    setDeliverySummary(null);
    setDeliveryDetailsMessage(null);
    setLoadingDeliveryId(null);
    setError(null);
    setSuccessNotice(null);
    setRecipientsExpanded(true);
    setMessageMode("compose");
    setActiveSection("messages");
  }

  // Load initial data
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationCommunications(controller.signal),
      listOrganizationScheduledMessages(controller.signal),
      listOrganizationEvents(controller.signal),
      listOrganizationCommunicationTemplates(controller.signal),
      getOrganizationProviderStatus(controller.signal),
      getOrganizationEmailSettings(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationContactLists(controller.signal).catch(() => []),
    ])
      .then(
        ([
          loadedMessages,
          loadedScheduled,
          loadedEvents,
          loadedTemplates,
          loadedStatus,
          loadedEmailSettings,
          loadedRosterConfig,
          loadedContactLists,
        ]) => {
          setMessages(loadedMessages);
          setScheduledMessages(loadedScheduled);
          setEvents(loadedEvents);
          setTemplates(loadedTemplates);
          setProviderStatus(loadedStatus);
          setEmailSettings(loadedEmailSettings);
          setRosterConfiguration(loadedRosterConfig);
          setContactLists(loadedContactLists);

          if (initialNav.draftId) {
            const draft = loadedMessages.find(
              (m) => m.id === initialNav.draftId && m.status === "Draft",
            );
            if (draft) {
              resumeDraft(draft);
            }
          }
        },
      )
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(err));
      });
    return () => {
      controller.abort();
    };
  }, [enabled, initialNav.draftId, resumeDraft]);

  // Automatic debounced reach preview when audience or channel changes in compose mode
  useEffect(() => {
    if (!enabled || messageMode !== "compose") return;

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

  // Context issues computed in real-time
  const contextIssues = useMemo(
    () => validateCommunicationContext({ audience, channel, contentMarkdown, subject }),
    [audience, channel, contentMarkdown, subject],
  );

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === audience.eventId) ?? null,
    [events, audience.eventId],
  );

  function removeConflictingPlaceholder(tag: string) {
    setContentMarkdown((prev) => removeCommunicationPlaceholder(prev, tag));
    setSubject((prev) => removeCommunicationPlaceholder(prev, tag));
  }

  // Unified messages list
  const unifiedMessages: readonly UnifiedCommunicationItem[] = useMemo(() => {
    const manualItems: UnifiedCommunicationItem[] = messages.map((message) => ({
      automated: false,
      channel: message.channel,
      id: message.id,
      kind: "manual",
      message,
      recipientCount: message.reach.total,
      status: message.status,
      timestamp: message.sentAt ?? message.createdAt,
      title: message.subject.length > 0 ? message.subject : `${message.channel} message`,
    }));

    const scheduledItems: UnifiedCommunicationItem[] = scheduledMessages.map((scheduled) => ({
      automated: true,
      channel: "Email",
      id: scheduled.id,
      kind: "scheduled",
      recipientCount: null,
      scheduledMessage: scheduled,
      status: scheduled.status,
      timestamp: scheduled.scheduledAt,
      title: scheduled.subject || scheduled.eventTitle || "Automated send",
    }));

    const all = [...manualItems, ...scheduledItems].sort(
      (a, b) => unifiedItemSortTimestamp(b) - unifiedItemSortTimestamp(a),
    );

    switch (messageFilter) {
      case "drafts":
        return all.filter((item) => item.status === "Draft");
      case "scheduled":
        return all.filter((item) => item.status === "Scheduled");
      case "queued":
        return all.filter((item) => item.status === "Queued");
      case "sent":
        return all.filter((item) => item.status === "Sent");
      case "failed":
        return all.filter((item) => item.status === "Failed");
      case "automated":
        return all.filter((item) => item.automated);
      case "all":
      default:
        return all;
    }
  }, [messages, scheduledMessages, messageFilter]);

  // Actions
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
        setSuccessNotice("Draft deleted.");
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [confirm],
  );

  const cancelQueuedAction = useCallback(
    async (messageId: string) => {
      const ok = await confirm({
        confirmLabel: "Cancel communication",
        description: "Cancel this queued communication? Pending recipients will not be delivered.",
        destructive: true,
        title: "Cancel queued communication",
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        const canceled = await cancelOrganizationCommunication(messageId);
        setMessages((current) =>
          current.map((m) => (m.id === messageId ? { ...m, ...canceled } : m)),
        );
        setSuccessNotice("Queued communication canceled.");
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [confirm],
  );

  const openDeliveryDetails = useCallback(async (message: CommunicationMessage) => {
    setLoadingDeliveryId(message.id);
    setError(null);
    try {
      const summary = await getOrganizationCommunicationDeliverySummary(message.id);
      setDeliverySummary(summary);
      setDeliveryDetailsMessage(message);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setLoadingDeliveryId(null);
    }
  }, []);

  const retryDeliveriesAction = useCallback(async (messageId: string) => {
    setBusy(true);
    setError(null);
    try {
      const retried = await retryOrganizationCommunicationDeliveries(messageId);
      const summary = await getOrganizationCommunicationDeliverySummary(messageId);
      setDeliverySummary(summary);
      setMessages(await listOrganizationCommunications());
      setSuccessNotice(`Retried delivery for ${String(retried)} recipients.`);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const saveDraftAction = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSuccessNotice(null);
    try {
      const saved = await saveOrganizationCommunicationDraft({
        audience,
        channel,
        contentMarkdown,
        subject,
      });
      setMessages((current) => [saved, ...current.filter((m) => m.id !== saved.id)]);
      setSuccessNotice("Draft saved successfully.");
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }, [audience, channel, contentMarkdown, subject]);

  const saveTemplateAction = useCallback(
    async (title: string) => {
      setBusy(true);
      setError(null);
      try {
        const saved = await saveOrganizationCommunicationTemplate({
          channel,
          contentMarkdown,
          subject,
          title,
        });
        setTemplates((current) => [saved, ...current.filter((t) => t.id !== saved.id)]);
        setIsSaveTemplateOpen(false);
        setSuccessNotice(`Template "${title}" saved.`);
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [channel, contentMarkdown, subject],
  );

  const deleteTemplateAction = useCallback(
    async (templateId: string) => {
      const ok = await confirm({
        confirmLabel: "Delete template",
        description: "Delete this communication template permanently?",
        destructive: true,
        title: "Delete template",
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        await deleteOrganizationCommunicationTemplate(templateId);
        setTemplates((current) => current.filter((t) => t.id !== templateId));
        setSuccessNotice("Template deleted.");
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [confirm],
  );

  const openReviewAndSend = useCallback(async () => {
    if (contextIssues.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const freshReach = await previewOrganizationCommunicationReach({ audience, channel });
      setReachState({ data: freshReach, error: null, loading: false });
      if (freshReach.total === 0) {
        setError("No reachable recipients found for the selected criteria.");
        return;
      }
      setIsReviewOpen(true);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }, [audience, channel, contextIssues.length]);

  const sendCommunicationAction = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const queued = await sendOrganizationCommunication(
        { audience, channel, contentMarkdown, subject },
        sendIdempotencyKey,
      );
      setMessages((current) => [queued, ...current.filter((m) => m.id !== queued.id)]);
      setIsReviewOpen(false);
      setMessageMode("list");
      setActiveSection("messages");
      setSuccessNotice(`Message queued for ${String(queued.reach.total)} recipients.`);
      // Reset composer
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
  }, [audience, channel, contentMarkdown, sendIdempotencyKey, subject]);

  const sendTestEmailAction = useCallback(
    async (email: string) => {
      setBusy(true);
      setError(null);
      try {
        await sendOrganizationCommunicationTestEmail(
          { audience, contentMarkdown, email, subject },
          crypto.randomUUID(),
        );
        setIsTestEmailOpen(false);
        setSuccessNotice(`Test email sent to ${email}.`);
      } catch (err: unknown) {
        setError(failureMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [audience, contentMarkdown, subject],
  );

  function formatVoiceParts(parts: readonly string[]): string {
    if (!rosterConfiguration) return parts.join(", ");
    return parts
      .map((code) => {
        const sec = rosterConfiguration.sections.find((s) => s.code === code);
        return sec?.name ?? code;
      })
      .join(", ");
  }

  return {
    activeSection,
    audience,
    audienceOptions,
    busy,
    cancelQueuedMessage: cancelQueuedAction,
    channel,
    confirmationDialog,
    contactLists,
    contentMarkdown,
    contextIssues,
    deleteDraft: deleteDraftAction,
    deleteTemplate: deleteTemplateAction,
    deliveryDetailsMessage,
    deliverySummary,
    emailSettings,
    error,
    events,
    formatVoiceParts,
    isReviewOpen,
    isSaveTemplateOpen,
    isTestEmailOpen,
    loadingDeliveryId,
    messageFilter,
    messageMode,
    openDeliveryDetails,
    openNewMessage,
    openNewTemplateDialog: () => {
      // Standalone new template dialog in templates panel
    },
    openReviewAndSend,
    openSaveAsTemplate: () => {
      setIsSaveTemplateOpen(true);
    },
    openTestEmail: () => {
      setIsTestEmailOpen(true);
    },
    providerStatus,
    reachState,
    recipientsExpanded,
    removeConflictingPlaceholder,
    resumeDraft,
    retryDeliveries: retryDeliveriesAction,
    rosterConfiguration,
    saveDraft: saveDraftAction,
    saveTemplate: saveTemplateAction,
    selectedEvent,
    sendCommunication: sendCommunicationAction,
    sendTestEmail: sendTestEmailAction,
    setActiveSection,
    setChannel,
    setContentMarkdown,
    setIsReviewOpen,
    setIsSaveTemplateOpen,
    setIsTestEmailOpen,
    setMessageFilter,
    setMessageMode,
    setRecipientsExpanded,
    setSubject,
    setVoiceParts,
    subject,
    successNotice,
    templates,
    unifiedMessages,
    updateAudience,
    voiceParts,
  };
}
