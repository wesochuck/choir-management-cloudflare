import type { OrganizationEventRequest, OrganizationProfile } from "@choir/contracts";
import { NumberInput, TabsContent } from "@choir/ui";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";

import { listOrganizationProfiles } from "../../../../api";
import { EventRsvpDeadlineNotice } from "../shared";
import type { EventsState } from "../types";
import type { SectionErrors } from "../eventSections";
import { readRsvpFollowUpMode } from "../utils";

function readOtherEventRsvpMode(value: string): "off" | "optional" | "response_requested" {
  if (value === "optional" || value === "response_requested") {
    return value;
  }
  return "off";
}

interface RsvpSectionProps {
  readonly event: OrganizationEventRequest;
  readonly followUpEnabled: boolean;
  readonly followUpLeadHours: number | null;
  readonly sectionErrors: SectionErrors;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly showErrorBadges: boolean;
  readonly state: EventsState;
}

function TargetedAudiencePicker({
  activeProfiles,
  availableVoiceParts,
  deduplicatedCount,
  setEvent,
  targetedProfileIds,
  targetedVoiceParts,
}: {
  readonly activeProfiles: readonly OrganizationProfile[];
  readonly availableVoiceParts: readonly string[];
  readonly deduplicatedCount: number;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly targetedProfileIds: readonly string[];
  readonly targetedVoiceParts: readonly string[];
}) {
  return (
    <div className="targeted-audience-picker">
      <div className="field">
        <label className="field-label" htmlFor="events-page-targeted-voice-parts">
          Voice parts
        </label>
        <div className="checkbox-grid" id="events-page-targeted-voice-parts">
          {availableVoiceParts.map((vp) => (
            <label className="checkbox-row" key={vp}>
              <input
                checked={targetedVoiceParts.includes(vp)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...targetedVoiceParts, vp]
                    : targetedVoiceParts.filter((item) => item !== vp);
                  setEvent((current) => ({
                    ...current,
                    otherEventAudience: {
                      profileIds: [...targetedProfileIds],
                      type: "targeted",
                      voiceParts: next,
                    },
                  }));
                }}
                type="checkbox"
              />
              {vp}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="events-page-targeted-members">
          Specific members
        </label>
        <div
          className="checkbox-list"
          id="events-page-targeted-members"
          style={{ maxHeight: "200px", overflowY: "auto" }}
        >
          {activeProfiles.map((p) => (
            <label className="checkbox-row" key={p.id}>
              <input
                checked={targetedProfileIds.includes(p.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...targetedProfileIds, p.id]
                    : targetedProfileIds.filter((item) => item !== p.id);
                  setEvent((current) => ({
                    ...current,
                    otherEventAudience: {
                      profileIds: next,
                      type: "targeted",
                      voiceParts: [...targetedVoiceParts],
                    },
                  }));
                }}
                type="checkbox"
              />
              {p.displayName} {p.voicePart ? `(${p.voicePart})` : ""}
            </label>
          ))}
        </div>
      </div>
      <p className="notice notice--info" role="status">
        <strong>{deduplicatedCount}</strong> {deduplicatedCount === 1 ? "member" : "members"}{" "}
        selected in targeted audience
      </p>
    </div>
  );
}

