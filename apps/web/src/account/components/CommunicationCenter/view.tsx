import { CommunicationOverview } from "./CommunicationOverview";
import { OrganizationTimezoneBoundary } from "../OrganizationTimezoneStatus";
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

function CommunicationHeader({ model }: { readonly model: CommunicationCenterControllerModel }) {
  const { activeSection, messageMode, openNewMessage, setActiveSection, providerStatus } = model;
  const showProviderNotice =
    providerStatus &&
    (providerStatus.environment !== "production" ||
      providerStatus.externalEffectsMode === "disabled" ||
      providerStatus.externalEffectsMode === "fake");
  const navItems: readonly { readonly id: CommunicationSection; readonly label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "messages", label: "Messages" },
    { id: "automations", label: "Automations" },
    { id: "templates", label: "Templates" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <>
      <header className="communication-overview__header">
        <div>
          <h1>Communications</h1>
          <p className="page-heading__description">
            Send messages and keep track of what goes out.
          </p>
        </div>
        {messageMode !== "compose" || activeSection !== "messages" ? (
          <button type="button" className="button button--primary" onClick={openNewMessage}>
            New message
          </button>
        ) : null}
      </header>
      {/* Top Level Section Navigation (Buttons with aria-current) */}
      <nav aria-label="Communications navigation" className="communication-nav">
        {navItems.map((item) => (
          <button
            aria-current={activeSection === item.id ? "page" : undefined}
            className={`communication-nav__item ${activeSection === item.id ? "is-active" : ""}`}
            key={item.id}
            onClick={() => {
              setActiveSection(item.id);
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
    </>
  );
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
    contactLists,
    contentMarkdown,
    contextIssues,
    deleteDraft,
    deliveryDetailsMessage,
    deliverySummary,
    draftCount,
    emailSettings,
    eventPromotion,
    error,
    events,
    hasNextPage,
    hasPreviousPage,
    isReviewOpen,
    isSaveTemplateOpen,
    isTestEmailOpen,
    loadingDeliveryId,
    loadingHistory,
    messageMode,
    nextPage,
    nowMs,
    openDeliveryDetails,
    openReviewAndSend,
    openSaveAsTemplate,
    openTestEmail,
    originFilter,
    pageNumber,
    previousPage,
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
    setChannel,
    setContentMarkdown,
    setIsReviewOpen,
    setIsSaveTemplateOpen,
    setIsTestEmailOpen,
    setMessageMode,
    setOriginFilter,
    setRecipientsExpanded,
    setStatusFilter,
    setSubject,
    statusFilter,
    subject,
    successNotice,
    templates,
    timezone,
    branding,
    unifiedMessages,
    updateAudience,
    venues,
  } = model;

  return (
    <OrganizationTimezoneBoundary
      timezone={timezone}
      failed={Boolean(error)}
      onRetry={model.retryResources}
      errorMessage={error}
    >
      <div className="communication-center">
        <CommunicationHeader model={model} />

        {/* Global Errors and Success Notices (outside compose mode) */}
        {error && messageMode !== "compose" ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}

        {successNotice && messageMode !== "compose" ? (
          <p className="notice notice--success" role="status">
            {successNotice}
          </p>
        ) : null}

        {/* Main Section Content */}
        <div className="communication-main-content">
          {activeSection === "overview" || activeSection === "automations" ? (
            <CommunicationOverview model={model} automations={activeSection === "automations"} />
          ) : null}
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
                <MessageComposer
                  audience={audience}
                  audienceOptions={audienceOptions}
                  busy={busy}
                  channel={channel}
                  contactLists={contactLists}
                  contentMarkdown={contentMarkdown}
                  contextIssues={contextIssues}
                  eventPromotion={eventPromotion}
                  events={events}
                  nowMs={nowMs}
                  onChannelChange={setChannel}
                  onContentChange={setContentMarkdown}
                  onOpenReview={() => void openReviewAndSend()}
                  onOpenSaveTemplate={openSaveAsTemplate}
                  onOpenTestEmail={openTestEmail}
                  onSendTestEmail={sendTestEmail}
                  testEmailError={error}
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
                  timezone={timezone}
                  branding={branding}
                  templates={templates}
                  venues={venues}
                />
              </div>
            ) : (
              <MessagesPanel
                showNewMessage={false}
                branding={branding}
                busy={busy}
                currentOrigin={originFilter}
                currentStatus={statusFilter}
                deliveryDetailsMessage={deliveryDetailsMessage}
                deliverySummary={deliverySummary}
                draftCount={draftCount}
                events={events}
                hasNextPage={hasNextPage}
                hasPreviousPage={hasPreviousPage}
                loadingDeliveryId={loadingDeliveryId}
                loadingHistory={loadingHistory}
                onCancelQueued={cancelQueuedMessage}
                onDeleteDraft={deleteDraft}
                onNewMessage={model.openNewMessage}
                onNextPage={() => void nextPage()}
                onOpenDeliveryDetails={openDeliveryDetails}
                onOriginFilterChange={setOriginFilter}
                onPreviousPage={() => void previousPage()}
                onResumeDraft={resumeDraft}
                onRetryDeliveries={retryDeliveries}
                onStatusFilterChange={setStatusFilter}
                pageNumber={pageNumber}
                timezone={timezone}
                unifiedMessages={unifiedMessages}
                venues={venues}
              />
            )
          ) : null}

          {activeSection === "templates" ? <TemplatesPanel /> : null}

          {activeSection === "settings" ? (
            <CommunicationSettingsPanel
              emailSettings={emailSettings}
              providerStatus={model.providerStatus}
            />
          ) : null}
        </div>

        {/* Global Dialogs */}
        <CommunicationReviewDialog
          audience={audience}
          busy={busy}
          channel={channel}
          contactLists={contactLists}
          contentMarkdown={contentMarkdown}
          error={error}
          events={events}
          nowMs={nowMs}
          onClose={() => {
            setIsReviewOpen(false);
          }}
          onSend={() => void sendCommunication()}
          open={isReviewOpen}
          reachState={reachState}
          rosterConfiguration={rosterConfiguration}
          selectedEvent={selectedEvent}
          subject={subject}
          timezone={timezone}
          branding={branding}
          venues={venues}
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
    </OrganizationTimezoneBoundary>
  );
}
