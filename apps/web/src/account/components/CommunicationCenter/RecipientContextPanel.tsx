import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  ContactList,
  OrganizationEvent,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import type { CommunicationAudienceTarget, CommunicationReachState } from "./types";
import {
  channelFromValue,
  contactFiltersSummary,
  eventLabel,
  memberFiltersSummary,
  reachSummaryText,
  recipientTypeSummary,
} from "./utils";
import { CommunicationSectionPicker } from "./shared";

interface RecipientContextPanelProps {
  readonly audience: CommunicationAudienceRequest;
  readonly audienceOptions: readonly CommunicationAudienceTarget[];
  readonly channel: CommunicationChannel;
  readonly contactLists: readonly ContactList[];
  readonly events: readonly OrganizationEvent[];
  readonly expanded: boolean;
  readonly onChannelChange: (channel: CommunicationChannel) => void;
  readonly onToggleExpanded: (expanded: boolean) => void;
  readonly onUpdateAudience: (
    updater: (current: CommunicationAudienceRequest) => CommunicationAudienceRequest,
  ) => void;
  readonly reachState: CommunicationReachState;
  readonly rosterConfiguration: OrganizationRosterConfiguration | null;
  readonly selectedEvent: OrganizationEvent | null;
}

interface MemberFiltersDetailsProps {
  readonly audience: CommunicationAudienceRequest;
  readonly onToggleGlobalStatus: (status: "Active" | "Idle" | "Inactive", checked: boolean) => void;
  readonly onUpdateAudience: (
    updater: (current: CommunicationAudienceRequest) => CommunicationAudienceRequest,
  ) => void;
  readonly rosterConfiguration: OrganizationRosterConfiguration | null;
}

