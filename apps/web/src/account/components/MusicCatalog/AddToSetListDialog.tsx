import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationVenue,
} from "@choir/contracts";
import { zonedLocalDateTimeToUtc } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import { useMemo, useState } from "react";
import { performanceDateLabel } from "./tableUtils";

export function AddToSetListDialog({
  busy,
  error,
  events,
  onApply,
  onClose,
  open,
  selectedPieces,
  timezone,
  venues,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly events: readonly OrganizationEvent[];
  readonly onApply: (
    payload:
      | { readonly mode: "existing"; readonly eventId: string }
      | {
          readonly mode: "new";
          readonly startsAt: string;
          readonly title: string;
          readonly venueId?: string | null;
        },
  ) => void;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly selectedPieces: readonly OrganizationMusicPiece[];
  readonly timezone: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  const performances = useMemo(
    () =>
      events
        .filter((event) => event.type === "Performance")
        .toSorted((left, right) => right.startsAt.localeCompare(left.startsAt)),
    [events],
  );

  const [mode, setMode] = useState<"existing" | "new">(() =>
    performances.length > 0 ? "existing" : "new",
  );
  const [selectedEventId, setSelectedEventId] = useState<string>(() => performances[0]?.id ?? "");
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newVenueId, setNewVenueId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function submit(): void {
    setFormError(null);
    if (mode === "existing") {
      if (!selectedEventId) {
        setFormError("Please select a concert / performance.");
        return;
      }
      onApply({ eventId: selectedEventId, mode: "existing" });
    } else {
      const title = newTitle.trim();
      if (!title) {
        setFormError("Enter a concert title.");
        return;
      }
      const startsAt = zonedLocalDateTimeToUtc(newDate, timezone);
      if (!startsAt) {
        setFormError("Enter a valid concert date and time.");
        return;
      }
      onApply({
        mode: "new",
        startsAt,
        title,
        venueId: newVenueId || null,
      });
    }
  }

  const selectedTitles = selectedPieces.map((p) => p.title).join(", ");

  return (
    <Dialog
      description={`Add ${String(selectedPieces.length)} selected music piece${selectedPieces.length === 1 ? "" : "s"} to a concert set list.`}
      onClose={onClose}
      open={open}
      title="Add to set list"
    >
      <form
        className="form-stack add-to-setlist-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {error || formError ? (
          <p className="notice notice--error" role="alert">
            {error ?? formError}
          </p>
        ) : null}

        <div className="surface-card" style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
          <strong>Selected pieces ({String(selectedPieces.length)}):</strong>{" "}
          <span className="field-help">{selectedTitles}</span>
        </div>

        <fieldset className="music-setlist-target-mode" style={{ margin: "0.5rem 0" }}>
          <legend className="sr-only">Set list target</legend>
          <div className="form-actions form-actions--start">
            <label className="radio-label">
              <input
                checked={mode === "existing"}
                disabled={performances.length === 0}
                name="setlist-target-mode"
                onChange={() => {
                  setMode("existing");
                  setFormError(null);
                }}
                type="radio"
                value="existing"
              />
              Add to existing concert
            </label>
            <label className="radio-label">
              <input
                checked={mode === "new"}
                name="setlist-target-mode"
                onChange={() => {
                  setMode("new");
                  setFormError(null);
                }}
                type="radio"
                value="new"
              />
              Create new concert
            </label>
          </div>
        </fieldset>

        {mode === "existing" ? (
          <div className="field">
            <label htmlFor="setlist-select-event">
              Concert / Performance
              <select
                id="setlist-select-event"
                value={selectedEventId}
                onChange={(event) => {
                  setSelectedEventId(event.target.value);
                }}
              >
                {performances.length === 0 ? (
                  <option value="">No concerts found</option>
                ) : (
                  performances.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title} — {performanceDateLabel(event.startsAt, timezone)} (
                      {String(event.setList.length)} songs)
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        ) : (
          <div className="form-stack">
            <label className="field">
              Concert / Performance title
              <input
                autoFocus
                placeholder="e.g. Spring Gala Concert 2026"
                value={newTitle}
                onChange={(event) => {
                  setNewTitle(event.target.value);
                }}
              />
            </label>
            <div className="music-fields-grid">
              <label className="field">
                Date and time
                <input
                  type="datetime-local"
                  value={newDate}
                  onChange={(event) => {
                    setNewDate(event.target.value);
                  }}
                />
                <span className="field-help">Time in {timezone}</span>
              </label>
              <label className="field">
                Venue (optional)
                <select
                  value={newVenueId}
                  onChange={(event) => {
                    setNewVenueId(event.target.value);
                  }}
                >
                  <option value="">No venue</option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="dialog__actions music-piece-form__actions">
          <button className="button button--primary" disabled={busy} type="submit">
            {busy
              ? "Adding to set list…"
              : mode === "existing"
                ? "Add to set list"
                : "Create concert & add set list"}
          </button>
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
        </div>
      </form>
    </Dialog>
  );
}
