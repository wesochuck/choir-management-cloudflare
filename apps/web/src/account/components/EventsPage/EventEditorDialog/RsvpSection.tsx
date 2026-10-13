import type { OrganizationEventRequest } from "@choir/contracts";
import { NumberInput, TabsContent } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";

import { EventRsvpDeadlineNotice } from "../shared";
import type { EventsState } from "../types";
import type { SectionErrors } from "../eventSections";
import { readRsvpFollowUpMode } from "../utils";

export function RsvpSection({
  event,
  followUpEnabled,
  followUpLeadHours,
  sectionErrors,
  setEvent,
  showErrorBadges,
  state,
}: {
  readonly event: OrganizationEventRequest;
  readonly followUpEnabled: boolean;
  readonly followUpLeadHours: number | null;
  readonly sectionErrors: SectionErrors;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly showErrorBadges: boolean;
  readonly state: EventsState;
}) {
  return (
    <TabsContent
      aria-labelledby="event-editor-rsvp-tab"
      className="event-editor-panel"
      id="event-editor-rsvp-panel"
      value="rsvp"
    >
      <div className="event-editor-panel__header">
        <div className="event-editor-panel__title-row">
          <h3 className="event-editor-panel__title">RSVPs &amp; reminders</h3>
          <span className="event-editor__badge event-editor__badge--required">
            Required section
          </span>
        </div>
        <p className="event-editor-panel__description">
          Deadline and automated follow-up for Performances.
        </p>
      </div>
      <div className="field">
        <label htmlFor="events-page-rsvp-deadline">Member RSVP deadline *</label>
        <input
          id="events-page-rsvp-deadline"
          onChange={(change) => {
            setEvent((current) => ({
              ...current,
              rsvpDeadlineDate: change.target.value || null,
            }));
          }}
          required
          type="date"
          value={event.rsvpDeadlineDate ?? ""}
        />
      </div>
      <EventRsvpDeadlineNotice
        deadlineDate={event.rsvpDeadlineDate}
        eventType={event.type}
        state={state}
      />
      {sectionErrors.rsvp.length > 0 && showErrorBadges ? (
        <p className="notice notice--error" role="alert">
          {sectionErrors.rsvp[0]}
        </p>
      ) : null}
      <fieldset>
        <legend>Automated pending RSVP email</legend>
        <p className="field-help">
          This email is not launched by saving the event. When enabled, the background scheduler
          automatically queues one message{" "}
          {followUpLeadHours ? `${String(followUpLeadHours)} hours` : "at the configured lead time"}{" "}
          before the RSVP deadline, only for active Performers still marked Pending. No separate
          draft or send button is required.
        </p>
        <label className="field" htmlFor="events-page-rsvp-follow-up-mode">
          Event setting
          <select
            id="events-page-rsvp-follow-up-mode"
            onChange={(change) => {
              const mode = readRsvpFollowUpMode(change.target.value);
              setEvent((current) => ({
                ...current,
                rsvpFollowUpLeadHours:
                  mode === "enabled" ? (current.rsvpFollowUpLeadHours ?? 48) : null,
                rsvpFollowUpMode: mode,
              }));
            }}
            value={event.rsvpFollowUpMode}
          >
            <option value="inherit">
              Use Organization default (
              {state.status === "ready" && state.rsvpFollowUpEnabled ? "enabled" : "disabled"})
            </option>
            <option value="enabled">Enable for this Performance</option>
            <option value="disabled">Disable for this Performance</option>
          </select>
        </label>
        {event.rsvpFollowUpMode === "enabled" ? (
          <label className="field" htmlFor="events-page-rsvp-follow-up-hours">
            Hours before deadline *
            <NumberInput
              id="events-page-rsvp-follow-up-hours"
              min={1}
              max={720}
              onChange={(change) => {
                setEvent((current) => ({
                  ...current,
                  rsvpFollowUpLeadHours: Math.max(
                    1,
                    Math.min(720, Number(change.target.value) || 1),
                  ),
                }));
              }}
              value={event.rsvpFollowUpLeadHours ?? 48}
            />
          </label>
        ) : null}
        <p className={followUpEnabled ? "notice notice--info" : "notice notice--warning"}>
          <strong>{followUpEnabled ? "Automatic delivery:" : "Automatic delivery is off:"}</strong>{" "}
          {followUpEnabled
            ? "After the next scheduler pass, this send will appear in Communications → Upcoming sends."
            : "Enable this Performance or the Organization default to schedule the follow-up."}
        </p>
        <div className="button-row">
          <a
            className="button button--secondary button--small"
            href="/admin/communications?tab=templates"
          >
            Edit RSVP email template
          </a>
          {followUpEnabled ? (
            <a
              className="button button--secondary button--small"
              href="/admin/communications?tab=upcoming"
            >
              View upcoming sends
            </a>
          ) : null}
        </div>
      </fieldset>
    </TabsContent>
  );
}
