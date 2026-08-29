import type { OrganizationAuditionSettings } from "@choir/contracts";
import { dateInputStateValue, formatDate, timeInputStateValue } from "../utils";

export function AuditionSlotsSection({
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
    <fieldset className="surface-card organization-settings-panel form-stack">
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
