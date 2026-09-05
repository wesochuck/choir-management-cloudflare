import type { OrganizationEvent, OrganizationVenue } from "@choir/contracts";
import { Dialog } from "@choir/ui";

import { DAYS_OF_WEEK } from "./utils";

export function BulkRehearsalDialog({
  busy,
  count,
  dayOfWeek,
  error,
  onClose,
  onSubmit,
  open,
  performanceId,
  performances,
  rehearsalTime,
  setCount,
  setDayOfWeek,
  setPerformanceId,
  setRehearsalTime,
  setVenueId,
  venueId,
  venues,
}: {
  readonly busy: boolean;
  readonly count: string;
  readonly dayOfWeek: string;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly open: boolean;
  readonly performanceId: string;
  readonly performances: readonly OrganizationEvent[];
  readonly rehearsalTime: string;
  readonly setCount: (value: string) => void;
  readonly setDayOfWeek: (value: string) => void;
  readonly setPerformanceId: (value: string) => void;
  readonly setRehearsalTime: (value: string) => void;
  readonly setVenueId: (value: string) => void;
  readonly venueId: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  return (
    <Dialog
      description="Quickly generate a series of weekly rehearsals leading up to a performance."
      onClose={onClose}
      open={open}
      title="Bulk add rehearsals"
    >
      <form
        className="form-stack bulk-rehearsal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {error ? (
          <p className="notice notice--error" id="bulk-rehearsal-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Target performance
          <select
            aria-describedby={error ? "bulk-rehearsal-error" : undefined}
            aria-invalid={Boolean(error)}
            required
            value={performanceId}
            onChange={(event) => {
              setPerformanceId(event.target.value);
            }}
          >
            <option value="">Select performance…</option>
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.title} · {new Date(performance.startsAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Rehearsal venue
          <select
            value={venueId}
            onChange={(event) => {
              setVenueId(event.target.value);
            }}
          >
            <option value="">No saved venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <div className="bulk-rehearsal-form__split">
          <label className="field">
            Count
            <input
              min={1}
              max={52}
              required
              type="number"
              value={count}
              onChange={(event) => {
                setCount(event.target.value);
              }}
            />
          </label>
          <label className="field">
            Time
            <input
              required
              type="time"
              value={rehearsalTime}
              onChange={(event) => {
                setRehearsalTime(event.target.value);
              }}
            />
          </label>
        </div>
        <label className="field">
          Day of week
          <select
            required
            value={dayOfWeek}
            onChange={(event) => {
              setDayOfWeek(event.target.value);
            }}
          >
            <option value="">Choose a day of the week…</option>
            {DAYS_OF_WEEK.map((day, index) => (
              <option key={day} value={String(index)}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog__actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button aria-busy={busy} className="button button--primary" disabled={busy} type="submit">
            {busy ? "Generating…" : "Generate rehearsals"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
