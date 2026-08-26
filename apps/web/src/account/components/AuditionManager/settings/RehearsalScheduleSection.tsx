import {
  dayOfWeekSchema,
  type DayOfWeek,
  type OrganizationAuditionSettings,
  type OrganizationVenue,
} from "@choir/contracts";
import { timeInputStateValue } from "../utils";
import { capitalizeDay, formatTime12h } from "./utils";

export function RegularRehearsalScheduleSection({
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
