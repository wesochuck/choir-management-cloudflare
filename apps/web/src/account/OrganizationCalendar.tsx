import type {
  OrganizationAuthStatusResponse,
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationProfile,
  OrganizationVenue,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  createOrganizationEvent,
  createOrganizationProfile,
  createOrganizationVenue,
  listOrganizationEvents,
  listOrganizationProfiles,
  listOrganizationVenues,
  setOrganizationEventRsvp,
} from "../auth/api";

interface Resources {
  readonly events: readonly OrganizationEvent[];
  readonly profiles: readonly OrganizationProfile[];
  readonly venues: readonly OrganizationVenue[];
}

type ResourceState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | ({ readonly status: "ready" } & Resources);

const emptyEvent: OrganizationEventRequest = {
  callTime: "",
  details: "",
  durationMinutes: null,
  location: "",
  parentPerformanceId: null,
  setList: [],
  setListApproved: false,
  startsAt: new Date(0).toISOString(),
  title: "",
  type: "Rehearsal",
  venueId: null,
};

function utcInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function displayEventDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function readEventType(value: string): OrganizationEventRequest["type"] {
  return value === "Performance" ? "Performance" : "Rehearsal";
}

function readRsvp(value: string): "No" | "Pending" | "Yes" {
  if (value === "Yes" || value === "No") return value;
  return "Pending";
}