function MemberFiltersDetails({
  audience,
  onToggleGlobalStatus,
  onUpdateAudience,
  rosterConfiguration,
}: MemberFiltersDetailsProps) {
  const globalStatuses: readonly ("Active" | "Idle" | "Inactive")[] = [
    "Active",
    "Idle",
    "Inactive",
  ];

  return (
    <details className="communication-progressive-disclosure">
      <summary>
        <span>More member filters</span>
        <span className="disclosure-hint">Status, sections, RSVP</span>
      </summary>
      <div className="disclosure-body">
        <fieldset className="field">
          <legend className="field-label">Member status</legend>
          <div className="checkbox-grid">
            {globalStatuses.map((status) => (
              <label className="checkbox-row" key={status}>
                <input
                  checked={audience.globalStatuses.includes(status)}
                  onChange={(event) => {
                    onToggleGlobalStatus(status, event.target.checked);
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
              onUpdateAudience((current) => ({
                ...current,
                voiceParts: [...sections],
              }));
            }}
            value={audience.voiceParts.join(", ")}
          />
        ) : null}

        {audience.eventId ? (
          <div className="field">
            <label htmlFor="communication-rsvp-select">Member RSVP response</label>
            <select
              id="communication-rsvp-select"
              onChange={(event) => {
                const value = event.target.value;
                onUpdateAudience((current) => ({
                  ...current,
                  rsvp: value === "Yes" || value === "No" || value === "Pending" ? value : "All",
                }));
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
      </div>
    </details>
  );
}

interface CollapsedSummaryProps {
  readonly channel: CommunicationChannel;
  readonly filterSummary: string;
  readonly onToggleExpanded: (expanded: boolean) => void;
  readonly reachState: CommunicationReachState;
  readonly recipientSummary: string;
  readonly selectedEvent: OrganizationEvent | null;
}

function CollapsedRecipientSummary({
  channel,
  filterSummary,
  onToggleExpanded,
  reachState,
  recipientSummary,
  selectedEvent,
}: CollapsedSummaryProps) {
  const reachDisplay = reachState.loading
    ? "Calculating reach…"
    : (reachState.error ??
      (reachState.data ? reachSummaryText(reachState.data, channel) : "Unknown reach"));

  return (
    <div className="communication-recipient-summary">
      <div className="communication-recipient-summary__info">
        <div className="summary-row">
          <span className="summary-label">To</span>
          <span className="summary-value">
            <strong>{recipientSummary}</strong>
            {filterSummary ? ` · ${filterSummary}` : ""}
            {selectedEvent ? ` · ${selectedEvent.title}` : ""}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Via</span>
          <span className="summary-value">{channel}</span>
        </div>
        <div aria-live="polite" className="summary-row" role="status">
          <span className="summary-label">Reach</span>
          <span className="summary-value">{reachDisplay}</span>
        </div>
      </div>
      <button
        className="button button--secondary button--sm"
        onClick={() => {
          onToggleExpanded(true);
        }}
        type="button"
      >
        Edit recipients
      </button>
    </div>
  );
}

function TicketBuyerModeField({
  canSelectTicketServiceNotice,
  channel,
  isTicketServiceNotice,
  onUpdateAudience,
}: {
  readonly canSelectTicketServiceNotice: boolean;
  readonly channel: CommunicationChannel;
  readonly isTicketServiceNotice: boolean;
  readonly onUpdateAudience: RecipientContextPanelProps["onUpdateAudience"];
}) {
  return (
    <fieldset className="field">
      <legend className="field-label">Ticket buyer audience</legend>
      <label className="checkbox-row">
        <input
          checked={!isTicketServiceNotice}
          name="communication-ticket-buyer-mode"
          onChange={() => {
            onUpdateAudience((current) => ({ ...current, ticketBuyerMode: "marketing" }));
          }}
          type="radio"
          value="marketing"
        />
        Marketing / general communication
      </label>
      <label className="checkbox-row">
        <input
          checked={isTicketServiceNotice}
          disabled={!canSelectTicketServiceNotice && !isTicketServiceNotice}
          name="communication-ticket-buyer-mode"
          onChange={() => {
            onUpdateAudience((current) => ({ ...current, ticketBuyerMode: "ticket_service" }));
          }}
          type="radio"
          value="ticket_service"
        />
        Important notice for current ticket holders
      </label>
      <p className="field-hint">
        Includes all paid ticket holders for the selected performance, even if they did not opt in
        to marketing email. Use for cancellations, schedule changes, venue changes, and other
        ticket-related service notices.
      </p>
      {!canSelectTicketServiceNotice && !isTicketServiceNotice ? (
        <p className="field-hint">
          {channel !== "Email"
            ? "Switch delivery channel to Email to enable ticket-holder notices."
            : "Choose Ticket Buyers only to enable ticket-holder notices."}
        </p>
      ) : null}
      {isTicketServiceNotice ? (
        <p className="field-hint">
          This mode sends one email per deliverable ticket-holder address and keeps administrative
          and provider suppressions in effect.
        </p>
      ) : null}
    </fieldset>
  );
}

function EventSelector({
  audience,
  events,
  isTicketServiceNotice,
  onUpdateAudience,
}: {
  readonly audience: CommunicationAudienceRequest;
  readonly events: readonly OrganizationEvent[];
  readonly isTicketServiceNotice: boolean;
  readonly onUpdateAudience: RecipientContextPanelProps["onUpdateAudience"];
}) {
  return (
    <div className="field">
      <label htmlFor="communication-event">
        Event {isTicketServiceNotice ? "(required)" : "(optional)"}
      </label>
      <select
        aria-describedby={
          isTicketServiceNotice && !audience.eventId
            ? "communication-event-help communication-event-error"
            : "communication-event-help"
        }
        aria-invalid={isTicketServiceNotice && !audience.eventId ? true : undefined}
        id="communication-event"
        onChange={(event) => {
          const eventId = event.target.value || null;
          onUpdateAudience((current) => ({
            ...current,
            eventId,
            rsvp: eventId ? current.rsvp : "All",
          }));
        }}
        value={audience.eventId ?? ""}
      >
        <option value="">
          {isTicketServiceNotice ? "Select the affected performance" : "All matching contacts"}
        </option>
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {event.isCanceled ? `${eventLabel(event)} (canceled)` : eventLabel(event)}
          </option>
        ))}
      </select>
      <p className="field-hint" id="communication-event-help">
        {isTicketServiceNotice
          ? "Choose the performance whose current paid ticket holders should receive this notice. Canceled performances remain available for cancellation notices."
          : "Selecting an event unlocks event and attendance placeholders."}
      </p>
      {isTicketServiceNotice && !audience.eventId ? (
        <p className="field-hint" id="communication-event-error" role="alert">
          Select the affected performance to contact its ticket holders.
        </p>
      ) : null}
    </div>
  );
}

function MixedAudienceNotice({ isMixedAudience }: { readonly isMixedAudience: boolean }) {
  if (!isMixedAudience) return null;
  return (
    <div className="notice notice--info communication-mixed-audience-notice">
      <p>
        <strong>Multiple groups selected.</strong> Placeholders must be compatible with all selected
        groups.
      </p>
    </div>
  );
}

export function RecipientContextPanel({
  audience,
  audienceOptions,
  channel,
  contactLists,
  events,
  expanded,
  onChannelChange,
  onToggleExpanded,
  onUpdateAudience,
  reachState,
  rosterConfiguration,
  selectedEvent,
}: RecipientContextPanelProps) {
  const isMembersSelected = audience.targetAudiences.includes("Members");
  const isContactsSelected = audience.targetAudiences.includes("Contacts");
  const isTicketBuyersSelected = audience.targetAudiences.includes("Ticket Buyers");
  const isMixedAudience = audience.targetAudiences.length > 1;
  const isTicketServiceNotice = audience.ticketBuyerMode === "ticket_service";
  const canSelectTicketServiceNotice = channel === "Email" && !isMixedAudience;

  function toggleTarget(target: CommunicationAudienceTarget, checked: boolean) {
    onUpdateAudience((current) => {
      const next = checked
        ? [...new Set([...current.targetAudiences, target])]
        : current.targetAudiences.filter((t) => t !== target);
      return {
        ...current,
        ticketBuyerMode: next.includes("Ticket Buyers") ? current.ticketBuyerMode : "marketing",
        targetAudiences: next.length > 0 ? next : ["Members"],
      };
    });
  }

  function toggleGlobalStatus(status: "Active" | "Idle" | "Inactive", checked: boolean) {
    onUpdateAudience((current) => {
      const next = checked
        ? [...new Set([...current.globalStatuses, status])]
        : current.globalStatuses.filter((s) => s !== status);
      return {
        ...current,
        globalStatuses: next.length > 0 ? next : ["Active"],
      };
    });
  }

  const recipientSummary = recipientTypeSummary(audience);
  const memberSummary = isMembersSelected
    ? memberFiltersSummary(audience, rosterConfiguration)
    : "";
  const contactSummary = isContactsSelected
    ? contactFiltersSummary(audience, new Map(contactLists.map((list) => [list.id, list.name])))
    : "";

  return (
    <section aria-label="Recipient context" className="communication-recipient-panel">
      {expanded ? (
        <div className="communication-recipient-editor">
          <div className="communication-recipient-editor__header">
            <h3>Recipients &amp; Delivery</h3>
            <button
              className="button button--secondary button--sm"
              onClick={() => {
                onToggleExpanded(false);
              }}
              type="button"
            >
              Done editing
            </button>
          </div>

          <div className="communication-recipient-editor__grid">
            {/* Target Audience Types */}
            <fieldset className="field">
              <legend className="field-label">Recipient type</legend>
              <div className="checkbox-grid">
                {audienceOptions.map((option) => (
                  <label className="checkbox-row" key={option}>
                    <input
                      checked={audience.targetAudiences.includes(option)}
                      onChange={(event) => {
                        toggleTarget(option, event.target.checked);
                      }}
                      disabled={isTicketServiceNotice && option !== "Ticket Buyers"}
                      type="checkbox"
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>

            {isTicketBuyersSelected ? (
              <TicketBuyerModeField
                canSelectTicketServiceNotice={canSelectTicketServiceNotice}
                channel={channel}
                isTicketServiceNotice={isTicketServiceNotice}
                onUpdateAudience={onUpdateAudience}
              />
            ) : null}

            {/* Delivery Channel */}
            <div className="field">
              <label htmlFor="communication-channel-select">Delivery channel</label>
              <select
                id="communication-channel-select"
                onChange={(event) => {
                  onChannelChange(channelFromValue(event.target.value));
                }}
                value={channel}
              >
                <option value="Email">Email</option>
                <option disabled={isTicketServiceNotice} value="SMS">
                  SMS
                </option>
                <option disabled={isTicketServiceNotice} value="Both">
                  Both (Email &amp; SMS)
                </option>
              </select>
            </div>

            {/* Event Selector (shown for Members or Ticket Buyers) */}
            {isMembersSelected || isTicketBuyersSelected ? (
              <EventSelector
                audience={audience}
                events={events}
                isTicketServiceNotice={isTicketServiceNotice}
                onUpdateAudience={onUpdateAudience}
              />
            ) : null}

            {/* Mixed Audience Helper Notice */}
            <MixedAudienceNotice isMixedAudience={isMixedAudience} />

            {/* Progressive Disclosure: Member Filters */}
            {isMembersSelected ? (
              <MemberFiltersDetails
                audience={audience}
                onToggleGlobalStatus={toggleGlobalStatus}
                onUpdateAudience={onUpdateAudience}
                rosterConfiguration={rosterConfiguration}
              />
            ) : null}

            {/* Contacts: List targeting (all eligible when none selected) */}
            {isContactsSelected ? (
              <fieldset className="field">
                <legend className="field-label">Contact lists</legend>
                {contactLists.length === 0 ? (
                  <p className="field-hint" role="note">
                    No contact lists yet. The message will reach all eligible contacts.
                  </p>
                ) : (
                  <div className="checkbox-grid">
                    {contactLists.map((list) => (
                      <label className="checkbox-row" key={list.id}>
                        <input
                          checked={audience.contactListIds.includes(list.id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            onUpdateAudience((current) => ({
                              ...current,
                              contactListIds: checked
                                ? [...new Set([...current.contactListIds, list.id])]
                                : current.contactListIds.filter((id) => id !== list.id),
                            }));
                          }}
                          type="checkbox"
                        />
                        {list.name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="field-hint">
                  {audience.contactListIds.length === 0
                    ? "All eligible contacts are included. Select lists to narrow the audience."
                    : "Only contacts in the selected lists are included. A contact in several selected lists still receives one copy."}
                </p>
              </fieldset>
            ) : null}
          </div>

          {/* Automatic Reach Summary */}
          <div aria-live="polite" className="communication-recipient-reach-badge" role="status">
            {reachState.loading ? (
              <span className="reach-loading">Calculating audience reach…</span>
            ) : reachState.error ? (
              <span className="reach-error">{reachState.error}</span>
            ) : reachState.data ? (
              <span className="reach-text">
                <strong>Reach:</strong>{" "}
                {reachSummaryText(reachState.data, channel, audience.ticketBuyerMode)}
              </span>
            ) : (
              <span className="reach-text">Reach ready on message creation</span>
            )}
          </div>
        </div>
      ) : (
        <CollapsedRecipientSummary
          channel={channel}
          filterSummary={[memberSummary, contactSummary].filter(Boolean).join(" · ")}
          onToggleExpanded={onToggleExpanded}
          reachState={reachState}
          recipientSummary={recipientSummary}
          selectedEvent={selectedEvent}
        />
      )}
    </section>
  );
}
