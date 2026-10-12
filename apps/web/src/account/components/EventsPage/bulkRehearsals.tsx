import type { OrganizationEvent, OrganizationVenue } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useState } from "react";
import { createOrganizationVenue, listOrganizationVenues } from "../../../auth/api";

import { DAYS_OF_WEEK } from "./utils";
import { ensureTbdVenue, findTbdVenue } from "./tbdVenue";

export function BulkRehearsalDialog({
  busy,
  count,
  dayOfWeek,
  error,
  onClose,
  onSubmit,
  onVenueCreated,
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
  readonly onVenueCreated?: ((venue: OrganizationVenue) => void) | undefined;
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
  const [tbdBusy, setTbdBusy] = useState(false);
  const [tbdError, setTbdError] = useState<string | null>(null);
  const existingTbd = findTbdVenue(venues);

  async function handleEnsureTbd(): Promise<void> {
    if (tbdBusy || busy) return;
    setTbdBusy(true);
    setTbdError(null);
    try {
      const venue = await ensureTbdVenue({
        createVenue: (name, address) => createOrganizationVenue(name, address),
        listVenues: () => listOrganizationVenues(),
        venues,
      });
      setVenueId(venue.id);
      if (onVenueCreated) onVenueCreated(venue);
    } catch {
      setTbdError(
        "The shared TBD venue could not be created. Check your connection and try again.",
      );
    } finally {
      setTbdBusy(false);
    }
  }

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
        <div className="field">
          <label htmlFor="bulk-rehearsal-venue">Rehearsal venue *</label>
          <select
            id="bulk-rehearsal-venue"
            required
            value={venueId}
            onChange={(event) => {
              setVenueId(event.target.value);
              setTbdError(null);
            }}
          >
            <option disabled value="">
              Select a venue…
            </option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
          {!venueId ? (
            <div className="event-editor-tbd">
              <div className="event-editor-tbd__text">
                <strong>Location not yet confirmed?</strong>
                <p>Select an existing TBD venue, or create a shared TBD venue with no address.</p>
              </div>
              <button
                className="button button--secondary button--small"
                disabled={tbdBusy || busy}
                onClick={() => {
                  void handleEnsureTbd();
                }}
                type="button"
              >
                {tbdBusy ? "Working…" : "Create or select TBD"}
              </button>
            </div>
          ) : null}
          {existingTbd && !venueId ? (
            <p className="field-help">
              Prefer to pick manually? Choose “{existingTbd.name}” in the venue list.
            </p>
          ) : null}
          {tbdError ? (
            <p className="notice notice--error" role="alert">
              {tbdError}
            </p>
          ) : null}
        </div>
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