function OtherEventRsvpPanel({
  event,
  sectionErrors,
  setEvent,
  showErrorBadges,
  state,
}: RsvpSectionProps) {
  const [profiles, setProfiles] = useState<readonly OrganizationProfile[]>([]);

  useEffect(() => {
    let active = true;
    void listOrganizationProfiles()
      .then((loaded) => {
        if (active) setProfiles(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const activeProfiles = useMemo(() => {
    return profiles.filter((p) => p.globalStatus === "Active");
  }, [profiles]);

  const availableVoiceParts = useMemo(() => {
    const defaultParts = ["S1", "S2", "A1", "A2", "T1", "T2", "B1", "B2"];
    const set = new Set(defaultParts);
    for (const p of activeProfiles) {
      if (p.voicePart.trim()) set.add(p.voicePart.trim());
    }
    return Array.from(set);
  }, [activeProfiles]);

  const targetedVoiceParts = useMemo(() => {
    return event.otherEventAudience?.type === "targeted"
      ? (event.otherEventAudience.voiceParts ?? [])
      : [];
  }, [event.otherEventAudience]);

  const targetedProfileIds = useMemo(() => {
    return event.otherEventAudience?.type === "targeted"
      ? (event.otherEventAudience.profileIds ?? [])
      : [];
  }, [event.otherEventAudience]);

  const deduplicatedCount = useMemo(() => {
    if (event.otherEventAudience?.type !== "targeted") {
      return activeProfiles.length;
    }
    const matched = new Set<string>();
    for (const p of activeProfiles) {
      if (targetedProfileIds.includes(p.id)) {
        matched.add(p.id);
      } else if (p.voicePart && targetedVoiceParts.includes(p.voicePart)) {
        matched.add(p.id);
      }
    }
    return matched.size;
  }, [activeProfiles, event.otherEventAudience, targetedProfileIds, targetedVoiceParts]);

  return (
    <TabsContent
      aria-labelledby="event-editor-rsvp-tab"
      className="event-editor-panel"
      id="event-editor-rsvp-panel"
      value="rsvp"
    >
      <div className="event-editor-panel__header">
        <div className="event-editor-panel__title-row">
          <h3 className="event-editor-panel__title">RSVPs &amp; volunteers</h3>
          <span className="event-editor__badge event-editor__badge--optional">Optional</span>
        </div>
        <p className="event-editor-panel__description">
          Configure member volunteering, invitations, and staffing goals.
        </p>
      </div>

      <div className="field">
        <label htmlFor="events-page-other-rsvp-mode">RSVP mode</label>
        <select
          id="events-page-other-rsvp-mode"
          onChange={(change) => {
            const mode = readOtherEventRsvpMode(change.target.value);
            setEvent((current) => ({
              ...current,
              otherEventRsvpMode: mode,
              otherEventStaffingGoal: mode === "off" ? null : current.otherEventStaffingGoal,
            }));
          }}
          value={event.otherEventRsvpMode ?? "off"}
        >
          <option value="off">Off (informational only)</option>
          <option value="optional">Optional (open volunteering)</option>
          <option value="response_requested">Response requested (targeted invitations)</option>
        </select>
        <span className="field-help">
          {event.otherEventRsvpMode === "off"
            ? "Event is displayed on calendars with no RSVP or volunteering actions."
            : event.otherEventRsvpMode === "optional"
              ? "Any member can volunteer to help using 'I can help'."
              : "Invited audience will be requested to respond Yes or No. Uninvited members can still volunteer."}
        </span>
      </div>

      {event.otherEventRsvpMode !== "off" ? (
        <div className="field">
          <label htmlFor="events-page-other-staffing-goal">Minimum staffing goal</label>
          <NumberInput
            id="events-page-other-staffing-goal"
            max={10000}
            min={1}
            onChange={(change) => {
              const val = change.target.value;
              const parsed = val === "" ? null : Number.parseInt(val, 10);
              setEvent((current) => ({
                ...current,
                otherEventStaffingGoal: parsed && parsed > 0 ? parsed : null,
              }));
            }}
            placeholder="e.g. 8"
            value={event.otherEventStaffingGoal ?? ""}
          />
          <span className="field-help">
            Optional. When set, singers will see volunteer progress towards this goal (e.g. 6 of 8
            helpers committed).
          </span>
        </div>
      ) : null}

      <fieldset className="field">
        <legend>Audience</legend>
        <div className="radio-group">
          <label className="radio-row" htmlFor="events-page-audience-everyone">
            <input
              checked={event.otherEventAudience?.type !== "targeted"}
              id="events-page-audience-everyone"
              name="otherEventAudienceType"
              onChange={() => {
                setEvent((current) => ({
                  ...current,
                  otherEventAudience: { type: "everyone" },
                }));
              }}
              type="radio"
              value="everyone"
            />
            Everyone (all active members)
          </label>
          <label className="radio-row" htmlFor="events-page-audience-targeted">
            <input
              checked={event.otherEventAudience?.type === "targeted"}
              id="events-page-audience-targeted"
              name="otherEventAudienceType"
              onChange={() => {
                setEvent((current) => ({
                  ...current,
                  otherEventAudience: {
                    profileIds: current.otherEventAudience?.profileIds ?? [],
                    type: "targeted",
                    voiceParts: current.otherEventAudience?.voiceParts ?? [],
                  },
                }));
              }}
              type="radio"
              value="targeted"
            />
            Targeted audience (select voice parts or specific members)
          </label>
        </div>
      </fieldset>

      {event.otherEventAudience?.type === "targeted" ? (
        <TargetedAudiencePicker
          activeProfiles={activeProfiles}
          availableVoiceParts={availableVoiceParts}
          deduplicatedCount={deduplicatedCount}
          setEvent={setEvent}
          targetedProfileIds={targetedProfileIds}
          targetedVoiceParts={targetedVoiceParts}
        />
      ) : (
        <p className="field-help">All {activeProfiles.length} active members are included.</p>
      )}

      {sectionErrors.rsvp.length > 0 && showErrorBadges ? (
        <p className="notice notice--error" role="alert">
          {sectionErrors.rsvp[0]}
        </p>
      ) : null}

      <OtherEventReminderEmailFieldset event={event} setEvent={setEvent} state={state} />
    </TabsContent>
  );
}

function OtherEventReminderEmailFieldset({
  event,
  setEvent,
  state,
}: {
  readonly event: OrganizationEventRequest;
  readonly setEvent: Dispatch<SetStateAction<OrganizationEventRequest>>;
  readonly state: EventsState;
}) {
  if (event.otherEventRsvpMode !== "response_requested") {
    return null;
  }
  return (
    <fieldset>
      <legend>Automated RSVP reminder email</legend>
      <p className="field-help">
        When enabled, the background scheduler automatically sends an RSVP reminder to invited
        singers who have not responded. Singers who opted out of Other Event reminders will be
        automatically excluded.
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
          <option value="enabled">Enable for this Event</option>
          <option value="disabled">Disable for this Event</option>
        </select>
      </label>
      {event.rsvpFollowUpMode === "enabled" ? (
        <label className="field" htmlFor="events-page-rsvp-follow-up-hours">
          Hours before event start *
          <NumberInput
            id="events-page-rsvp-follow-up-hours"
            max={720}
            min={1}
            onChange={(change) => {
              setEvent((current) => ({
                ...current,
                rsvpFollowUpLeadHours: Math.max(1, Math.min(720, Number(change.target.value) || 1)),
              }));
            }}
            value={event.rsvpFollowUpLeadHours ?? 48}
          />
        </label>
      ) : null}
    </fieldset>
  );
}

function PerformanceRsvpPanel({
  event,
  followUpEnabled,
  followUpLeadHours,
  sectionErrors,
  setEvent,
  showErrorBadges,
  state,
}: RsvpSectionProps) {
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
              max={720}
              min={1}
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

export function RsvpSection(props: RsvpSectionProps) {
  if (props.event.type === "Other") {
    return <OtherEventRsvpPanel {...props} />;
  }
  return <PerformanceRsvpPanel {...props} />;
}