export function OrganizationCalendar({
  context,
  enabled,
}: {
  readonly context: OrganizationAuthStatusResponse;
  readonly enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<OrganizationEventRequest>(emptyEvent);
  const [eventStart, setEventStart] = useState("");
  const [profileName, setProfileName] = useState("");
  const [resources, setResources] = useState<ResourceState>({ status: "loading" });
  const [rsvpEventId, setRsvpEventId] = useState("");
  const [rsvpProfileId, setRsvpProfileId] = useState("");
  const [rsvpStatus, setRsvpStatus] = useState<"No" | "Pending" | "Yes">("Pending");
  const [success, setSuccess] = useState<string | null>(null);
  const [venueAddress, setVenueAddress] = useState("");
  const [venueName, setVenueName] = useState("");
  const manager = context.role !== "member";

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationProfiles(controller.signal),
      listOrganizationVenues(controller.signal),
      listOrganizationEvents(controller.signal),
    ])
      .then(([profiles, venues, events]) => {
        setResources({ events, profiles, status: "ready", venues });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setResources({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  function beginAction() {
    setBusy(true);
    setError(null);
    setSuccess(null);
  }

  function failAction(actionError: unknown, fallback: string) {
    setError(actionError instanceof AuthApiError ? actionError.message : fallback);
    setBusy(false);
  }

  async function addProfile() {
    beginAction();
    try {
      const profile = await createOrganizationProfile(profileName);
      setResources((current) =>
        current.status === "ready"
          ? { ...current, profiles: [...current.profiles, profile] }
          : current,
      );
      setProfileName("");
      setSuccess("Profile created.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The Profile could not be created.");
    }
  }

  async function addVenue() {
    beginAction();
    try {
      const venue = await createOrganizationVenue(venueName, venueAddress);
      setResources((current) =>
        current.status === "ready" ? { ...current, venues: [...current.venues, venue] } : current,
      );
      setVenueAddress("");
      setVenueName("");
      setSuccess("Venue created.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The venue could not be created.");
    }
  }

  async function addEvent() {
    const startsAt = utcInputToIso(eventStart);
    if (!startsAt) {
      setError("Enter the event start date and time in UTC.");
      return;
    }
    beginAction();
    try {
      const created = await createOrganizationEvent({ ...event, startsAt });
      setResources((current) =>
        current.status === "ready"
          ? {
              ...current,
              events: [...current.events, created].toSorted((left, right) =>
                left.startsAt.localeCompare(right.startsAt),
              ),
            }
          : current,
      );
      setEvent(emptyEvent);
      setEventStart("");
      setSuccess("Event created.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The event could not be created.");
    }
  }

  async function updateRsvp() {
    beginAction();
    try {
      await setOrganizationEventRsvp(rsvpEventId, rsvpProfileId, rsvpStatus);
      setSuccess("RSVP updated.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The RSVP could not be updated.");
    }
  }

  return (
    <section
      className="account-section account-section--organization-calendar"
      aria-labelledby="organization-calendar-title"
    >
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Operations</p>
        <h2 id="organization-calendar-title">Profiles and calendar</h2>
      </div>
      {!enabled ? (
        <p className="notice notice--warning">Verify Organization MFA to load operational data.</p>
      ) : null}
      {enabled && resources.status === "loading" ? <p>Loading Organization calendar…</p> : null}
      {enabled && resources.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Organization calendar data could not be loaded.
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
      {enabled && resources.status === "ready" ? (
        <>
          <div className="calendar-summary-grid">
            <div>
              <h3>Profiles</h3>
              <p>{resources.profiles.length} active</p>
            </div>
            <div>
              <h3>Venues</h3>
              <p>{resources.venues.length} saved</p>
            </div>
            <div>
              <h3>Events</h3>
              <p>{resources.events.length} upcoming or recent</p>
            </div>
          </div>
          {manager ? (
            <div className="calendar-management-grid">
              <form
                className="form-stack"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void addProfile();
                }}
              >
                <h3>Create Profile</h3>
                <div className="field">
                  <label htmlFor="profile-name">Display name</label>
                  <input
                    id="profile-name"
                    maxLength={200}
                    onChange={(change) => {
                      setProfileName(change.target.value);
                    }}
                    required
                    value={profileName}
                  />
                </div>
                <button className="button button--primary" disabled={busy} type="submit">
                  Create Profile
                </button>
              </form>
              <form
                className="form-stack"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void addVenue();
                }}
              >
                <h3>Create venue</h3>
                <div className="field">
                  <label htmlFor="venue-name">Name</label>
                  <input
                    id="venue-name"
                    maxLength={500}
                    onChange={(change) => {
                      setVenueName(change.target.value);
                    }}
                    required
                    value={venueName}
                  />
                </div>
                <div className="field">
                  <label htmlFor="venue-address">Address</label>
                  <input
                    id="venue-address"
                    maxLength={2000}
                    onChange={(change) => {
                      setVenueAddress(change.target.value);
                    }}
                    value={venueAddress}
                  />
                </div>
                <button className="button button--primary" disabled={busy} type="submit">
                  Create venue
                </button>
              </form>
              <form
                className="form-stack calendar-event-form"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void addEvent();
                }}
              >
                <h3>Create event</h3>
                <div className="field">
                  <label htmlFor="event-title">Title</label>
                  <input
                    id="event-title"
                    maxLength={500}
                    onChange={(change) => {
                      setEvent((current) => ({ ...current, title: change.target.value }));
                    }}
                    required
                    value={event.title}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-type">Type</label>
                  <select
                    id="event-type"
                    onChange={(change) => {
                      setEvent((current) => ({
                        ...current,
                        type: readEventType(change.target.value),
                      }));
                    }}
                    value={event.type}
                  >
                    <option value="Rehearsal">Rehearsal</option>
                    <option value="Performance">Performance</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="event-start">Start (UTC)</label>
                  <input
                    id="event-start"
                    onChange={(change) => {
                      setEventStart(change.target.value);
                    }}
                    required
                    type="datetime-local"
                    value={eventStart}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-call">Call time (Organization local)</label>
                  <input
                    id="event-call"
                    onChange={(change) => {
                      setEvent((current) => ({ ...current, callTime: change.target.value }));
                    }}
                    type="time"
                    value={event.callTime}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-venue">Venue</label>
                  <select
                    id="event-venue"
                    onChange={(change) => {
                      setEvent((current) => ({ ...current, venueId: change.target.value || null }));
                    }}
                    value={event.venueId ?? ""}
                  >
                    <option value="">No saved venue</option>
                    {resources.venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="event-parent">Parent performance</label>
                  <select
                    id="event-parent"
                    onChange={(change) => {
                      setEvent((current) => ({
                        ...current,
                        parentPerformanceId: change.target.value || null,
                      }));
                    }}
                    value={event.parentPerformanceId ?? ""}
                  >
                    <option value="">None</option>
                    {resources.events
                      .filter((item) => item.type === "Performance")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="event-details">Details</label>
                  <textarea
                    id="event-details"
                    onChange={(change) => {
                      setEvent((current) => ({ ...current, details: change.target.value }));
                    }}
                    rows={3}
                    value={event.details}
                  />
                </div>
                <button className="button button--primary" disabled={busy} type="submit">
                  Create event
                </button>
              </form>
              <form
                className="form-stack"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void updateRsvp();
                }}
              >
                <h3>Set RSVP</h3>
                <div className="field">
                  <label htmlFor="rsvp-event">Event</label>
                  <select
                    id="rsvp-event"
                    onChange={(change) => {
                      setRsvpEventId(change.target.value);
                    }}
                    required
                    value={rsvpEventId}
                  >
                    <option value="">Choose event</option>
                    {resources.events.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rsvp-profile">Profile</label>
                  <select
                    id="rsvp-profile"
                    onChange={(change) => {
                      setRsvpProfileId(change.target.value);
                    }}
                    required
                    value={rsvpProfileId}
                  >
                    <option value="">Choose Profile</option>
                    {resources.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rsvp-status">RSVP</label>
                  <select
                    id="rsvp-status"
                    onChange={(change) => {
                      setRsvpStatus(readRsvp(change.target.value));
                    }}
                    value={rsvpStatus}
                  >
                    <option value="Pending">Pending</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </div>
                <button className="button button--primary" disabled={busy} type="submit">
                  Update RSVP
                </button>
              </form>
            </div>
          ) : null}
          <div className="calendar-event-list">
            <h3>Events</h3>
            {resources.events.length === 0 ? (
              <p className="empty-state">No events have been created yet.</p>
            ) : (
              <ul className="account-list">
                {resources.events.map((item) => (
                  <li key={item.id}>
                    <div>
                      <h3>{item.title}</h3>
                      <p>
                        {item.type} · {displayEventDate(item.startsAt)} UTC
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
