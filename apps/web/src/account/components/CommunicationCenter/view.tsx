import type {
  CommunicationDeliveryRecipient,
  CommunicationDeliverySummary,
  CommunicationMessage,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { audienceOptions, channelFromValue, displayDate, eventLabel } from "./utils";
import { CommunicationSectionPicker, CommunicationTemplatePicker, TemplateLibrary } from "./shared";
import { CommunicationComposer } from "../../CommunicationComposer";
import {
  communicationPreviewValues,
  renderCommunicationMarkdownPreview,
} from "../../communicationMarkdown";
import type { CommunicationCenterModel } from "./hooks";

function deliveryStatusLabel(recipient: CommunicationDeliveryRecipient): string {
  if (recipient.providerStatus === "delivered") return "Delivered";
  return recipient.status.charAt(0).toUpperCase() + recipient.status.slice(1);
}

function deliveryChannelLabel(channel: CommunicationDeliveryRecipient["channel"]): string {
  return channel === "email" ? "Email" : "SMS";
}

function queuedReachMessage(total: number): string {
  if (total === 0) return "No recipients were queued for delivery.";
  return `${String(total)} ${total === 1 ? "recipient was" : "recipients were"} queued for delivery.`;
}

function DeliveryDetails({
  busy,
  message,
  onRetry,
  summary,
}: {
  readonly busy: boolean;
  readonly message: CommunicationMessage;
  readonly onRetry: () => Promise<void>;
  readonly summary: CommunicationDeliverySummary;
}) {
  const messageLabel = message.subject || `${message.channel} message`;
  return (
    <div
      aria-label={`Delivery details for ${messageLabel}`}
      aria-live="polite"
      className="communication-delivery-details notice notice--info"
      role="region"
    >
      <p>
        <strong>Delivery details</strong>
      </p>
      <p>
        Delivery: {summary.state} · {summary.total.sent} sent · {summary.total.failed} failed ·{" "}
        {summary.total.queued + summary.total.processing} remaining
      </p>
      {summary.provider.total > 0 ? (
        <>
          <p>
            Provider: {summary.provider.accepted} accepted · {summary.provider.delivered} delivered
            · {summary.provider.deferred} deferred · {summary.provider.bounced} bounced
          </p>
          <p>
            Provider: {summary.provider.failed} failed · {summary.provider.rejected} rejected ·{" "}
            {summary.provider.complained} complained
          </p>
        </>
      ) : null}
      {summary.failures.length > 0 ? (
        <ul>
          {summary.failures.map((failure, index) => (
            <li key={`${failure.maskedDestination}:${String(index)}`}>
              {failure.maskedDestination}: {failure.category}
            </li>
          ))}
        </ul>
      ) : null}
      {summary.recipients.length > 0 ? (
        <details className="communication-delivery-recipients" open>
          <summary>Recipients ({String(summary.recipients.length)})</summary>
          <ul className="communication-delivery-recipients__list">
            {summary.recipients.map((recipient, index) => (
              <li
                className="communication-delivery-recipients__item"
                key={recipient.recipientName + ":" + recipient.channel + ":" + String(index)}
              >
                <div>
                  <strong>{recipient.recipientName}</strong>
                  <p>{deliveryChannelLabel(recipient.channel)}</p>
                </div>
                <span className={`status-pill status-pill--${recipient.status}`}>
                  {deliveryStatusLabel(recipient)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {summary.total.failed > 0 ? (
        <button disabled={busy} onClick={() => void onRetry()} type="button">
          Retry failed deliveries
        </button>
      ) : null}
    </div>
  );
}

// eslint-disable-next-line complexity -- render composition preserves the existing screen's independent states and dialogs.
export function CommunicationCenterView({ model }: { readonly model: CommunicationCenterModel }) {
  const {
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
  } = model;
  if (!enabled) return null;
  const brevoStatus = providerStatus?.brevo.status;
  const brevoNeedsAttention = brevoStatus === "attention" || brevoStatus === "error";
  const brevoStatusMessage =
    brevoStatus === "error"
      ? "Email delivery is not configured. Audition notices and other organization emails cannot be sent until Brevo is configured."
      : "Email delivery is not active in this environment. Messages will not reach recipients until delivery is enabled.";
  const selectedEvent = audience.eventId
    ? (events.find((event) => event.id === audience.eventId) ?? null)
    : null;
  return (
    <section className="panel communication-center" aria-label="Communication center">
      <p className="section-description">
        Build a message in three steps: choose the audience, write with Markdown and placeholders,
        then review it before queueing delivery.
      </p>
      {providerStatus ? (
        <p className="notice notice--info" role="status">
          <strong>Delivery mode: {providerStatus.externalEffectsMode}.</strong>{" "}
          {providerStatus.externalEffectsMode === "fake"
            ? "Messages are recorded as sent but no external provider request is made."
            : providerStatus.externalEffectsMode === "disabled"
              ? "Messages are recorded as suppressed and are not sent."
              : "Provider requests are made under sandbox restrictions."}{" "}
          <a href="/admin/settings/setup-checklist#provider-status-title">
            View provider status details.
          </a>
        </p>
      ) : null}
      {brevoStatus === "error" ? (
        <p className="notice notice--error communication-center__provider-warning" role="alert">
          <strong>Email delivery needs setup.</strong> {brevoStatusMessage}{" "}
          <a href="/admin/settings/setup-checklist#provider-status-title">
            Open Brevo setup status.
          </a>
        </p>
      ) : null}
      <nav aria-label="Communication sections" className="communication-tabs" role="tablist">
        {(
          [
            ["compose", "Compose"],
            ["drafts", "Drafts"],
            ["history", "History"],
            ["templates", "Templates"],
            ["upcoming", "Upcoming sends"],
            ["settings", "Settings"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-controls={`communication-${value}-panel`}
            aria-selected={activeTab === value}
            className={activeTab === value ? "is-active" : ""}
            id={`communication-${value}-tab`}
            key={value}
            onClick={() => {
              setActiveTab(value);
            }}
            role="tab"
            type="button"
          >
            {label}
            {value === "drafts" &&
            messages.filter((message) => message.status === "Draft").length > 0 ? (
              <span className="communication-tabs__count">
                {String(messages.filter((message) => message.status === "Draft").length)}
              </span>
            ) : null}
            {value === "settings" && brevoNeedsAttention ? (
              <span
                aria-label={
                  brevoStatus === "error"
                    ? "Email delivery setup required"
                    : "Email delivery needs attention"
                }
                className={`communication-tabs__status-dot communication-tabs__status-dot--${brevoStatus}`}
                role="img"
                title={
                  brevoStatus === "error"
                    ? "Email delivery setup required"
                    : "Email delivery needs attention"
                }
              />
            ) : null}
          </button>
        ))}
      </nav>
      {activeTab === "compose" ? (
        <div
          aria-labelledby="communication-compose-tab"
          id="communication-compose-panel"
          role="tabpanel"
        >
          {queuedResult ? (
            <section
              aria-labelledby="communication-queued-title"
              className="communication-queued-result"
              id="communication-queued-result"
            >
              <div className="communication-queued-result__heading">
                <p className="eyebrow">Delivery queued</p>
                <h2 id="communication-queued-title">Communication queued</h2>
                <p>The message is ready for delivery to the selected audience.</p>
              </div>
              <p className="notice notice--success" role="status">
                <strong>{queuedReachMessage(queuedResult.reach.total)}</strong>
              </p>
              <dl className="communication-queued-result__details">
                <div>
                  <dt>Channel</dt>
                  <dd>{queuedResult.channel}</dd>
                </div>
                {queuedResult.channel !== "SMS" ? (
                  <div>
                    <dt>Subject</dt>
                    <dd>{queuedResult.subject}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Audience reach</dt>
                  <dd>{queuedResult.reach.total} reachable</dd>
                </div>
              </dl>
              <div className="form-actions form-actions--end">
                <button className="button button--primary" onClick={startNewMessage} type="button">
                  Send another message
                </button>
              </div>
            </section>
          ) : (
            <>
              <ol className="communication-stepper" aria-label="Message workflow">
                <li className={stage === "audience" ? "is-active" : "is-complete"}>
                  <span>1</span> Audience
                </li>
                <li className={stage === "compose" ? "is-active" : ""}>
                  <span>2</span> Compose
                </li>
                <li>
                  <span>3</span> Review &amp; send
                </li>
              </ol>
              {error && !previewOpen ? (
                <p className="notice notice--error" role="alert">
                  {error}
                </p>
              ) : null}
              {success && !previewOpen ? (
                <p className="notice notice--success" role="status">
                  {success}
                </p>
              ) : null}

              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (stage === "audience") {
                    setStage("compose");
                  } else {
                    void openFinalPreview();
                  }
                }}
              >
                {stage === "audience" ? (
                  <>
                    <div className="field">
                      <label htmlFor="communication-channel">Channel</label>
                      <select
                        id="communication-channel"
                        onChange={(event) => {
                          setChannel(channelFromValue(event.target.value));
                          setReach(null);
                        }}
                        value={channel}
                      >
                        <option>Email</option>
                        <option>SMS</option>
                        <option>Both</option>
                      </select>
                    </div>
                    <fieldset ref={audienceFieldsetRef}>
                      <legend>Audience</legend>
                      <p className="field-help">
                        Donors and ticket buyers include paid contacts who opted into updates. An
                        event-specific ticket audience includes all paid buyers for that event.
                      </p>
                      <div className="checkbox-grid">
                        {audienceOptions.map((target) => (
                          <label key={target} className="checkbox-row">
                            <input
                              checked={audience.targetAudiences.includes(target)}
                              data-communication-audience={target}
                              disabled={
                                audience.targetAudiences.length === 1 &&
                                audience.targetAudiences.includes(target)
                              }
                              onChange={(event) => {
                                toggleAudience(target, event.target.checked);
                              }}
                              type="checkbox"
                            />
                            {target}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {audience.targetAudiences.includes("Members") ? (
                      <>
                        <fieldset>
                          <legend>Profile status</legend>
                          <div className="communication-status-options">
                            {(["Active", "Idle", "Inactive"] as const).map((status) => (
                              <label key={status} className="checkbox-row">
                                <input
                                  checked={audience.globalStatuses.includes(status)}
                                  onChange={(event) => {
                                    toggleStatus(status, event.target.checked);
                                    setReach(null);
                                  }}
                                  type="checkbox"
                                />
                                {status === "Idle" ? "On Break" : status}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        {rosterConfiguration ? (
                          <CommunicationSectionPicker
                            configuration={rosterConfiguration}
                            onChange={(sections) => {
                              setVoiceParts(sections.join(", "));
                              setReach(null);
                            }}
                            value={voiceParts}
                          />
                        ) : null}
                      </>
                    ) : null}
                    {audience.targetAudiences.includes("Members") ||
                    audience.targetAudiences.includes("Ticket Buyers") ? (
                      <div className="field">
                        <label htmlFor="communication-event">Event (optional)</label>
                        <select
                          aria-describedby="communication-event-help"
                          id="communication-event"
                          onChange={(event) => {
                            const eventId = event.target.value || null;
                            updateAudience((current) => ({
                              ...current,
                              eventId,
                              rsvp: eventId ? current.rsvp : "All",
                            }));
                            setReach(null);
                          }}
                          value={audience.eventId ?? ""}
                        >
                          <option value="">All matching contacts</option>
                          {events.map((event) => (
                            <option key={event.id} value={event.id}>
                              {eventLabel(event)}
                            </option>
                          ))}
                        </select>
                        <p className="field-help" id="communication-event-help">
                          Choose an event to target its matching contacts and unlock event-specific
                          placeholders in the Compose step.
                        </p>
                      </div>
                    ) : null}
                    {audience.eventId && audience.targetAudiences.includes("Members") ? (
                      <div className="field">
                        <label htmlFor="communication-rsvp">Member RSVP response</label>
                        <select
                          id="communication-rsvp"
                          onChange={(event) => {
                            const value = event.target.value;
                            updateAudience((current) => ({
                              ...current,
                              rsvp:
                                value === "Yes" || value === "No" || value === "Pending"
                                  ? value
                                  : "All",
                            }));
                            setReach(null);
                          }}
                          value={audience.rsvp}
                        >
                          <option value="All">Any response</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                          <option value="Pending">Pending</option>
                        </select>
                      </div>
                    ) : null}
                    {reach ? (
                      <p className="notice notice--info communication-audience-reach" role="status">
                        <strong>Audience reach</strong>
                        <br />
                        {reach}
                      </p>
                    ) : null}
                    <div className="form-actions form-actions--end">
                      <button disabled={busy} onClick={() => void previewReach()} type="button">
                        {busy ? "Calculating…" : "Preview audience reach"}
                      </button>
                      <button className="button button--primary" disabled={busy} type="submit">
                        Continue to compose
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <CommunicationTemplatePicker
                      audience={audience}
                      channel={channel}
                      contentMarkdown={contentMarkdown}
                      onApply={(template) => {
                        setChannel(template.channel);
                        setContentMarkdown(template.contentMarkdown);
                        setSubject(template.subject);
                        setReach(null);
                      }}
                      subject={subject}
                    />
                    {channel !== "SMS" ? (
                      <div className="field">
                        <label htmlFor="communication-subject">Subject</label>
                        <input
                          id="communication-subject"
                          maxLength={300}
                          onChange={(event) => {
                            setSubject(event.target.value);
                          }}
                          required
                          value={subject}
                        />
                      </div>
                    ) : null}
                    <div className="field">
                      <label htmlFor="communication-content">Message</label>
                      <CommunicationComposer
                        audience={audience}
                        channel={channel}
                        contentMarkdown={contentMarkdown}
                        onBackToAudience={() => {
                          setStage("audience");
                        }}
                        onContentChange={(value) => {
                          setContentMarkdown(value);
                        }}
                        previewEvent={selectedEvent}
                        subject={subject}
                      />
                    </div>
                    {reach ? (
                      <p className="notice notice--info" role="status">
                        {reach}
                      </p>
                    ) : null}
                    <div className="form-actions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setStage("audience");
                        }}
                        type="button"
                      >
                        Back to audience
                      </button>
                      <button disabled={busy} onClick={() => void previewReach()} type="button">
                        Preview reach
                      </button>
                      <button disabled={busy} onClick={() => void saveDraft()} type="button">
                        Save draft
                      </button>
                      <button className="button button--primary" disabled={busy} type="submit">
                        {busy ? "Working…" : "Preview before queueing"}
                      </button>
                    </div>
                  </>
                )}
              </form>

              <Dialog
                description="Review the exact message and audience reach before queueing it for delivery."
                onClose={() => {
                  if (!busy) setPreviewOpen(false);
                }}
                open={previewOpen}
                title="Final message preview"
              >
                {error ? (
                  <p className="notice notice--error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="communication-preview">
                  <dl>
                    <div>
                      <dt>Channel</dt>
                      <dd>{channel}</dd>
                    </div>
                    {channel !== "SMS" ? (
                      <div>
                        <dt>Subject</dt>
                        <dd>{subject}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Audience reach</dt>
                      <dd>{reach ?? "Reach not calculated"}</dd>
                    </div>
                  </dl>
                  <div
                    className="communication-preview__message communication-composer__preview"
                    dangerouslySetInnerHTML={{
                      __html: renderCommunicationMarkdownPreview(
                        contentMarkdown,
                        communicationPreviewValues(selectedEvent),
                      ),
                    }}
                  />
                  <p className="field-help">
                    Preview uses a sample recipient; event values come from the selected event.
                  </p>
                  <p className="field-help">
                    Queueing will create delivery records for the selected audience. You can review
                    delivery status afterward.
                  </p>
                </div>
                <div className="dialog__actions">
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => {
                      setPreviewOpen(false);
                    }}
                    type="button"
                  >
                    Back to edit
                  </button>
                  <button
                    className="button button--primary"
                    disabled={busy}
                    onClick={() => void send()}
                    type="button"
                  >
                    {busy ? "Queueing…" : "Queue communication"}
                  </button>
                </div>
              </Dialog>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "drafts" ? (
        <div
          aria-labelledby="communication-drafts-tab"
          className="communication-tab-panel"
          id="communication-drafts-panel"
          role="tabpanel"
        >
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Drafts</h2>
              <p>Resume a saved message or remove drafts you no longer need.</p>
            </div>
            <button className="button button--primary" onClick={startNewMessage} type="button">
              New message
            </button>
          </div>
          {draftMessages.length === 0 ? (
            <p>No communication drafts yet.</p>
          ) : (
            <ul className="account-list">
              {draftMessages.map((message) => (
                <li key={message.id}>
                  <div>
                    <strong>{message.subject || `${message.channel} message`}</strong>
                    <p>
                      {message.channel} · {displayDate(message.createdAt)}
                    </p>
                  </div>
                  <div className="button-row">
                    <button
                      className="button button--secondary button--small"
                      disabled={busy}
                      onClick={() => {
                        resumeDraft(message);
                      }}
                      type="button"
                    >
                      Open draft
                    </button>
                    <button
                      className="button button--danger button--small"
                      disabled={busy}
                      onClick={() => void deleteDraft(message)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {activeTab === "history" ? (
        <div
          aria-labelledby="communication-history-tab"
          className="communication-tab-panel"
          id="communication-history-panel"
          role="tabpanel"
        >
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Message history</h2>
              <p>
                Review queued and completed messages. Select View delivery details to inspect
                delivery progress and recipient outcomes.
              </p>
            </div>
          </div>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          {historyMessages.length === 0 && scheduledMessageHistory.length === 0 ? (
            <p>No communications have been sent yet.</p>
          ) : (
            <>
              {historyMessages.length > 0 ? (
                <ul className="account-list">
                  {historyMessages.map((message) => (
                    <li key={message.id}>
                      <div className="communication-history-entry">
                        <div className="communication-history-entry__header">
                          <div>
                            <strong>{message.subject || `${message.channel} message`}</strong>
                            <p>
                              {message.status} · {message.channel} ·{" "}
                              {displayDate(message.createdAt)} · reach {String(message.reach.total)}
                            </p>
                          </div>
                          <div className="button-row communication-history-actions">
                            {message.status === "Queued" ? (
                              <>
                                <button
                                  className="button button--secondary button--small"
                                  disabled={busy}
                                  onClick={() => void editQueuedMessage(message)}
                                  type="button"
                                >
                                  Edit &amp; requeue
                                </button>
                                <button
                                  className="button button--danger button--small"
                                  disabled={busy}
                                  onClick={() => void cancelQueuedMessage(message)}
                                  type="button"
                                >
                                  Cancel message
                                </button>
                              </>
                            ) : null}
                            <button
                              className="button button--secondary button--small"
                              disabled={busy}
                              onClick={() => void showDelivery(message)}
                              type="button"
                            >
                              {loadingDeliveryId === message.id
                                ? "Loading delivery details…"
                                : "View delivery details"}
                            </button>
                          </div>
                        </div>
                        {summary?.messageId === message.id ? (
                          <DeliveryDetails
                            busy={busy}
                            message={message}
                            onRetry={retryFailed}
                            summary={summary}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {scheduledMessageHistory.length > 0 ? (
                <div className="communication-history-group">
                  <h3>Automated message history</h3>
                  <p className="field-help">
                    Completed audition messages, ticket reminders, ticket confirmations, and
                    scheduled reports appear here after delivery.
                  </p>
                  <ul className="account-list">
                    {scheduledMessageHistory.map((message) => (
                      <li key={message.id}>
                        <div>
                          <strong>{scheduledKindLabel(message.kind)}</strong>
                          <p>
                            {message.eventTitle} · {message.subject}
                          </p>
                        </div>
                        <div>
                          <span className="status-pill">{message.status}</span>
                          <p>{displayDate(message.scheduledAt)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {activeTab === "templates" ? (
        <div
          aria-labelledby="communication-templates-tab"
          className="communication-tab-panel"
          id="communication-templates-panel"
          role="tabpanel"
        >
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Message templates</h2>
              <p>Apply a template while composing, or edit its wording here for future messages.</p>
            </div>
          </div>
          <TemplateLibrary
            audience={audience}
            channel={channel}
            contentMarkdown={contentMarkdown}
            showAll
            subject={subject}
          />
        </div>
      ) : null}

      {activeTab === "upcoming" ? (
        <div
          aria-labelledby="communication-upcoming-tab"
          className="communication-tab-panel"
          id="communication-upcoming-panel"
          role="tabpanel"
        >
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Upcoming sends</h2>
              <p>
                See automated audition messages, reminders, and reports that are scheduled for
                delivery.
              </p>
            </div>
          </div>
          {upcomingScheduledMessages.length === 0 ? (
            <p>No upcoming sends. Completed sends are available in History.</p>
          ) : (
            <ul className="account-list">
              {upcomingScheduledMessages.map((message) => (
                <li key={message.id}>
                  <div>
                    <strong>{scheduledKindLabel(message.kind)}</strong>
                    <p>
                      {message.eventTitle} · {message.subject}
                    </p>
                  </div>
                  <div>
                    <span className="status-pill">{message.status}</span>
                    <p>{displayDate(message.scheduledAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <div
          aria-labelledby="communication-settings-tab"
          className="communication-tab-panel"
          id="communication-settings-panel"
          role="tabpanel"
        >
          <div className="communication-tab-panel__heading">
            <div>
              <h2>Communication settings</h2>
              <p>Verify delivery before sending a message to a larger audience.</p>
            </div>
          </div>
          <fieldset className="communication-test-send">
            <legend>Connection test</legend>
            <p className="field-help">
              Send a test message to one address to verify the configured delivery service. If a
              message is already composed, its subject and content will be used.
            </p>
            <dl className="communication-sender-details" aria-label="Configured sender">
              <div>
                <dt>From name</dt>
                <dd>
                  {emailSettings?.fromName ??
                    providerStatus?.emailSender.fromName ??
                    "Choir Management"}
                </dd>
              </div>
              <div>
                <dt>From email</dt>
                <dd>
                  {emailSettings?.customDomainStatus === "active" && emailSettings.customDomain
                    ? `announcements@${emailSettings.customDomain}`
                    : (providerStatus?.emailSender.fromEmail ?? "Not configured")}
                </dd>
              </div>
              <div>
                <dt>Reply-to email</dt>
                <dd>{emailSettings?.replyToEmail ?? "None (replies sent to sender address)"}</dd>
              </div>
              <div>
                <dt>Sending domain</dt>
                <dd>
                  {emailSettings?.customDomain
                    ? `${emailSettings.customDomain} (${emailSettings.customDomainStatus})`
                    : "Platform default"}
                </dd>
              </div>
            </dl>
            <p className="field-help">
              These values show how recipients see outbound emails sent from this organization.
            </p>
            <section
              aria-labelledby="communication-sender-setup-title"
              className="communication-sender-setup"
            >
              <h3 id="communication-sender-setup-title">
                Configuring sender &amp; reply-to details
              </h3>
              <p>
                Organization Administrators can customize the sender display name, reply-to address,
                and custom sending domain in{" "}
                <a href="/admin/settings/email-settings">Email &amp; Sender Settings</a>.
              </p>
              <p className="field-help">
                If custom values are not configured, messages automatically use the verified
                platform default sender.
              </p>
            </section>
            <div className="form-actions form-actions--start">
              <div className="field communication-test-send__address">
                <label htmlFor="communication-settings-test-email">Test recipient</label>
                <input
                  id="communication-settings-test-email"
                  onChange={(event) => {
                    setTestEmail(event.target.value);
                  }}
                  placeholder="you@example.com"
                  type="email"
                  value={testEmail}
                />
              </div>
              <button
                className="button button--secondary communication-test-send__button"
                disabled={busy || !testEmail.trim()}
                onClick={() => void sendTestEmail()}
                type="button"
              >
                Send test email
              </button>
            </div>
            <p className="field-help">
              Sender and domain delivery settings are controlled by the organization’s configured
              email service. Test emails replace {"{singerName}"} with “Test recipient”; event
              placeholders are populated when you queue a message for a selected event.
            </p>
          </fieldset>
        </div>
      ) : null}
      {confirmationDialog}
    </section>
  );
}
