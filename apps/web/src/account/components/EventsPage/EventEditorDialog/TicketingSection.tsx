import type { OrganizationEventRequest } from "@choir/contracts";
import { TabsContent } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";

import { dayOfPriceStartLabel } from "../../../eventPricing";
import { QRCodeShareCard } from "../../../QRCodeShareCard";
import type { EventsState } from "../types";
import type { SectionErrors } from "../eventSections";
import { currencyCentsFromDraft, currencyDraftFromCents, optionalInteger } from "../utils";

export function TicketingSection({
  advancePriceDraft,
  dayOfPriceDraft,
  editingId,
  event,
  eventStart,
  isPastEvent,
  sectionErrors,
  setAdvancePriceDraft,
  setDayOfPriceDraft,
  setEvent,
  showErrorBadges,
  state,
  tbdInfo,
}: {
  readonly advancePriceDraft: string;
  readonly dayOfPriceDraft: string;
  readonly editingId: string | null;
  readonly event: OrganizationEventRequest;
  readonly eventStart: string;
  readonly isPastEvent: boolean;
  readonly sectionErrors: SectionErrors;
  readonly setAdvancePriceDraft: (value: string) => void;
  readonly setDayOfPriceDraft: (value: string) => void;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly showErrorBadges: boolean;
  readonly state: EventsState;
  readonly tbdInfo: { readonly isTbd: boolean };
}) {
  return (
    <TabsContent
      aria-labelledby="event-editor-tickets-tab"
      className="event-editor-panel"
      id="event-editor-tickets-panel"
      value="tickets"
    >
      <div className="event-editor-panel__header">
        <div className="event-editor-panel__title-row">
          <h3 className="event-editor-panel__title" id="events-section-tickets-heading">
            Ticket sales
          </h3>
          <span className="event-editor__badge event-editor__badge--optional">Optional</span>
        </div>
        <p className="event-editor-panel__description">
          Prices, capacity, and QR sharing for Performances.
        </p>
      </div>
      <section
        aria-labelledby="events-section-tickets-heading"
        className="event-editor-section event-editor-section--tickets"
        data-section="tickets"
        id="event-editor-section-tickets"
        tabIndex={-1}
      >
        <label className="checkbox-row">
          <input
            checked={event.isTicketingEnabled}
            id="events-page-enable-ticketing"
            onChange={(change) => {
              setEvent((current) => ({
                ...current,
                isTicketingEnabled: change.target.checked,
              }));
            }}
            type="checkbox"
          />
          Enable ticket sales
        </label>
        {event.isTicketingEnabled ? (
          <div className="form-grid">
            {isPastEvent ? (
              <p className="notice notice--warning form-grid__wide" role="alert">
                <strong>Ticket sales inactive:</strong> This performance date has already passed.
                Ticket sales will remain closed to the public until the event date is set to a
                future date and time.
              </p>
            ) : null}
            {!event.publishOnWebsite ? (
              <p className="notice notice--info form-grid__wide" role="status">
                <strong>Unpublished on public website:</strong> &quot;Publish on public
                website&quot; is unchecked. This event will not appear on the public concert
                schedule. Buyers will only be able to access tickets via direct link or QR code once
                ticket sales are open.
              </p>
            ) : null}
            {tbdInfo.isTbd ? (
              <p className="notice notice--info form-grid__wide" role="status">
                <strong>TBD venue:</strong> ticket buyers will see “TBD” without a physical address
                or map pin until the actual venue is assigned.
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="events-page-capacity">Ticket capacity</label>
              <input
                id="events-page-capacity"
                min={1}
                onChange={(change) => {
                  setEvent((current) => ({
                    ...current,
                    ticketCapacity: optionalInteger(change.target.value),
                  }));
                }}
                type="number"
                value={event.ticketCapacity ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="events-page-advance-price">Advance price (USD)</label>
              <input
                id="events-page-advance-price"
                inputMode="decimal"
                onChange={(change) => {
                  setAdvancePriceDraft(change.target.value);
                }}
                onBlur={() => {
                  const cents = currencyCentsFromDraft(advancePriceDraft);
                  setAdvancePriceDraft(currencyDraftFromCents(cents));
                  setEvent((current) => ({ ...current, advancePriceCents: cents }));
                }}
                step="0.01"
                type="text"
                value={advancePriceDraft}
              />
            </div>
            <div className="field">
              <label htmlFor="events-page-day-price">Day-of price (USD)</label>
              <input
                id="events-page-day-price"
                inputMode="decimal"
                onChange={(change) => {
                  setDayOfPriceDraft(change.target.value);
                }}
                onBlur={() => {
                  const cents = currencyCentsFromDraft(dayOfPriceDraft);
                  setDayOfPriceDraft(currencyDraftFromCents(cents));
                  setEvent((current) => ({ ...current, dayOfPriceCents: cents }));
                }}
                step="0.01"
                type="text"
                value={dayOfPriceDraft}
              />
            </div>
            {state.status === "ready" ? (
              <p className="ticketing-price-note" role="status">
                {dayOfPriceStartLabel(eventStart, state.timezone) ??
                  "Choose an event start to confirm when day-of pricing begins."}
              </p>
            ) : null}
            {sectionErrors.tickets.length > 0 && showErrorBadges ? (
              <p className="notice notice--error form-grid__wide" role="alert">
                {sectionErrors.tickets[0]}
              </p>
            ) : null}
            <fieldset className="event-ticketing-links">
              <legend>Ticket page and QR code</legend>
              <p className="field-help">
                Share the ticket page with your audience or download its QR code for printed
                programs and signs.
              </p>
              {editingId ? (
                <>
                  <QRCodeShareCard
                    description={`Tickets for ${event.title}.`}
                    path={`/tickets/${editingId}`}
                    title={`${event.title} tickets`}
                  />
                  {isPastEvent ? (
                    <p className="notice notice--warning" role="alert">
                      Ticket sales are currently closed for this link because the event date has
                      passed. Set a future date above to reopen sales.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="ticketing-price-note" role="status">
                  Save this Performance to generate its ticket page and QR code.
                </p>
              )}
            </fieldset>
          </div>
        ) : null}
      </section>
    </TabsContent>
  );
}
