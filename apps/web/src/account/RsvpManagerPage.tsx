import type { OrganizationEvent, OrganizationProfile } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  listOrganizationEvents,
  listOrganizationProfiles,
  setOrganizationEventRsvp,
} from "../auth/api";

type RsvpState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly events: readonly OrganizationEvent[];
      readonly profiles: readonly OrganizationProfile[];
      readonly status: "ready";
    };

export function RsvpManagerPage({
  enabled,
  eventId: initialEventId = null,
}: {
  readonly enabled: boolean;
  readonly eventId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventId] = useState(initialEventId ?? "");
  const [note, setNote] = useState("");
  const [profileId, setProfileId] = useState("");
  const [rsvp, setRsvp] = useState<"No" | "Pending" | "Yes">("Pending");
  const [state, setState] = useState<RsvpState>({ status: "loading" });
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationProfiles(controller.signal),
    ])
      .then(([events, profiles]) => {
        setState({ events, profiles, status: "ready" });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function saveRsvp() {
    if (!eventId || !profileId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await setOrganizationEventRsvp(eventId, profileId, rsvp, note);
      setSuccess("RSVP updated.");
      if (rsvp !== "No") setNote("");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError ? saveError.message : "The RSVP could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <p className="notice notice--warning">Verify Organization MFA to manage RSVPs.</p>;
  }

  const selectedEvent =
    state.status === "ready" ? state.events.find((candidate) => candidate.id === eventId) : null;

  return (
    <RsvpManagerView
      busy={busy}
      error={error}
      eventId={eventId}
      note={note}
      onSave={() => {
        void saveRsvp();
      }}
      profileId={profileId}
      rsvp={rsvp}
      selectedEvent={selectedEvent}
      setEventId={setEventId}
      setNote={setNote}
      setProfileId={setProfileId}
      setRsvp={setRsvp}
      state={state}
      success={success}
    />
  );
}

function RsvpManagerView({
  busy,
  error,
  eventId,
  note,
  onSave,
  profileId,
  rsvp,
  selectedEvent,
  setEventId,
  setNote,
  setProfileId,
  setRsvp,
  state,
  success,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly eventId: string;
  readonly note: string;
  readonly onSave: () => void;
  readonly profileId: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly selectedEvent: OrganizationEvent | null | undefined;
  readonly setEventId: (value: string) => void;
  readonly setNote: (value: string) => void;
  readonly setProfileId: (value: string) => void;
  readonly setRsvp: (value: "No" | "Pending" | "Yes") => void;
  readonly state: RsvpState;
  readonly success: string | null;
}) {
  return (
    <div className="split-layout">
      <section className="surface-card">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Event response</p>
          <h2>{selectedEvent?.title ?? "Choose an event"}</h2>
        </div>
        {state.status === "loading" ? <p role="status">Loading event roster…</p> : null}
        {state.status === "error" ? (
          <p className="notice notice--error" role="alert">
            Event roster data could not be loaded.
          </p>
        ) : null}
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="notice notice--success" role="status">
            {success}
          </p>
        ) : null}
        {state.status === "ready" ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <div className="field">
              <label htmlFor="rsvp-page-event">Event</label>
              <select
                id="rsvp-page-event"
                onChange={(event) => {
                  setEventId(event.target.value);
                }}
                required
                value={eventId}
              >
                <option value="">Choose event</option>
                {state.events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rsvp-page-profile">Profile</label>
              <select
                id="rsvp-page-profile"
                onChange={(event) => {
                  setProfileId(event.target.value);
                }}
                required
                value={profileId}
              >
                <option value="">Choose Profile</option>
                {state.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rsvp-page-status">RSVP</label>
              <select
                id="rsvp-page-status"
                onChange={(event) => {
                  setRsvp(
                    event.target.value === "Yes" || event.target.value === "No"
                      ? event.target.value
                      : "Pending",
                  );
                }}
                value={rsvp}
              >
                <option value="Pending">Pending</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
            {rsvp === "No" ? (
              <div className="field">
                <label htmlFor="rsvp-page-note">Decline note</label>
                <textarea
                  id="rsvp-page-note"
                  maxLength={2000}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                  rows={3}
                  value={note}
                />
              </div>
            ) : null}
            <button
              className="button button--primary"
              disabled={busy || !eventId || !profileId}
              type="submit"
            >
              {busy ? "Updating…" : "Update RSVP"}
            </button>
          </form>
        ) : null}
      </section>
      <aside className="surface-card split-layout__aside">
        <h2>Roster export</h2>
        <p>Download this event’s RSVP roster for attendance or offline review.</p>
        {eventId ? (
          <a
            className="button button--secondary"
            href={`/api/organization/events/${encodeURIComponent(eventId)}/rsvp-export.csv?sort=section`}
          >
            Download RSVP CSV
          </a>
        ) : (
          <p className="empty-state">Choose an event to enable its export.</p>
        )}
      </aside>
    </div>
  );
}
