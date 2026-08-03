import { useState } from "react";
import type {
  OrganizationEvent,
  OrganizationAuditionSettings,
  OrganizationVenue,
} from "@choir/contracts";
import { AuthApiError } from "../../../auth/api";

import { formatDate, dateInputStateValue, timeInputStateValue, slotUtcValue } from "./utils";

import type { AdministratorRecipient } from "./types";

const DEFAULT_SLOT_START = "18:00";
const DEFAULT_SLOT_END = "20:00";

export function SettingsForm({
  administratorRecipients,
  initial,
  onCancel,
  onSave,
  performances,
  timezone,
  venues,
}: {
  readonly administratorRecipients: readonly AdministratorRecipient[];
  readonly initial: OrganizationAuditionSettings;
  readonly onCancel: () => void;
  readonly onSave: (settings: OrganizationAuditionSettings) => Promise<void>;
  readonly performances: readonly OrganizationEvent[];
  readonly timezone: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotStart, setSlotStart] = useState(DEFAULT_SLOT_START);
  const [slotEnd, setSlotEnd] = useState(DEFAULT_SLOT_END);
  const [slotDate, setSlotDate] = useState("");
  const [slotInterval, setSlotInterval] = useState("15");
  const [slotError, setSlotError] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");

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
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.venueId) {
          setError("Choose an Organization venue for the auditions before saving.");
          return;
        }
        setBusy(true);
        setError(null);
        onSave(draft)
          .catch((caught: unknown) => {
            setError(
              caught instanceof AuthApiError
                ? caught.message
                : "Audition settings could not be saved. Check the target Performance and time slots, then try again.",
            );
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <label className="checkbox-field">
        <input
          checked={draft.enabled}
          type="checkbox"
          onChange={(event) => {
            setDraft((current) => ({ ...current, enabled: event.target.checked }));
          }}
        />{" "}
        Accept public audition requests
      </label>
      <label className="field">
        Target Performance
        <select
          value={draft.defaultPerformanceId ?? ""}
          onChange={(event) => {
            setDraft((current) => ({
              ...current,
              defaultPerformanceId: event.target.value || null,
            }));
          }}
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
          value={draft.venueId ?? ""}
          onChange={(event) => {
            setError(null);
            setDraft((current) => ({
              ...current,
              venueId: event.target.value || null,
            }));
          }}
        >
          <option value="">Choose a venue</option>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
        <span className="field-help">Choose where these audition time slots will take place.</span>
      </label>
      <div className="field">
        <label htmlFor="audition-public-confirmation-message">
          Public form confirmation message
        </label>
        <textarea
          id="audition-public-confirmation-message"
          rows={3}
          value={draft.confirmationMessage}
          onChange={(event) => {
            setDraft((current) => ({ ...current, confirmationMessage: event.target.value }));
          }}
        />
        <span className="field-help">
          This is the message shown on the public form after someone submits. Automated audition
          emails are managed as system templates in Communications.
        </span>
        <a className="text-button" href="/admin/communications?tab=templates">
          Edit audition email templates
        </a>
      </div>
      <fieldset className="form-stack">
        <legend>Audition time slots</legend>
        <div className="form-grid form-grid--compact">
          <label className="field">
            Date for time slots
            <input
              type="date"
              value={slotDate}
              onChange={(event) => {
                setSlotError(null);
                setSlotDate(dateInputStateValue(event.currentTarget));
              }}
            />
          </label>
          <label className="field">
            Interval (minutes)
            <input
              min="5"
              max="240"
              step="5"
              type="number"
              value={slotInterval}
              onChange={(event) => {
                setSlotError(null);
                setSlotInterval(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="form-grid form-grid--compact">
          <label className="field">
            Start time
            <input
              aria-label="Audition slot start time"
              step="900"
              type="time"
              value={slotStart}
              onChange={(event) => {
                setSlotError(null);
                setSlotStart(timeInputStateValue(event.currentTarget));
              }}
            />
          </label>
          <label className="field">
            End time
            <input
              aria-label="Audition slot end time"
              step="900"
              type="time"
              value={slotEnd}
              onChange={(event) => {
                setSlotError(null);
                setSlotEnd(timeInputStateValue(event.currentTarget));
              }}
            />
          </label>
        </div>
        <p className="field-help">
          Use the clock controls to choose a time. New slot ranges start at 6:00 PM and end at 8:00
          PM in {timezone}; adjust them before generating or adding slots.
        </p>
        {slotError ? (
          <p className="notice notice--error" role="alert">
            {slotError}
          </p>
        ) : null}
        <button className="button button--secondary" onClick={generateSlots} type="button">
          Generate slots
        </button>
        <button className="button button--secondary" onClick={addSlot} type="button">
          Add time slot
        </button>
        {draft.slots.length > 0 ? (
          <ul className="account-list">
            {draft.slots.map((slot) => (
              <li
                className="flex items-center justify-between gap-2"
                key={slot.id ?? slot.startsAt}
              >
                <span>{formatDate(slot.startsAt)}</span>
                <button
                  className="text-button text-button--danger"
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      slots: current.slots.filter(
                        (candidate) => candidate.startsAt !== slot.startsAt,
                      ),
                    }));
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
      <fieldset className="form-stack">
        <legend>Administrator notifications</legend>
        <label className="checkbox-field">
          <input
            checked={draft.adminNotifyEnabled}
            type="checkbox"
            onChange={(event) => {
              setDraft((current) => ({ ...current, adminNotifyEnabled: event.target.checked }));
            }}
          />
          Notify administrators when an inquiry arrives
        </label>
        {draft.adminNotifyEnabled ? (
          <>
            <fieldset className="form-stack">
              <legend>Roster administrators</legend>
              <p className="field-help">
                Select linked Organization owners and administrators. A Profile must allow
                administrator notifications to receive audition emails.
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
                            toggleAdministrator(recipient, event.target.checked);
                          }}
                          type="checkbox"
                        />
                        <span>
                          {recipient.profile.displayName} · {recipient.email}
                          <small className="field-help">
                            {!eligible
                              ? "Audition emails disabled in this Profile"
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
            <div className="form-actions">
              <input
                aria-label="Administrator notification email"
                placeholder="Additional email address (optional)"
                type="email"
                value={recipientEmail}
                onChange={(event) => {
                  setRecipientEmail(event.target.value);
                }}
              />
              <button className="button button--secondary" onClick={addRecipient} type="button">
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
                        setDraft((current) => ({
                          ...current,
                          adminNotifyUsers: current.adminNotifyUsers.filter(
                            (candidate) => candidate !== email,
                          ),
                        }));
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notice">Select at least one administrator or add an email address.</p>
            )}
          </>
        ) : null}
      </fieldset>
      <div className="form-actions">
        <button className="button button--secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="button button--primary"
          disabled={busy || draft.slots.length === 0}
          type="submit"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
