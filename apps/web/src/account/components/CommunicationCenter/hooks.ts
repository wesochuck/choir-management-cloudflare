import { requestGlobalLeave, useOptionalSaveCoordinator } from "../../../persistence";
import { useCommunicationOverview } from "./useCommunicationOverview";
import type {
  ContactList,
  OrganizationBranding,
  OrganizationEmailSettings,
  OrganizationEvent,
  OrganizationProviderStatusResponse,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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
import { listOrganizationContactLists, listOrganizationVenues } from "../../../api";
import type {
  CommunicationCenterControllerModel,
  CommunicationSection,
  MessageStatusFilter,
  MessageOriginFilter,
  MessageWorkspaceMode,
} from "./types";
import { useCommunicationComposer } from "./useCommunicationComposer";
import { useCommunicationHistory } from "./useCommunicationHistory";
import { useCommunicationTemplates } from "./useCommunicationTemplates";
import { audienceOptions, failureMessage, parseCommunicationSearch } from "./utils";

export type { CommunicationCenterControllerModel } from "./types";

export function useCommunicationCenterController({
  enabled,
  search,
  navigate,
}: {
  readonly enabled: boolean;
  readonly search?: string | undefined;
  readonly navigate?: ((href: string) => void) | undefined;
}): CommunicationCenterControllerModel {
  const saveCoordinator = useOptionalSaveCoordinator();
  const [localSearch, setLocalSearch] = useState(() =>
    typeof window !== "undefined" ? window.location.search : "",
  );
  const locationSearch = search ?? localSearch;
  const [initialNav] = useState(() => parseCommunicationSearch(locationSearch));

  const [activeSection, setActiveSection] = useState<CommunicationSection>(initialNav.section);
  const [messageMode, setMessageMode] = useState<MessageWorkspaceMode>(initialNav.messageMode);

  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [resourceAttempt, setResourceAttempt] = useState(0);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [venues, setVenues] = useState<readonly OrganizationVenue[]>([]);

  const refreshEvents = useCallback(async (signal?: AbortSignal) => {
    try {
      const [loadedEvents, loadedVenues] = await Promise.all([
        listOrganizationEvents(signal),
        listOrganizationVenues(signal).catch(() => []),
      ]);
      if (!signal?.aborted) {
        setEvents(loadedEvents);
        setEventsLoaded(true);
        setVenues(loadedVenues);
      }
    } catch {
      // Keep previous events if refresh fails
    }
  }, []);
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
    enabled: enabled && activeSection === "messages",
    initialSearchQuery: initialNav.searchQuery,
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
    events,
    eventsLoaded,
    initialNav,
    loadHistoryPage: history.loadHistoryPage,
    messageMode,
    originFilter: history.originFilter,
    refreshDraftCount: history.refreshDraftCount,
    refreshEvents,
    setActiveSection,
    setBusy,
    setDraftCount: history.setDraftCount,
    setError,
    setHistoryItems: history.setHistoryItems,
    setMessageMode,
    setMessages: history.setMessages,
    setSuccessNotice,
    statusFilter: history.statusFilter,
  });

  const overview = useCommunicationOverview(
    enabled && (activeSection === "overview" || activeSection === "automations"),
    successNotice,
  );
  const navigateCommunication = useCallback(
    (href: string) => {
      if (navigate) {
        navigate(href);
        return;
      }
      void requestGlobalLeave({
        reason: "navigate",
        action: () => {
          const next = new URL(href, window.location.origin);
          window.history.pushState(null, "", next.pathname + next.search);
          setLocalSearch(next.search);
        },
      });
    },
    [navigate],
  );
  const changeMessageFilters = (
    status: MessageStatusFilter,
    origin: MessageOriginFilter,
    query: string,
  ) => {
    const search = query.trim();
    history.applyFilters(status, origin, search);
    const params = new URLSearchParams({ tab: "messages", status, type: origin });
    if (search) params.set("q", search);
    navigateCommunication(`/admin/communications?${params.toString()}`);
  };
  const previousLocation = useRef(locationSearch);
  const applyLocation = useEffectEvent((value: string) => {
    const next = parseCommunicationSearch(value);
    setActiveSection(next.section);
    if (next.messageMode === "compose" && !next.draftId) {
      if (messageMode !== "compose" || composer.activeDraftId !== null) composer.openNewMessage();
    } else setMessageMode(next.messageMode);
    const filtersChanged = [
      activeSection !== "messages",
      history.statusFilter !== next.statusFilter,
      history.originFilter !== next.originFilter,
      history.searchQuery !== next.searchQuery,
    ].some(Boolean);
    if (next.section === "messages" && next.messageMode === "list" && filtersChanged)
      history.applyFilters(next.statusFilter, next.originFilter, next.searchQuery);
    if (next.draftId && next.draftId !== composer.activeDraftId) {
      const loaded = overview.data?.drafts.find((item) => item.id === next.draftId)?.message;
      if (loaded) composer.resumeDraft(loaded);
      else
        void listOrganizationCommunications()
          .then((messages) => {
            const draft = messages.find(
              (message) => message.id === next.draftId && message.status === "Draft",
            );
            if (draft) composer.resumeDraft(draft);
            else setError("This draft could not be found.");
          })
          .catch((err: unknown) => {
            setError(failureMessage(err));
          });
    }
  });
  useEffect(() => {
    if (previousLocation.current === locationSearch) return;
    previousLocation.current = locationSearch;
    applyLocation(locationSearch);
  }, [locationSearch]);
  useEffect(() => {
    if (navigate) return;
    const pop = () => {
      setLocalSearch(window.location.search);
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
    };
  }, [navigate]);
  const synchronizeComposer = useEffectEvent(() => {
    const params = new URLSearchParams(locationSearch);
    if (activeSection !== "messages") return;
    if (messageMode === "list" && (params.get("tab") === "compose" || params.has("draftId")))
      navigateCommunication("/admin/communications?tab=messages");
    else if (
      messageMode === "compose" &&
      composer.activeDraftId &&
      params.get("draftId") !== composer.activeDraftId
    )
      navigateCommunication(`/admin/communications?draftId=${composer.activeDraftId}`);
  });
  useEffect(() => {
    if (saveCoordinator?.isDirty) return;
    // Let the shared save coordinator publish the newly clean draft before navigating
    // after a successful save or send. Otherwise its previous render can prompt again.
    const timer = window.setTimeout(() => {
      synchronizeComposer();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [messageMode, composer.activeDraftId, saveCoordinator?.isDirty]);

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
      if (!controller.signal.aborted && initialNav.section === "messages") {
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
      listOrganizationVenues(controller.signal).catch(() => []),
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
          loadedVenues,
        ]) => {
          setTimezone(loadedCalendarSettings.timezone);
          setBranding(loadedBranding);
          setEvents(loadedEvents);
          setEventsLoaded(true);
          setTemplates(loadedTemplates);
          setProviderStatus(loadedStatus);
          setEmailSettings(loadedEmailSettings);
          setRosterConfiguration(loadedRosterConfig);
          setContactLists(loadedContactLists);
          setVenues(loadedVenues);
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
    initialNav.section,
    initialNav.originFilter,
    initialNav.statusFilter,
    resourceAttempt,
    loadHistoryPage,
    resumeDraft,
    setTemplates,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshEvents(controller.signal);
      }
    };
    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      controller.abort();
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, refreshEvents]);

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
    overview,
    navigateCommunication,
    clearDeliveryDetails: history.clearDeliveryDetails,
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
    draftCount: history.draftCount,
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
    nowMs: composer.nowMs,
    openDeliveryDetails: history.openDeliveryDetails,
    openNewMessage: () => {
      void requestGlobalLeave({
        reason: "navigate",
        action: () => {
          composer.openNewMessage();
          navigateCommunication("/admin/communications?tab=compose");
        },
      });
    },
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
    resumeDraft: (draft) => {
      void requestGlobalLeave({
        reason: "navigate",
        action: () => {
          composer.resumeDraft(draft);
          navigateCommunication(`/admin/communications?draftId=${draft.id}`);
        },
      });
    },
    retryDeliveries: history.retryDeliveriesAction,
    rosterConfiguration,
    saveDraft: composer.saveDraftAction,
    saveTemplate: templates.saveTemplateAction,
    selectedEvent,
    sendCommunication: composer.sendCommunicationAction,
    sendTestEmail: composer.sendTestEmailAction,
    setActiveSection: (section) => {
      navigateCommunication(`/admin/communications?tab=${section}`);
    },
    setChannel: composer.updateChannel,
    setContentMarkdown: composer.updateContent,
    setIsReviewOpen: composer.setIsReviewOpen,
    setIsSaveTemplateOpen: templates.setSaveTemplateOpen,
    setIsTestEmailOpen: composer.setIsTestEmailOpen,
    setMessageMode: (mode) => {
      navigateCommunication(
        `/admin/communications?tab=${mode === "compose" ? "compose" : "messages"}`,
      );
    },
    setOriginFilter: (origin) => {
      changeMessageFilters(history.statusFilter, origin, history.searchQuery);
    },
    setRecipientsExpanded: composer.setRecipientsExpanded,
    setStatusFilter: (status) => {
      changeMessageFilters(status, history.originFilter, history.searchQuery);
    },
    setMessageFilters: changeMessageFilters,
    searchQuery: history.searchQuery,
    historyError: history.historyError,
    retryHistory: history.retryHistory,
    statusFilter: history.statusFilter,
    setSubject: composer.updateSubject,
    setVoiceParts: composer.setVoiceParts,
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
    venues,
    voiceParts: composer.voiceParts,
  };
}
