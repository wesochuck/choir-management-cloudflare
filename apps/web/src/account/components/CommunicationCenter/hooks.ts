import type {
  ContactList,
  OrganizationBranding,
  OrganizationEmailSettings,
  OrganizationEvent,
  OrganizationProviderStatusResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import { useEffect, useMemo, useState } from "react";
import {
  getOrganizationBranding,
  getOrganizationCalendarSettings,
  getOrganizationEmailSettings,
  getOrganizationProviderStatus,
  getOrganizationRosterConfiguration,
  listOrganizationCommunicationTemplates,
  listOrganizationCommunications,
  listOrganizationEvents,
} from "../../../auth/api";
import { listOrganizationContactLists } from "../../../api";
import type {
  CommunicationCenterControllerModel,
  CommunicationSection,
  MessageWorkspaceMode,
} from "./types";
import { useCommunicationComposer } from "./useCommunicationComposer";
import { useCommunicationHistory } from "./useCommunicationHistory";
import { useCommunicationTemplates } from "./useCommunicationTemplates";
import { audienceOptions, failureMessage, parseCommunicationSearch } from "./utils";

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

  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [resourceAttempt, setResourceAttempt] = useState(0);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [contactLists, setContactLists] = useState<readonly ContactList[]>([]);
  const [providerStatus, setProviderStatus] = useState<OrganizationProviderStatusResponse | null>(
    null,
  );
  const [emailSettings, setEmailSettings] = useState<OrganizationEmailSettings | null>(null);
  const [rosterConfiguration, setRosterConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const { confirm, confirmationDialog } = useConfirmation();

  const history = useCommunicationHistory({
    confirm,
    enabled,
    initialOriginFilter: initialNav.originFilter,
    initialStatusFilter: initialNav.statusFilter,
    setBusy,
    setError,
    setSuccessNotice,
  });

  const composer = useCommunicationComposer({
    clearDeliveryDetails: history.clearDeliveryDetails,
    confirm,
    currentCursor: history.currentCursor,
    enabled,
    initialNav,
    loadHistoryPage: history.loadHistoryPage,
    messageMode,
    originFilter: history.originFilter,
    setActiveSection,
    setBusy,
    setError,
    setHistoryItems: history.setHistoryItems,
    setMessageMode,
    setMessages: history.setMessages,
    setSuccessNotice,
    statusFilter: history.statusFilter,
  });

  const templates = useCommunicationTemplates({
    channel: composer.channel,
    confirm,
    contentMarkdown: composer.contentMarkdown,
    setBusy,
    setError,
    setSuccessNotice,
    subject: composer.subject,
  });

  const { loadHistoryPage } = history;
  const { resumeDraft } = composer;
  const { setTemplates } = templates;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        void loadHistoryPage(
          initialNav.statusFilter,
          initialNav.originFilter,
          null,
          controller.signal,
        );
      }
    });

    Promise.all([
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationBranding(controller.signal).catch(() => null),
      listOrganizationEvents(controller.signal),
      listOrganizationCommunicationTemplates(controller.signal),
      getOrganizationProviderStatus(controller.signal),
      getOrganizationEmailSettings(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationContactLists(controller.signal).catch(() => []),
    ])
      .then(
        ([
          loadedCalendarSettings,
          loadedBranding,
          loadedEvents,
          loadedTemplates,
          loadedStatus,
          loadedEmailSettings,
          loadedRosterConfig,
          loadedContactLists,
        ]) => {
          setTimezone(loadedCalendarSettings.timezone);
          setBranding(loadedBranding);
          setEvents(loadedEvents);
          setTemplates(loadedTemplates);
          setProviderStatus(loadedStatus);
          setEmailSettings(loadedEmailSettings);
          setRosterConfiguration(loadedRosterConfig);
          setContactLists(loadedContactLists);
        },
      )
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(err));
      });

    if (initialNav.draftId) {
      listOrganizationCommunications(controller.signal)
        .then((loadedMessages) => {
          const draft = loadedMessages.find(
            (m) => m.id === initialNav.draftId && m.status === "Draft",
          );
          if (draft) {
            resumeDraft(draft);
          }
        })
        .catch(() => undefined);
    }

    return () => {
      controller.abort();
    };
  }, [
    enabled,
    initialNav.draftId,
    initialNav.originFilter,
    initialNav.statusFilter,
    resourceAttempt,
    loadHistoryPage,
    resumeDraft,
    setTemplates,
  ]);

  const selectedEvent = useMemo(
    () =>
      events.find(
        (e) => e.id === (composer.eventPromotion?.eventId ?? composer.audience.eventId),
      ) ?? null,
    [composer.audience.eventId, composer.eventPromotion?.eventId, events],
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
    audience: composer.audience,
    audienceOptions,
    branding,
    busy,
    cancelQueuedMessage: history.cancelQueuedAction,
    channel: composer.channel,
    confirmationDialog,
    contactLists,
    contentMarkdown: composer.contentMarkdown,
    contextIssues: composer.contextIssues,
    deleteDraft: composer.deleteDraftAction,
    deleteTemplate: templates.deleteTemplateAction,
    deliveryDetailsMessage: history.deliveryDetailsMessage,
    deliverySummary: history.deliverySummary,
    emailSettings,
    error,
    eventPromotion: composer.eventPromotion,
    events,
    formatVoiceParts,
    hasNextPage: history.hasNextPage,
    hasPreviousPage: history.hasPreviousPage,
    isReviewOpen: composer.isReviewOpen,
    isSaveTemplateOpen: templates.saveTemplateOpen,
    isTestEmailOpen: composer.isTestEmailOpen,
    loadingDeliveryId: history.loadingDeliveryId,
    loadingHistory: history.loadingHistory,
    messageMode,
    nextPage: history.nextPage,
    openDeliveryDetails: history.openDeliveryDetails,
    openNewMessage: composer.openNewMessage,
    openNewTemplateDialog: () => {
      // Standalone new template dialog in templates panel
    },
    openReviewAndSend: composer.openReviewAndSend,
    openSaveAsTemplate: () => {
      templates.setSaveTemplateOpen(true);
    },
    openTestEmail: () => {
      composer.setIsTestEmailOpen(true);
    },
    originFilter: history.originFilter,
    pageNumber: history.pageNumber,
    previousPage: history.previousPage,
    providerStatus,
    reachState: composer.reachState,
    recipientsExpanded: composer.recipientsExpanded,
    removeConflictingPlaceholder: composer.removeConflictingPlaceholder,
    resumeDraft: composer.resumeDraft,
    retryDeliveries: history.retryDeliveriesAction,
    rosterConfiguration,
    saveDraft: composer.saveDraftAction,
    saveTemplate: templates.saveTemplateAction,
    selectedEvent,
    sendCommunication: composer.sendCommunicationAction,
    sendTestEmail: composer.sendTestEmailAction,
    setActiveSection,
    setChannel: composer.updateChannel,
    setContentMarkdown: composer.updateContent,
    setIsReviewOpen: composer.setIsReviewOpen,
    setIsSaveTemplateOpen: templates.setSaveTemplateOpen,
    setIsTestEmailOpen: composer.setIsTestEmailOpen,
    setMessageMode,
    setOriginFilter: history.changeOriginFilter,
    setRecipientsExpanded: composer.setRecipientsExpanded,
    setStatusFilter: history.changeStatusFilter,
    setSubject: composer.updateSubject,
    setVoiceParts: composer.setVoiceParts,
    statusFilter: history.statusFilter,
    subject: composer.subject,
    successNotice,
    templates: templates.templates,
    timezone,
    retryResources: () => {
      setError(null);
      setResourceAttempt((attempt) => attempt + 1);
    },
    unifiedMessages: history.unifiedMessages,
    updateAudience: composer.updateAudience,
    voiceParts: composer.voiceParts,
  };
}
