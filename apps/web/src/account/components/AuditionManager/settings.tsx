import { useEffect, useState } from "react";
import {
  dayOfWeekSchema,
  type DayOfWeek,
  type OrganizationEvent,
  type OrganizationAuditionSettings,
  type OrganizationVenue,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { AuthApiError, createOrganizationVenue } from "../../../auth/api";
import { useFloatingSaveAction } from "../../useFloatingSaveAction";

import { formatDate, dateInputStateValue, timeInputStateValue, slotUtcValue } from "./utils";

import type { AdministratorRecipient } from "./types";

const DEFAULT_SLOT_START = "18:00";
const DEFAULT_SLOT_END = "20:00";
const DEFAULT_REHEARSAL_START = "19:00";
const DEFAULT_REHEARSAL_END = "21:30";

function formatTime12h(timeStr: string): string {
  if (!timeStr) return "";
  const [hoursStr, minutesStr] = timeStr.split(":");
  const hours = parseInt(hoursStr ?? "0", 10);
  const minutes = parseInt(minutesStr ?? "0", 10);
  if (Number.isNaN(hours)) return timeStr;
  const period = hours >= 12 ? "PM" : "AM";
  const formattedHours = String(hours % 12 === 0 ? 12 : hours % 12);
  const formattedMinutes = minutes < 10 ? `0${String(minutes)}` : String(minutes);
  return `${formattedHours}:${formattedMinutes} ${period}`;
}

function capitalizeDay(day: string): string {
  if (!day) return "";
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function auditionSettingsKey(settings: OrganizationAuditionSettings): string {
  return JSON.stringify(settings);
}

function RegularRehearsalScheduleSection({
  draft,
  onAddSession,
  onAddVenue,
  onRemoveSession,
  onUpdateNotes,
  onUpdateStartDate,
  rehearsalDay,
  rehearsalEnd,
  rehearsalError,
  rehearsalStart,
  rehearsalVenueId,
  setRehearsalDay,
  setRehearsalEnd,
  setRehearsalStart,
  setRehearsalVenueId,
  venues,
}: {
  readonly draft: OrganizationAuditionSettings;
  readonly onAddSession: () => void;
  readonly onAddVenue: () => void;
  readonly onRemoveSession: (index: number) => void;
  readonly onUpdateNotes: (notes: string) => void;
  readonly onUpdateStartDate: (date: string | null) => void;
  readonly rehearsalDay: DayOfWeek;
  readonly rehearsalEnd: string;
  readonly rehearsalError: string | null;
  readonly rehearsalStart: string;
  readonly rehearsalVenueId: string;
  readonly setRehearsalDay: (day: DayOfWeek) => void;
  readonly setRehearsalEnd: (val: string) => void;
  readonly setRehearsalStart: (val: string) => void;
  readonly setRehearsalVenueId: (val: string) => void;
  readonly venues: readonly OrganizationVenue[];
}) {
  const venueNamesById = new Map(venues.map(({ id, name }) => [id, name]));

  return (
    <fieldset className="form-stack">
      <legend>Regular Rehearsal Schedule</legend>
      <label className="field">
        Start Date / First Rehearsal Date
        <input
          onChange={(e) => {
            onUpdateStartDate(e.target.value ? e.target.value : null);
          }}
          type="date"
          value={draft.startDate ?? ""}
        />
        <span className="field-help">
          Optional date for the group&apos;s first rehearsal or the next open rehearsal.
        </span>
      </label>
      <p className="field-help">
        Set when rehearsals start and end, then choose the official Organization venue where they
        happen.
      </p>
      <div className="form-grid form-grid--compact audition-rehearsal-grid">
        <label className="field">
          Day of week
          <select
            onChange={(e) => {
              const parsed = dayOfWeekSchema.safeParse(e.target.value);
              if (parsed.success) setRehearsalDay(parsed.data);
            }}
            value={rehearsalDay}
          >
            <option value="monday">Monday</option>
            <option value="tuesday">Tuesday</option>
            <option value="wednesday">Wednesday</option>
            <option value="thursday">Thursday</option>
            <option value="friday">Friday</option>
            <option value="saturday">Saturday</option>
            <option value="sunday">Sunday</option>
          </select>
        </label>
        <label className="field">
          Start time
          <input
            onChange={(e) => {
              setRehearsalStart(timeInputStateValue(e.currentTarget));
            }}
            type="time"
            value={rehearsalStart}
          />
        </label>
        <label className="field">
          End time
          <input
            onChange={(e) => {
              setRehearsalEnd(timeInputStateValue(e.currentTarget));
            }}
            type="time"
            value={rehearsalEnd}
          />
        </label>
        <label className="field">
          Rehearsal venue
          <select
            aria-required="true"
            id="intake-rehearsal-venue"
            onChange={(e) => {
              setRehearsalVenueId(e.target.value);
            }}
            value={rehearsalVenueId}
          >
            <option value="">Choose an Organization venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
                {venue.address ? ` — ${venue.address}` : ""}
              </option>
            ))}
          </select>
          <span className="field-help">
            Use a venue from the official Organization list.{" "}
            <button className="text-button" onClick={onAddVenue} type="button">
              Add a new venue
            </button>
          </span>
        </label>
      </div>
      {rehearsalError ? (
        <p className="notice notice--error" role="alert">
          {rehearsalError}
        </p>
      ) : null}
      <button className="button button--secondary" onClick={onAddSession} type="button">
        Add regular rehearsal day
      </button>
      {draft.rehearsalSchedule.length > 0 ? (
        <ul className="account-list">
          {draft.rehearsalSchedule.map((session, index) => (
            <li className="flex items-center justify-between gap-2" key={index}>
              <span>
                <strong>Every {capitalizeDay(session.dayOfWeek)}</strong> from{" "}
                {formatTime12h(session.startTime)} to {formatTime12h(session.endTime)}
                {session.venueId
                  ? ` · ${venueNamesById.get(session.venueId) ?? "Selected venue"}`
                  : session.locationName
                    ? ` · ${session.locationName}`
                    : ""}
              </span>
              <button
                className="text-button text-button--danger"
                onClick={() => {
                  onRemoveSession(index);
                }}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notice">No regular rehearsal schedule added yet.</p>
      )}

      <div className="field">
        <label htmlFor="intake-rehearsal-notes">Rehearsal & Season Notes (optional)</label>
        <textarea
          id="intake-rehearsal-notes"
          onChange={(e) => {
            onUpdateNotes(e.target.value);
          }}
          placeholder="e.g. Season runs from September through May. We welcome all voice types!"
          rows={3}
          value={draft.rehearsalNotes}
        />
        <span className="field-help">Displayed to prospective members alongside the schedule.</span>
      </div>
    </fieldset>
  );
}

function AuditionSlotsSection({
  addSlot,
  draft,
  generateSlots,
  onRemoveSlot,
  setSlotDate,
  setSlotEnd,
  setSlotInterval,
  setSlotStart,
  slotDate,
  slotEnd,
  slotError,
  slotInterval,
  slotStart,
  timezone,
}: {
  readonly addSlot: () => void;
  readonly draft: OrganizationAuditionSettings;
  readonly generateSlots: () => void;
  readonly onRemoveSlot: (startsAt: string) => void;
  readonly setSlotDate: (date: string) => void;
  readonly setSlotEnd: (time: string) => void;
  readonly setSlotInterval: (interval: string) => void;
  readonly setSlotStart: (time: string) => void;
  readonly slotDate: string;
  readonly slotEnd: string;
  readonly slotError: string | null;
  readonly slotInterval: string;
  readonly slotStart: string;
  readonly timezone: string;
}) {
  return (
    <fieldset className="form-stack">
      <legend>Audition time slots</legend>
      <div className="form-grid form-grid--compact">
        <label className="field">
          Date for time slots
          <input
            onChange={(event) => {
              setSlotDate(dateInputStateValue(event.currentTarget));
            }}
            type="date"
            value={slotDate}
          />
        </label>
        <label className="field">
          Interval (minutes)
          <input
            max="240"
            min="5"
            onChange={(event) => {
              setSlotInterval(event.target.value);
            }}
            step="5"
            type="number"
            value={slotInterval}
          />
        </label>
      </div>
      <div className="form-grid form-grid--compact">
        <label className="field">
          Start time
          <input
            aria-label="Audition slot start time"
            onChange={(event) => {
              setSlotStart(timeInputStateValue(event.currentTarget));
            }}
            step="900"
            type="time"
            value={slotStart}
          />
        </label>
        <label className="field">
          End time
          <input
            aria-label="Audition slot end time"
            onChange={(event) => {
              setSlotEnd(timeInputStateValue(event.currentTarget));
            }}
            step="900"
            type="time"
            value={slotEnd}
          />
        </label>
      </div>
      <p className="field-help">
        Use the clock controls to choose a time. New slot ranges start at 6:00 PM and end at 8:00 PM
        in {timezone}; adjust them before generating or adding slots.
      </p>
      {slotError ? (
        <p className="notice notice--error" role="alert">
          {slotError}
        </p>
      ) : null}
      <div className="form-actions">
        <button className="button button--secondary" onClick={generateSlots} type="button">
          Generate slots
        </button>
        <button className="button button--secondary" onClick={addSlot} type="button">
          Add time slot
        </button>
      </div>
      {draft.slots.length > 0 ? (
        <ul className="account-list">
          {draft.slots.map((slot) => (
            <li className="flex items-center justify-between gap-2" key={slot.id ?? slot.startsAt}>
              <span>{formatDate(slot.startsAt)}</span>
              <button
                className="text-button text-button--danger"
                onClick={() => {
                  onRemoveSlot(slot.startsAt);
                }}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notice">Add at least one slot before opening requests.</p>
      )}
    </fieldset>
  );
}

function AdminNotificationsSection({
  administratorRecipients,
  draft,
  onAddRecipient,
  onRemoveRecipient,
  onToggleAdminNotify,
  onToggleAdministrator,
  recipientEmail,
  setRecipientEmail,
}: {
  readonly administratorRecipients: readonly AdministratorRecipient[];
  readonly draft: OrganizationAuditionSettings;
  readonly onAddRecipient: () => void;
  readonly onRemoveRecipient: (email: string) => void;
  readonly onToggleAdminNotify: (enabled: boolean) => void;
  readonly onToggleAdministrator: (recipient: AdministratorRecipient, checked: boolean) => void;
  readonly recipientEmail: string;
  readonly setRecipientEmail: (email: string) => void;
}) {
  return (
    <fieldset className="form-stack">
      <legend>Administrator notifications</legend>
      <label className="checkbox-field">
        <input
          checked={draft.adminNotifyEnabled}
          onChange={(event) => {
            onToggleAdminNotify(event.target.checked);
          }}
          type="checkbox"
        />
        Notify administrators when an inquiry arrives
      </label>
      {draft.adminNotifyEnabled ? (
        <>
          <fieldset className="form-stack">
            <legend>Roster administrators</legend>
            <p className="field-help">
              Select linked Organization owners and administrators. A Profile must allow
              administrator notifications to receive inquiry emails.
            </p>
            {administratorRecipients.length > 0 ? (
              <div className="form-stack">
                {administratorRecipients.map((recipient) => {
                  const eligible =
                    recipient.profile.receiveAdminNotifications && !recipient.profile.doNotEmail;
                  return (
                    <label className="checkbox-row" key={recipient.profile.id}>
                      <input
                        checked={draft.adminNotifyUsers.includes(recipient.email)}
                        disabled={!eligible}
                        onChange={(event) => {
                          onToggleAdministrator(recipient, event.target.checked);
                        }}
                        type="checkbox"
                      />
                      <span>
                        {recipient.profile.displayName} · {recipient.email}
                        <small className="field-help">
                          {!eligible
                            ? "Emails disabled in this Profile"
                            : recipient.role === "owner"
                              ? "Owner"
                              : "Administrator"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="notice">
                No linked roster administrators are available. Link an owner or administrator to a
                Profile to select them here.
              </p>
            )}
          </fieldset>
          <fieldset className="form-stack">
            <legend>Additional recipients</legend>
            <p className="field-help">
              Add any additional email addresses that should receive inquiry notifications.
            </p>
            <div className="form-actions">
              <input
                aria-label="Administrator notification email"
                onChange={(event) => {
                  setRecipientEmail(event.target.value);
                }}
                placeholder="Additional email address (optional)"
                type="email"
                value={recipientEmail}
              />
              <button className="button button--secondary" onClick={onAddRecipient} type="button">
                Add additional recipient
              </button>
            </div>
            {draft.adminNotifyUsers.length > 0 ? (
              <ul className="account-list">
                {draft.adminNotifyUsers.map((email) => (
                  <li className="flex items-center justify-between gap-2" key={email}>
                    <span>{email}</span>
                    <button
                      className="text-button text-button--danger"
                      onClick={() => {
                        onRemoveRecipient(email);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notice">No additional recipients added.</p>
            )}
          </fieldset>
        </>
      ) : null}
    </fieldset>
  );
}

export function SettingsForm({
  administratorRecipients,
  initial,
  onCancel,
  onDirtyChange,
  onSave,
  onVenueCreated,
  performances,
  timezone,
  venues,
}: {
  readonly administratorRecipients: readonly AdministratorRecipient[];
  readonly initial: OrganizationAuditionSettings;
  readonly onCancel: () => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSave: (settings: OrganizationAuditionSettings) => Promise<void>;
  readonly onVenueCreated: (venue: OrganizationVenue) => void;
  readonly performances: readonly OrganizationEvent[];
  readonly timezone: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  const [draft, setDraft] = useState<OrganizationAuditionSettings>(initial);
  const [savedDraft, setSavedDraft] = useState<OrganizationAuditionSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotStart, setSlotStart] = useState(DEFAULT_SLOT_START);
  const [slotEnd, setSlotEnd] = useState(DEFAULT_SLOT_END);
  const [slotDate, setSlotDate] = useState("");
  const [slotInterval, setSlotInterval] = useState("15");
  const [slotError, setSlotError] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [newVenueAddress, setNewVenueAddress] = useState("");
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueError, setNewVenueError] = useState<string | null>(null);
  const [newVenueBusy, setNewVenueBusy] = useState(false);
  const [newVenueOpen, setNewVenueOpen] = useState(false);

  const [rehearsalDay, setRehearsalDay] = useState<DayOfWeek>("tuesday");
  const [rehearsalStart, setRehearsalStart] = useState(DEFAULT_REHEARSAL_START);
  const [rehearsalEnd, setRehearsalEnd] = useState(DEFAULT_REHEARSAL_END);
  const [rehearsalError, setRehearsalError] = useState<string | null>(null);
  const [rehearsalVenueId, setRehearsalVenueId] = useState("");

  function addSlot() {
    setSlotError(null);
    const startsAt = slotUtcValue(slotDate, slotStart, timezone);
    const endsAt = slotUtcValue(slotDate, slotEnd, timezone);
    if (!startsAt || !endsAt || startsAt >= endsAt) {
      setSlotError(`Enter a valid start and end time in ${timezone}.`);
      return;
    }
    setDraft((current) => ({
      ...current,
      slots: [...current.slots, { endsAt, id: crypto.randomUUID(), startsAt }].toSorted((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
    }));
    setSlotStart(DEFAULT_SLOT_START);
    setSlotEnd(DEFAULT_SLOT_END);
  }

  function generateSlots() {
    setSlotError(null);
    const startsAt = slotUtcValue(slotDate, slotStart, timezone);
    const endsAt = slotUtcValue(slotDate, slotEnd, timezone);
    const intervalMinutes = Number(slotInterval);
    const start = startsAt ? new Date(startsAt) : null;
    const end = endsAt ? new Date(endsAt) : null;
    if (
      !start ||
      !end ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end ||
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < 5 ||
      intervalMinutes > 240
    ) {
      setSlotError(`Enter a valid date, time range, and interval in ${timezone}.`);
      return;
    }
    const slots: { endsAt: string; id: string; startsAt: string }[] = [];
    for (let cursor = start.getTime(); cursor < end.getTime(); cursor += intervalMinutes * 60_000) {
      const next = Math.min(cursor + intervalMinutes * 60_000, end.getTime());
      if (next <= cursor) break;
      slots.push({
        endsAt: new Date(next).toISOString(),
        id: crypto.randomUUID(),
        startsAt: new Date(cursor).toISOString(),
      });
    }
    setDraft((current) => ({
      ...current,
      slots: [...current.slots, ...slots]
        .filter(
          (slot, index, values) =>
            values.findIndex((candidate) => candidate.startsAt === slot.startsAt) === index,
        )
        .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
    }));
  }

  function addRehearsalSession() {
    setRehearsalError(null);
    if (!rehearsalStart || !rehearsalEnd || rehearsalStart >= rehearsalEnd) {
      setRehearsalError("Enter a valid rehearsal start and end time.");
      return;
    }
    const venue = venues.find(({ id }) => id === rehearsalVenueId);
    if (!venue) {
      setRehearsalError("Choose an Organization venue before adding this rehearsal day.");
      return;
    }
    setDraft((current) => ({
      ...current,
      rehearsalSchedule: [
        ...current.rehearsalSchedule,
        {
          dayOfWeek: rehearsalDay,
          endTime: rehearsalEnd,
          locationName: "",
          startTime: rehearsalStart,
          venueId: venue.id,
        },
      ],
    }));
  }

  function openNewVenueDialog() {
    setNewVenueAddress("");
    setNewVenueError(null);
    setNewVenueName("");
    setNewVenueOpen(true);
  }

  async function saveNewVenue() {
    const name = newVenueName.trim();
    const address = newVenueAddress.trim();
    if (!name) {
      setNewVenueError("Enter a venue name.");
      return;
    }
    setNewVenueBusy(true);
    setNewVenueError(null);
    try {
      const venue = await createOrganizationVenue(name, address);
      onVenueCreated(venue);
      setRehearsalVenueId(venue.id);
      setNewVenueOpen(false);
    } catch (caught: unknown) {
      setNewVenueError(
        caught instanceof AuthApiError ? caught.message : "The venue could not be created.",
      );
    } finally {
      setNewVenueBusy(false);
    }
  }

  function addRecipient() {
    const email = recipientEmail.trim().toLowerCase();
    if (!email || !email.includes("@") || draft.adminNotifyUsers.includes(email)) return;
    setDraft((current) => ({
      ...current,
      adminNotifyUsers: [...current.adminNotifyUsers, email],
    }));
    setRecipientEmail("");
  }

  function toggleAdministrator(recipient: AdministratorRecipient, checked: boolean) {
    setDraft((current) => ({
      ...current,
      adminNotifyUsers: checked
        ? [...new Set([...current.adminNotifyUsers, recipient.email])]
        : current.adminNotifyUsers.filter((email) => email !== recipient.email),
    }));
  }

  const isAuditionMode = draft.mode === "audition";
  const dirty = auditionSettingsKey(draft) !== auditionSettingsKey(savedDraft);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => {
      onDirtyChange(false);
    };
  }, [dirty, onDirtyChange]);

  function discardSettings(): void {
    setDraft(savedDraft);
    setError(null);
    setRehearsalError(null);
    setSlotError(null);
  }

  async function saveSettings(): Promise<void> {
    if (isAuditionMode && !draft.venueId) {
      setError("Choose an Organization venue for the auditions before saving.");
      return;
    }
    if (isAuditionMode && draft.slots.length === 0) {
      setError("Add at least one audition time slot before saving.");
      return;
    }
    const payload: OrganizationAuditionSettings = isAuditionMode
      ? draft
      : {
          ...draft,
          defaultPerformanceId: null,
          startDate: draft.startDate ?? null,
          venueId: null,
        };
    setBusy(true);
    setError(null);
    try {
      await onSave(payload);
      setDraft(payload);
      setSavedDraft(payload);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "Audition settings could not be saved. Check the settings and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  useFloatingSaveAction({
    busy: busy || newVenueBusy,
    dirty,
    id: "organization-audition-settings",
    onDiscard: discardSettings,
    onSave: saveSettings,
  });

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <fieldset className="form-stack">
        <legend>Public intake & form</legend>
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              checked={draft.mode === "audition"}
              name="intake-mode"
              onChange={() => {
                setDraft((current) => ({ ...current, mode: "audition" }));
              }}
              type="radio"
              value="audition"
            />
            <div>
              <span className="font-semibold block">Auditions Required</span>
              <span className="text-sm text-muted-foreground block">
                Prospective members must select and schedule a specific audition time slot.
              </span>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              checked={draft.mode === "open_inquiry"}
              name="intake-mode"
              onChange={() => {
                setDraft((current) => ({ ...current, mode: "open_inquiry" }));
              }}
              type="radio"
              value="open_inquiry"
            />
            <div>
              <span className="font-semibold block">Open Interest / No Audition</span>
              <span className="text-sm text-muted-foreground block">
                For non-auditioned groups. Prospective members submit contact info and see your
                regular rehearsal schedule.
              </span>
            </div>
          </label>
        </div>

        <label className="checkbox-field">
          <input
            checked={draft.enabled}
            onChange={(event) => {
              setDraft((current) => ({ ...current, enabled: event.target.checked }));
            }}
            type="checkbox"
          />{" "}
          Accept public inquiries / requests
        </label>

        {isAuditionMode ? (
          <>
            <label className="field">
              Target Performance
              <select
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    defaultPerformanceId: event.target.value || null,
                  }));
                }}
                value={draft.defaultPerformanceId ?? ""}
              >
                <option value="">No performance assigned</option>
                {performances
                  .filter((event) => event.type === "Performance")
                  .map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title} — {formatDate(event.startsAt)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Audition venue
              <select
                aria-required="true"
                onChange={(event) => {
                  setError(null);
                  setDraft((current) => ({
                    ...current,
                    venueId: event.target.value || null,
                  }));
                }}
                value={draft.venueId ?? ""}
              >
                <option value="">Choose a venue</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
              <span className="field-help">
                Choose where these audition time slots will take place.{" "}
                <button className="text-button" onClick={openNewVenueDialog} type="button">
                  Add a new venue
                </button>
              </span>
            </label>
          </>
        ) : null}

        <div className="field">
          <label htmlFor="audition-public-confirmation-message">
            Public form confirmation message
          </label>
          <textarea
            id="audition-public-confirmation-message"
            onChange={(event) => {
              setDraft((current) => ({ ...current, confirmationMessage: event.target.value }));
            }}
            rows={3}
            value={draft.confirmationMessage}
          />
          <span className="field-help">
            This is the message shown on the public form after someone submits. Automated emails are
            managed as system templates in Communications.
          </span>
          <a className="text-button" href="/admin/communications?tab=templates">
            Edit notification email templates
          </a>
        </div>
      </fieldset>

      {isAuditionMode ? (
        <AuditionSlotsSection
          addSlot={addSlot}
          draft={draft}
          generateSlots={generateSlots}
          onRemoveSlot={(startsAt) => {
            setDraft((current) => ({
              ...current,
              slots: current.slots.filter((candidate) => candidate.startsAt !== startsAt),
            }));
          }}
          setSlotDate={(date) => {
            setSlotError(null);
            setSlotDate(date);
          }}
          setSlotEnd={(time) => {
            setSlotError(null);
            setSlotEnd(time);
          }}
          setSlotInterval={(interval) => {
            setSlotError(null);
            setSlotInterval(interval);
          }}
          setSlotStart={(time) => {
            setSlotError(null);
            setSlotStart(time);
          }}
          slotDate={slotDate}
          slotEnd={slotEnd}
          slotError={slotError}
          slotInterval={slotInterval}
          slotStart={slotStart}
          timezone={timezone}
        />
      ) : (
        <RegularRehearsalScheduleSection
          draft={draft}
          onAddSession={addRehearsalSession}
          onAddVenue={openNewVenueDialog}
          onRemoveSession={(index) => {
            setDraft((current) => ({
              ...current,
              rehearsalSchedule: current.rehearsalSchedule.filter((_, i) => i !== index),
            }));
          }}
          onUpdateNotes={(notes) => {
            setDraft((current) => ({ ...current, rehearsalNotes: notes }));
          }}
          onUpdateStartDate={(date) => {
            setDraft((current) => ({ ...current, startDate: date }));
          }}
          rehearsalDay={rehearsalDay}
          rehearsalEnd={rehearsalEnd}
          rehearsalError={rehearsalError}
          rehearsalStart={rehearsalStart}
          rehearsalVenueId={rehearsalVenueId}
          setRehearsalDay={setRehearsalDay}
          setRehearsalEnd={setRehearsalEnd}
          setRehearsalStart={setRehearsalStart}
          setRehearsalVenueId={setRehearsalVenueId}
          venues={venues}
        />
      )}

      <AdminNotificationsSection
        administratorRecipients={administratorRecipients}
        draft={draft}
        onAddRecipient={addRecipient}
        onRemoveRecipient={(email) => {
          setDraft((current) => ({
            ...current,
            adminNotifyUsers: current.adminNotifyUsers.filter((candidate) => candidate !== email),
          }));
        }}
        onToggleAdminNotify={(enabled) => {
          setDraft((current) => ({ ...current, adminNotifyEnabled: enabled }));
        }}
        onToggleAdministrator={toggleAdministrator}
        recipientEmail={recipientEmail}
        setRecipientEmail={setRecipientEmail}
      />

      <div className="form-actions">
        <button className="button button--secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="button button--primary"
          disabled={busy || (isAuditionMode && draft.slots.length === 0)}
          type="submit"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
      <Dialog
        description="Add a venue to the Organization list so rehearsal locations stay consistent across the public site."
        onClose={() => {
          if (!newVenueBusy) setNewVenueOpen(false);
        }}
        open={newVenueOpen}
        title="Add rehearsal venue"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNewVenue();
          }}
        >
          {newVenueError ? (
            <p className="notice notice--error" role="alert">
              {newVenueError}
            </p>
          ) : null}
          <label className="field">
            Venue name
            <input
              autoFocus
              onChange={(event) => {
                setNewVenueName(event.target.value);
              }}
              required
              type="text"
              value={newVenueName}
            />
          </label>
          <label className="field">
            Address (optional)
            <input
              onChange={(event) => {
                setNewVenueAddress(event.target.value);
              }}
              type="text"
              value={newVenueAddress}
            />
          </label>
          <div className="form-actions">
            <button
              className="button button--secondary"
              disabled={newVenueBusy}
              onClick={() => {
                setNewVenueOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={newVenueBusy} type="submit">
              {newVenueBusy ? "Adding…" : "Add venue"}
            </button>
          </div>
        </form>
      </Dialog>
    </form>
  );
}
