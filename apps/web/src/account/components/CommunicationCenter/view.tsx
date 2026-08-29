import { CommunicationReviewDialog } from "./CommunicationReviewDialog";
import { CommunicationTestDialog } from "./CommunicationTestDialog";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { MessageComposer } from "./MessageComposer";
import { MessagesPanel } from "./MessagesPanel";
import { TemplatesPanel } from "./TemplatesPanel";
import { CommunicationSettingsPanel } from "./CommunicationSettingsPanel";
import type { CommunicationCenterControllerModel, CommunicationSection } from "./types";

function deliveryModeLabel(environment: string, externalEffectsMode: string): string {
  if (environment === "production") return "Live";
  if (externalEffectsMode === "fake") return "Simulated";
  if (externalEffectsMode === "disabled") return "Disabled";
  return "Staging sandbox";
}

function deliveryModeDescription(environment: string, externalEffectsMode: string): string {
  if (environment === "production") {
    return "Messages are delivered live to recipients via Cloudflare Email Sending.";
  }
  if (externalEffectsMode === "fake") {
    return "Messages are recorded as sent for testing, but no external provider request is made.";
  }
  if (externalEffectsMode === "disabled") {
    return "Messages are recorded as suppressed and are not sent.";
  }
  return "Messages are delivered under staging sandbox restrictions (allowlisted QA recipients only).";
}

export function CommunicationCenterView({
  model,
}: {
  readonly model: CommunicationCenterControllerModel;
}) {
  const {
    activeSection,
    audience,
    audienceOptions,
    busy,
    cancelQueuedMessage,
    channel,
    confirmationDialog,
    contentMarkdown,
    contextIssues,
    deleteDraft,
    deliveryDetailsMessage,
    deliverySummary,
    emailSettings,
    error,
    events,
    isReviewOpen,
    isSaveTemplateOpen,
    isTestEmailOpen,
    loadingDeliveryId,
    messageFilter,
    messageMode,
    openDeliveryDetails,
    openNewMessage,
    openReviewAndSend,
    openSaveAsTemplate,
    openTestEmail,
    providerStatus,
    reachState,
    recipientsExpanded,
    removeConflictingPlaceholder,
    resumeDraft,
    retryDeliveries,
    rosterConfiguration,
    saveDraft,
    saveTemplate,
    selectedEvent,
    sendCommunication,
    sendTestEmail,
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
    subject,
    successNotice,
    templates,
    unifiedMessages,
    updateAudience,
  } = model;

  const showProviderNotice =
    providerStatus &&
    (providerStatus.environment !== "production" ||
      providerStatus.externalEffectsMode === "disabled" ||
      providerStatus.externalEffectsMode === "fake");

  const navItems: readonly { readonly id: CommunicationSection; readonly label: string }[] = [
    { id: "messages", label: "Messages" },
    { id: "templates", label: "Templates" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="communication-center">
      {/* Top Level Section Navigation (Buttons with aria-current) */}
      <nav aria-label="Communications navigation" className="communication-nav">
        {navItems.map((item) => (
          <button
            aria-current={activeSection === item.id ? "page" : undefined}
            className={`communication-nav__item ${activeSection === item.id ? "is-active" : ""}`}
            key={item.id}
            onClick={() => {
              setActiveSection(item.id);
              if (item.id === "messages" && messageMode === "compose") {
                // Return to list when clicking Messages tab
                setMessageMode("list");
              }
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Prominent Provider Warning / Delivery Mode Notice */}
      {showProviderNotice ? (
        <aside
          aria-label="Delivery mode"
          className="notice notice--info communication-provider-banner"
          role="region"
        >
          <p>
            <strong>
              Delivery mode:{" "}
              {deliveryModeLabel(providerStatus.environment, providerStatus.externalEffectsMode)}
            </strong>
          </p>
          <p>
            {deliveryModeDescription(
              providerStatus.environment,
              providerStatus.externalEffectsMode,
            )}
          </p>
        </aside>
      ) : null}

      {/* Global Errors and Success Notices */}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {successNotice ? (
        <p className="notice notice--success" role="status">
          {successNotice}
        </p>
      ) : null}

      {/* Main Section Content */}
      <main className="communication-main-content">
        {activeSection === "messages" ? (
          messageMode === "compose" ? (
            <div className="communication-compose-container">
              <div className="communication-compose-header">
                <button
                  className="text-button communication-back-button"
                  onClick={() => {
                    setMessageMode("list");
                  }}
                  type="button"
                >
                  ← Back to messages
                </button>
                <h2>New message</h2>
              </div>
              <MessageComposer
                audience={audience}
                audienceOptions={audienceOptions}
                busy={busy}
                channel={channel}
                contentMarkdown={contentMarkdown}
                contextIssues={contextIssues}
                events={events}
                onChannelChange={setChannel}
                onContentChange={setContentMarkdown}
                onOpenReview={() => void openReviewAndSend()}
                onOpenSaveTemplate={openSaveAsTemplate}
                onOpenTestEmail={openTestEmail}
                onRemoveConflictingPlaceholder={removeConflictingPlaceholder}
                onSaveDraft={() => void saveDraft()}
                onSubjectChange={setSubject}
                onToggleRecipientsExpanded={setRecipientsExpanded}
                onUpdateAudience={updateAudience}
                reachState={reachState}
                recipientsExpanded={recipientsExpanded}
                rosterConfiguration={rosterConfiguration}
                selectedEvent={selectedEvent}
                subject={subject}
                templates={templates}
              />
            </div>
          ) : (
            <MessagesPanel
              busy={busy}
              currentFilter={messageFilter}
              deliveryDetailsMessage={deliveryDetailsMessage}
              deliverySummary={deliverySummary}
              loadingDeliveryId={loadingDeliveryId}
              onCancelQueued={cancelQueuedMessage}
              onDeleteDraft={deleteDraft}
              onFilterChange={setMessageFilter}
              onNewMessage={openNewMessage}
              onOpenDeliveryDetails={openDeliveryDetails}
              onResumeDraft={resumeDraft}
              onRetryDeliveries={retryDeliveries}
              unifiedMessages={unifiedMessages}
            />
          )
        ) : null}

        {activeSection === "templates" ? <TemplatesPanel /> : null}

        {activeSection === "settings" ? (
          <CommunicationSettingsPanel
            emailSettings={emailSettings}
            providerStatus={providerStatus}
          />
        ) : null}
      </main>

      {/* Global Dialogs */}
      <CommunicationReviewDialog
        audience={audience}
        busy={busy}
        channel={channel}
        contentMarkdown={contentMarkdown}
        error={error}
        onClose={() => {
          setIsReviewOpen(false);
        }}
        onSend={() => void sendCommunication()}
        open={isReviewOpen}
        reachState={reachState}
        rosterConfiguration={rosterConfiguration}
        selectedEvent={selectedEvent}
        subject={subject}
      />

      <CommunicationTestDialog
        busy={busy}
        error={error}
        onClose={() => {
          setIsTestEmailOpen(false);
        }}
        onSend={sendTestEmail}
        open={isTestEmailOpen}
      />

      <SaveAsTemplateDialog
        busy={busy}
        error={error}
        onClose={() => {
          setIsSaveTemplateOpen(false);
        }}
        onSave={saveTemplate}
        open={isSaveTemplateOpen}
      />

      {confirmationDialog}
    </div>
  );
}
