import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationDeliverySummary,
  CommunicationMessage,
  CommunicationReach,
  CommunicationScheduledMessage,
  OrganizationEmailSettings,
  OrganizationEvent,
  OrganizationProviderStatusResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import {
  defaultAudience,
  defaultTestEmailContent,
  defaultTestEmailSubject,
  failureMessage,
  communicationTabFromSearch,
  audienceOptions,
} from "./utils";
import type { CommunicationStage, CommunicationTab } from "./types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelOrganizationCommunication,
  deleteOrganizationCommunicationDraft,
  getOrganizationCommunicationDeliverySummary,
  getOrganizationEmailSettings,
  getOrganizationProviderStatus,
  listOrganizationCommunications,
  getOrganizationRosterConfiguration,
  listOrganizationScheduledMessages,
  listOrganizationEvents,
  previewOrganizationCommunicationReach,
  retryOrganizationCommunicationDeliveries,
  saveOrganizationCommunicationDraft,
  sendOrganizationCommunication,
  sendOrganizationCommunicationTestEmail,
} from "../../../auth/api";

export function useCommunicationCenterController({ enabled }: { readonly enabled: boolean }) {
  const draftId = new URLSearchParams(window.location.search).get("draftId");
  const requestedTab = communicationTabFromSearch(window.location.search);
  const [audience, setAudience] = useState<CommunicationAudienceRequest>(defaultAudience);
  const audienceRef = useRef<CommunicationAudienceRequest>(defaultAudience);
  const audienceFieldsetRef = useRef<HTMLFieldSetElement | null>(null);
  const [channel, setChannel] = useState<CommunicationChannel>("Email");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [subject, setSubject] = useState("");
  const [voiceParts, setVoiceParts] = useState("");
  const [messages, setMessages] = useState<readonly CommunicationMessage[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<
    readonly CommunicationScheduledMessage[]
  >([]);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [providerStatus, setProviderStatus] = useState<OrganizationProviderStatusResponse | null>(
    null,
  );
  const [emailSettings, setEmailSettings] = useState<OrganizationEmailSettings | null>(null);
  const [rosterConfiguration, setRosterConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);
  const [summary, setSummary] = useState<CommunicationDeliverySummary | null>(null);
  const [loadingDeliveryId, setLoadingDeliveryId] = useState<string | null>(null);
  const [reach, setReach] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [activeTab, setActiveTab] = useState<CommunicationTab>(
    draftId ? "compose" : (requestedTab ?? "compose"),
  );
  const [stage, setStage] = useState<CommunicationStage>("audience");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [queuedResult, setQueuedResult] = useState<CommunicationMessage | null>(null);
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState(() => crypto.randomUUID());
  const [testEmailIdempotencyKey, setTestEmailIdempotencyKey] = useState(() => crypto.randomUUID());
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
    setStage("compose");
    setActiveTab("compose");
    setQueuedResult(null);
    setSuccess("Draft loaded. Review the message and queue it when it is ready.");
  }, []);

  function startNewMessage() {
    setSendIdempotencyKey(crypto.randomUUID());
    replaceAudience(defaultAudience);
    setChannel("Email");
    setContentMarkdown("");
    setSubject("");
    setVoiceParts("");
    setReach(null);
    setSummary(null);
    setLoadingDeliveryId(null);
    setError(null);
    setSuccess(null);
    setQueuedResult(null);
    setPreviewOpen(false);
    setStage("audience");
    setActiveTab("compose");
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationCommunications(controller.signal),
      listOrganizationScheduledMessages(controller.signal),
      listOrganizationEvents(controller.signal),
    ])
      .then(([loadedMessages, loadedScheduledMessages, loadedEvents]) => {
        setMessages(loadedMessages);
        setScheduledMessages(loadedScheduledMessages);
        setEvents(loadedEvents);
        const draft = draftId
          ? loadedMessages.find((message) => message.id === draftId && message.status === "Draft")
          : null;
        if (draft) {
          resumeDraft(draft);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, [draftId, enabled, resumeDraft]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationRosterConfiguration(controller.signal)
      .then((configuration) => {
        if (!controller.signal.aborted) setRosterConfiguration(configuration);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationProviderStatus(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) setProviderStatus(status);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationEmailSettings(controller.signal)
      .then((settings) => {
        if (!controller.signal.aborted) setEmailSettings(settings);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  function composeRequest() {
    return {
      audience: composeAudienceRequest(),
      channel,
      contentMarkdown,
      subject,
    };
  }

  function audienceFromVisibleForm(): CommunicationAudienceRequest {
    const fieldset = audienceFieldsetRef.current;
    if (!fieldset) return audienceRef.current;
    const checkedTargets = new Set(
      Array.from(fieldset.querySelectorAll<HTMLInputElement>("[data-communication-audience]"))
        .filter((input) => input.checked)
        .map((input) => input.dataset.communicationAudience),
    );
    const targetAudiences = audienceOptions.filter((target) => checkedTargets.has(target));
    if (targetAudiences.length === 0) return audienceRef.current;
    const currentTargets = audienceRef.current.targetAudiences;
    const targetsChanged =
      currentTargets.length !== targetAudiences.length ||
      currentTargets.some((target, index) => target !== targetAudiences[index]);
    if (!targetsChanged) return audienceRef.current;
    const nextAudience = { ...audienceRef.current, targetAudiences };
    replaceAudience(nextAudience);
    return nextAudience;
  }

  function composeAudienceRequest(): CommunicationAudienceRequest {
    const currentAudience = audienceFromVisibleForm();
    return {
      ...currentAudience,
      voiceParts: voiceParts
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    };
  }

  function formatReach(result: CommunicationReach): string {
    return `${String(result.total)} reachable · ${String(result.email)} by email · ${String(result.sms)} by SMS · ${String(result.unreachable)} unreachable`;
  }

  async function previewReach() {
    setBusy(true);
    setError(null);
    setReach(null);
    try {
      const result = await previewOrganizationCommunicationReach({
        audience: composeAudienceRequest(),
        channel,
      });
      setReach(formatReach(result));
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function openFinalPreview() {
    setBusy(true);
    setError(null);
    try {
      const result = await previewOrganizationCommunicationReach({
        audience: composeAudienceRequest(),
        channel,
      });
      setReach(formatReach(result));
      setPreviewOpen(true);
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const recipient = testEmail.trim();
    const testSubject = subject.trim() || defaultTestEmailSubject;
    const testContent = contentMarkdown.trim() || defaultTestEmailContent;
    try {
      await sendOrganizationCommunicationTestEmail(
        {
          contentMarkdown: testContent,
          email: recipient,
          subject: testSubject,
        },
        testEmailIdempotencyKey,
      );
      setTestEmailIdempotencyKey(crypto.randomUUID());
      setSuccess(`Test email accepted for delivery to ${recipient}.`);
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const message = await saveOrganizationCommunicationDraft(composeRequest());
      setMessages((current) => [message, ...current]);
      setSuccess("Draft saved.");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const message = await sendOrganizationCommunication(composeRequest(), sendIdempotencyKey);
      setMessages((current) => [message, ...current]);
      setQueuedResult(message);
      setContentMarkdown("");
      setSubject("");
      setReach(null);
      setPreviewOpen(false);
      setSendIdempotencyKey(crypto.randomUUID());
      setSuccess(null);
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function showDelivery(message: CommunicationMessage) {
    setBusy(true);
    setError(null);
    setSummary(null);
    setLoadingDeliveryId(message.id);
    try {
      setSummary(await getOrganizationCommunicationDeliverySummary(message.id));
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setLoadingDeliveryId(null);
      setBusy(false);
    }
  }

  async function retryFailed() {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const retried = await retryOrganizationCommunicationDeliveries(summary.messageId);
      setSummary(null);
      setSuccess(
        `${String(retried)} failed ${retried === 1 ? "delivery" : "deliveries"} queued again.`,
      );
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft(message: CommunicationMessage) {
    const shouldDelete = await confirm({
      confirmLabel: "Delete draft",
      description: "This will permanently remove the saved communication draft.",
      destructive: true,
      title: "Delete communication draft?",
    });
    if (!shouldDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationCommunicationDraft(message.id);
      setMessages((current) => current.filter(({ id }) => id !== message.id));
      setSuccess("Draft deleted.");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function cancelQueuedMessage(message: CommunicationMessage) {
    const shouldCancel = await confirm({
      confirmLabel: "Cancel message",
      description: "No more deliveries will be attempted for this queued message.",
      destructive: true,
      title: "Cancel queued message?",
    });
    if (!shouldCancel) return;
    setBusy(true);
    setError(null);
    try {
      const canceled = await cancelOrganizationCommunication(message.id);
      setMessages((current) =>
        current.map((candidate) => (candidate.id === message.id ? canceled : candidate)),
      );
      setSummary((current) => (current?.messageId === message.id ? null : current));
      setSuccess("Queued message canceled.");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function editQueuedMessage(message: CommunicationMessage) {
    const shouldEdit = await confirm({
      confirmLabel: "Edit & requeue",
      description:
        "Editing cancels the queued copy and opens its contents for changes. Queue it again when it is ready.",
      title: "Edit queued message?",
    });
    if (!shouldEdit) return;
    setBusy(true);
    setError(null);
    try {
      const canceled = await cancelOrganizationCommunication(message.id);
      setMessages((current) =>
        current.map((candidate) => (candidate.id === message.id ? canceled : candidate)),
      );
      audienceRef.current = canceled.audience;
      setAudience(canceled.audience);
      setChannel(canceled.channel);
      setContentMarkdown(canceled.contentMarkdown);
      setSubject(canceled.subject);
      setVoiceParts(canceled.audience.voiceParts.join(", "));
      setReach(null);
      setSummary(null);
      setQueuedResult(null);
      setSendIdempotencyKey(crypto.randomUUID());
      setPreviewOpen(false);
      setStage("compose");
      setActiveTab("compose");
      setSuccess(
        "Queued message canceled. Review it, make changes, and queue it again when ready.",
      );
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function toggleStatus(status: "Active" | "Idle" | "Inactive", checked: boolean) {
    updateAudience((current) => ({
      ...current,
      globalStatuses: checked
        ? [...new Set([...current.globalStatuses, status])]
        : current.globalStatuses.filter((candidate) => candidate !== status),
    }));
  }

  function toggleAudience(target: (typeof audienceOptions)[number], checked: boolean) {
    updateAudience((current) => ({
      ...current,
      targetAudiences: checked
        ? current.targetAudiences.includes(target)
          ? current.targetAudiences
          : [...current.targetAudiences, target]
        : current.targetAudiences.filter((candidate) => candidate !== target),
    }));
    setReach(null);
  }

  function scheduledKindLabel(kind: CommunicationScheduledMessage["kind"]): string {
    switch (kind) {
      case "attendance_report":
        return "Attendance report";
      case "event_reminder":
        return "Event reminder";
      case "rsvp_follow_up":
        return "RSVP follow-up";
      case "audition_confirmation":
        return "Audition confirmation";
      case "audition_reminder":
        return "Audition reminder";
      case "ticket_confirmation":
        return "Ticket confirmation";
      case "ticket_reminder":
        return "Ticket buyer reminder";
    }
  }

  const draftMessages = messages.filter((message) => message.status === "Draft");
  const historyMessages = messages.filter((message) => message.status !== "Draft");
  const upcomingScheduledMessages = scheduledMessages.filter(
    (message) => message.status === "Queued" || message.status === "Scheduled",
  );
  const scheduledMessageHistory = scheduledMessages.filter(
    (message) => message.status === "Sent" || message.status === "Failed",
  );
  return {
    activeTab,
    audience,
    audienceFieldsetRef,
    busy,
    channel,
    cancelQueuedMessage,
    contentMarkdown,
    confirmationDialog,
    deleteDraft,
    draftMessages,
    editQueuedMessage,
    emailSettings,
    enabled,
    error,
    events,
    historyMessages,
    loadingDeliveryId,
    messages,
    openFinalPreview,
    previewOpen,
    previewReach,
    providerStatus,
    queuedResult,
    reach,
    resumeDraft,
    retryFailed,
    rosterConfiguration,
    saveDraft,
    scheduledKindLabel,
    scheduledMessageHistory,
    send,
    sendTestEmail,
    setActiveTab,
    updateAudience,
    setChannel,
    setContentMarkdown,
    setPreviewOpen,
    setReach,
    setStage,
    setSubject,
    setTestEmail,
    setVoiceParts,
    showDelivery,
    stage,
    startNewMessage,
    subject,
    success,
    summary,
    testEmail,
    toggleAudience,
    toggleStatus,
    upcomingScheduledMessages,
    voiceParts,
  };
}

export type CommunicationCenterModel = ReturnType<typeof useCommunicationCenterController>;
