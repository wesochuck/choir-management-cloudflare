import type {
  OrganizationAuthStatusResponse,
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
import {
  inspectRosterCsv,
  mapRosterCsvColumns,
  rosterCsvColumnForHeader,
  rosterCsvColumnOptions,
  utcToZonedLocalDateTime,
  zonedLocalDateTimeToUtc,
  type CsvColumnMapping,
  type RosterCsvInspection,
} from "@choir/domain";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  archiveOrganizationEvent,
  createOrganizationEvent,
  createOrganizationProfile,
  createOrganizationVenue,
  deletePrivateOrganizationFile,
  deleteOrganizationVenue,
  getOrganizationCalendarSettings,
  getOrganizationRosterConfiguration,
  importOrganizationProfilesCsv,
  listOrganizationEvents,
  listOrganizationProfiles,
  listOrganizationVenues,
  setOrganizationEventRsvp,
  updateOrganizationCalendarSettings,
  updateOrganizationEvent,
  updateOrganizationProfile,
  uploadPrivateOrganizationFile,
} from "../auth/api";
import { CsvImportDialog } from "./CsvImportDialog";
import { dayOfPriceStartLabel } from "./eventPricing";

interface Resources {
  readonly events: readonly OrganizationEvent[];
  readonly profiles: readonly OrganizationProfile[];
  readonly rosterConfiguration: OrganizationRosterConfiguration;
  readonly venues: readonly OrganizationVenue[];
  readonly timezone: string;
}

type ResourceState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | ({ readonly status: "ready" } & Resources);

const emptyEvent: OrganizationEventRequest = {
  advancePriceCents: 0,
  callTime: "",
  dayOfPriceCents: 0,
  details: "",
  doorsOpenTime: "",
  durationMinutes: null,
  isTicketingEnabled: false,
  location: "",
  parentPerformanceId: null,
  publicDetails: "",
  publicGraphicFileId: null,
  publishOnWebsite: false,
  setList: [],
  setListApproved: false,
  startsAt: new Date(0).toISOString(),
  ticketCapacity: null,
  title: "",
  type: "Rehearsal",
  venueId: null,
};

const emptyProfile: OrganizationProfileRequest = {
  displayName: "",
  doNotEmail: false,
  globalStatus: "Active",
  isSectionLeader: false,
  notes: "",
  phone: "",
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  statusIsManual: false,
  voicePart: "",
};

function displayEventDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function readEventType(value: string): OrganizationEventRequest["type"] {
  return value === "Performance" ? "Performance" : "Rehearsal";
}

function readRsvp(value: string): "No" | "Pending" | "Yes" {
  if (value === "Yes" || value === "No") return value;
  return "Pending";
}

function profileStatusLabel(value: OrganizationProfile["globalStatus"]): string {
  return value === "Idle" ? "On Break" : value;
}

function eventRequestFrom(event: OrganizationEvent): OrganizationEventRequest {
  return {
    advancePriceCents: event.advancePriceCents,
    callTime: event.callTime,
    dayOfPriceCents: event.dayOfPriceCents,
    details: event.details,
    doorsOpenTime: event.doorsOpenTime,
    durationMinutes: event.durationMinutes,
    isTicketingEnabled: event.isTicketingEnabled,
    location: event.location,
    parentPerformanceId: event.type === "Rehearsal" ? event.parentPerformanceId : null,
    publicDetails: event.publicDetails,
    publicGraphicFileId: event.publicGraphicFileId,
    publishOnWebsite: event.publishOnWebsite,
    setList: event.setList,
    setListApproved: event.setListApproved,
    startsAt: event.startsAt,
    ticketCapacity: event.ticketCapacity,
    title: event.title,
    type: event.type,
    venueId: event.venueId,
  };
}

function profileRequestFrom(profile: OrganizationProfile): OrganizationProfileRequest {
  return {
    displayName: profile.displayName,
    doNotEmail: profile.doNotEmail,
    globalStatus: profile.globalStatus,
    isSectionLeader: profile.isSectionLeader,
    notes: profile.notes,
    phone: profile.phone,
    receiveAdminNotifications: profile.receiveAdminNotifications,
    receiveAttendanceReports: profile.receiveAttendanceReports,
    receiveFinancialAlerts: profile.receiveFinancialAlerts,
    receiveRsvpDeclineNotices: profile.receiveRsvpDeclineNotices,
    showInDirectory: profile.showInDirectory,
    statusIsManual: profile.statusIsManual,
    voicePart: profile.voicePart,
  };
}

function EventActions(props: {
  readonly archiveConfirmId: string | null;
  readonly busy: boolean;
  readonly event: OrganizationEvent;
  readonly onArchive: (eventId: string) => void;
  readonly onCancelArchive: () => void;
  readonly onClone: (event: OrganizationEvent) => void;
  readonly onEdit: (event: OrganizationEvent) => void;
  readonly onRequestArchive: (eventId: string) => void;
  readonly visible: boolean;
}) {
  if (!props.visible) return null;
  return (
    <div className="button-row">
      <a
        className="button button--secondary"
        href={`/api/organization/events/${encodeURIComponent(props.event.id)}/rsvp-export.csv?sort=section`}
      >
        Download RSVP CSV
      </a>
      <button
        className="button button--secondary"
        disabled={props.busy}
        onClick={() => {
          props.onEdit(props.event);
        }}
        type="button"
      >
        Edit
      </button>
      <button
        className="button button--secondary"
        disabled={props.busy}
        onClick={() => {
          props.onClone(props.event);
        }}
        type="button"
      >
        Clone
      </button>
      {props.archiveConfirmId === props.event.id ? (
        <>
          <button
            className="button button--danger"
            disabled={props.busy}
            onClick={() => {
              props.onArchive(props.event.id);
            }}
            type="button"
          >
            Confirm archive
          </button>
          <button
            className="text-button"
            disabled={props.busy}
            onClick={props.onCancelArchive}
            type="button"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          className="button button--danger"
          disabled={props.busy}
          onClick={() => {
            props.onRequestArchive(props.event.id);
          }}
          type="button"
        >
          Archive
        </button>
      )}
    </div>
  );
}

function CalendarNotices(props: {
  readonly enabled: boolean;
  readonly error: string | null;
  readonly resourceStatus: ResourceState["status"];
  readonly success: string | null;
}) {
  return (
    <>
      {!props.enabled ? (
        <p className="notice notice--warning">Verify Organization MFA to load operational data.</p>
      ) : null}
      {props.enabled && props.resourceStatus === "loading" ? (
        <p>Loading Organization calendar…</p>
      ) : null}
      {props.enabled && props.resourceStatus === "error" ? (
        <p className="notice notice--error" role="alert">
          Organization calendar data could not be loaded.
        </p>
      ) : null}
      {props.error ? (
        <p className="notice notice--error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.success ? (
        <p className="notice notice--success" role="status">
          {props.success}
        </p>
      ) : null}
    </>
  );
}

function PublicPerformanceFields({
  event,
  eventStart,
  onChange,
  onFileChange,
  timezone,
}: {
  readonly event: OrganizationEventRequest;
  readonly eventStart: string;
  readonly onChange: (changes: Partial<OrganizationEventRequest>) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly timezone: string;
}) {
  if (event.type !== "Performance") return null;
  return (
    <fieldset>
      <legend>Public website</legend>
      <label>
        <input
          checked={event.publishOnWebsite}
          onChange={(change) => {
            onChange({ publishOnWebsite: change.target.checked });
          }}
          type="checkbox"
        />
        Publish this performance on the Organization website
      </label>
      <div className="field">
        <label htmlFor="event-public-details">Public details</label>
        <textarea
          id="event-public-details"
          maxLength={100_000}
          onChange={(change) => {
            onChange({ publicDetails: change.target.value });
          }}
          rows={4}
          value={event.publicDetails}
        />
      </div>
      <fieldset>
        <legend>Online ticket sales</legend>
        <label>
          <input
            checked={event.isTicketingEnabled}
            onChange={(change) => {
              onChange({ isTicketingEnabled: change.target.checked });
            }}
            type="checkbox"
          />
          Offer tickets for this performance
        </label>
        <div className="settings-grid">
          <label className="field">
            Advance price (USD)
            <input
              min="0"
              onChange={(change) => {
                onChange({ advancePriceCents: Math.round(Number(change.target.value) * 100) });
              }}
              step="0.01"
              type="number"
              value={(event.advancePriceCents / 100).toFixed(2)}
            />
          </label>
          <label className="field">
            Show-day price (USD)
            <input
              min="0"
              onChange={(change) => {
                onChange({ dayOfPriceCents: Math.round(Number(change.target.value) * 100) });
              }}
              step="0.01"
              type="number"
              value={(event.dayOfPriceCents / 100).toFixed(2)}
            />
          </label>
          <p className="ticketing-price-note" role="status">
            {dayOfPriceStartLabel(eventStart, timezone) ??
              "Choose an event start to confirm when day-of pricing begins."}
          </p>
          <label className="field">
            Capacity (blank means unlimited)
            <input
              min="1"
              onChange={(change) => {
                onChange({
                  ticketCapacity: change.target.value ? Number(change.target.value) : null,
                });
              }}
              step="1"
              type="number"
              value={event.ticketCapacity ?? ""}
            />
          </label>
          <label className="field">
            Doors open
            <input
              onChange={(change) => {
                onChange({ doorsOpenTime: change.target.value });
              }}
              type="time"
              value={event.doorsOpenTime}
            />
          </label>
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="event-public-graphic">Public graphic (optional)</label>
        <input
          accept="image/jpeg,image/png,image/webp"
          id="event-public-graphic"
          onChange={(change) => {
            onFileChange(change.target.files?.item(0) ?? null);
          }}
          type="file"
        />
        {event.publicGraphicFileId ? (
          <div className="form-actions">
            <a
              className="text-button"
              href={`/api/organization/files/${encodeURIComponent(event.publicGraphicFileId)}`}
              rel="noreferrer"
              target="_blank"
            >
              View current graphic
            </a>
            <button
              className="button button--secondary"
              onClick={() => {
                onChange({ publicGraphicFileId: null });
                onFileChange(null);
              }}
              type="button"
            >
              Remove current graphic
            </button>
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

function RosterCsvControls({ onOpenImport }: { readonly onOpenImport: () => void }) {
  return (
    <div className="form-stack">
      <h3>Roster export</h3>
      <p>Download the baseline-compatible Organization roster as CSV.</p>
      <div className="form-actions">
        <a
          className="button button--secondary"
          download="choir_roster_export.csv"
          href="/api/organization/profiles/export.csv"
        >
          Download roster CSV
        </a>
        <button className="button button--secondary" onClick={onOpenImport} type="button">
          Import roster CSV
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line complexity -- the calendar page coordinates events, RSVPs, venues, and roster imports.
export function OrganizationCalendar({
  context,
  enabled,
}: {
  readonly context: OrganizationAuthStatusResponse;
  readonly enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<OrganizationEventRequest>(emptyEvent);
  const [eventStart, setEventStart] = useState("");
  const [eventGraphicFile, setEventGraphicFile] = useState<File | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [profile, setProfile] = useState<OrganizationProfileRequest>(emptyProfile);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceState>({ status: "loading" });
  const [rsvpEventId, setRsvpEventId] = useState("");
  const [rsvpProfileId, setRsvpProfileId] = useState("");
  const [rsvpNote, setRsvpNote] = useState("");
  const [rsvpStatus, setRsvpStatus] = useState<"No" | "Pending" | "Yes">("Pending");
  const [rosterImportDialogOpen, setRosterImportDialogOpen] = useState(false);
  const [rosterImportFile, setRosterImportFile] = useState<File | null>(null);
  const [rosterImportCsv, setRosterImportCsv] = useState("");
  const [rosterImportHeaders, setRosterImportHeaders] = useState<readonly string[]>([]);
  const [rosterImportMappings, setRosterImportMappings] = useState<readonly CsvColumnMapping[]>([]);
  const [rosterImportInspection, setRosterImportInspection] = useState<RosterCsvInspection | null>(
    null,
  );
  const [rosterImportConfirmed, setRosterImportConfirmed] = useState(false);
  const [rosterImportInspecting, setRosterImportInspecting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [timezoneInput, setTimezoneInput] = useState("UTC");
  const [venueAddress, setVenueAddress] = useState("");
  const [venueDeleteConfirmId, setVenueDeleteConfirmId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState("");
  const manager = context.role !== "member";

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationProfiles(controller.signal),
      listOrganizationVenues(controller.signal),
      listOrganizationEvents(controller.signal),
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
    ])
      .then(([profiles, venues, events, settings, rosterConfiguration]) => {
        setTimezoneInput(settings.timezone);
        setResources({
          events,
          profiles,
          rosterConfiguration,
          status: "ready",
          timezone: settings.timezone,
          venues,
        });
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
      const saved = editingProfileId
        ? await updateOrganizationProfile(editingProfileId, profile)
        : await createOrganizationProfile(profile);
      setResources((current) =>
        current.status === "ready"
          ? {
              ...current,
              profiles: editingProfileId
                ? current.profiles.map((candidate) =>
                    candidate.id === saved.id ? saved : candidate,
                  )
                : [...current.profiles, saved],
            }
          : current,
      );
      setEditingProfileId(null);
      setProfile(emptyProfile);
      setSuccess(editingProfileId ? "Profile updated." : "Profile created.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The Profile could not be created.");
    }
  }

  function beginProfileEdit(candidate: OrganizationProfile) {
    setEditingProfileId(candidate.id);
    setProfile(profileRequestFrom(candidate));
    setError(null);
    setSuccess(null);
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

  async function removeVenue(venueId: string) {
    beginAction();
    try {
      await deleteOrganizationVenue(venueId);
      setResources((current) =>
        current.status === "ready"
          ? { ...current, venues: current.venues.filter((candidate) => candidate.id !== venueId) }
          : current,
      );
      setVenueDeleteConfirmId(null);
      setSuccess("Venue deleted.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The venue could not be deleted.");
    }
  }

  async function addEvent() {
    const startsAt =
      resources.status === "ready" ? zonedLocalDateTimeToUtc(eventStart, resources.timezone) : null;
    if (!startsAt) {
      setError("Enter a valid event time in the Organization timezone.");
      return;
    }
    beginAction();
    let uploadedGraphicId: string | null = null;
    const previousGraphicId = event.publicGraphicFileId;
    try {
      if (eventGraphicFile) {
        const uploaded = await uploadPrivateOrganizationFile(eventGraphicFile);
        uploadedGraphicId = uploaded.id;
      }
      const eventToSave = {
        ...event,
        publicGraphicFileId: uploadedGraphicId ?? event.publicGraphicFileId,
        startsAt,
      };
      const saved = editingEventId
        ? await updateOrganizationEvent(editingEventId, eventToSave)
        : await createOrganizationEvent(eventToSave);
      setResources((current) =>
        current.status === "ready"
          ? {
              ...current,
              events: (editingEventId
                ? current.events.map((candidate) => (candidate.id === saved.id ? saved : candidate))
                : [...current.events, saved]
              ).toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
            }
          : current,
      );
      setEditingEventId(null);
      setEvent(emptyEvent);
      setEventGraphicFile(null);
      setEventStart("");
      if (previousGraphicId && previousGraphicId !== saved.publicGraphicFileId) {
        await deletePrivateOrganizationFile(previousGraphicId).catch(() => undefined);
      }
      setSuccess(editingEventId ? "Event updated." : "Event created.");
      setBusy(false);
    } catch (actionError: unknown) {
      if (uploadedGraphicId) {
        await deletePrivateOrganizationFile(uploadedGraphicId).catch(() => undefined);
      }
      failAction(actionError, "The event could not be created.");
    }
  }

  function beginEdit(candidate: OrganizationEvent) {
    if (resources.status !== "ready") return;
    setEditingEventId(candidate.id);
    setEventGraphicFile(null);
    setEvent(eventRequestFrom(candidate));
    setEventStart(utcToZonedLocalDateTime(candidate.startsAt, resources.timezone) ?? "");
    setError(null);
    setSuccess(null);
  }

  function beginClone(candidate: OrganizationEvent) {
    if (resources.status !== "ready") return;
    setEditingEventId(null);
    setEvent({
      ...eventRequestFrom(candidate),
      parentPerformanceId: null,
      publicGraphicFileId: null,
      publishOnWebsite: false,
      isTicketingEnabled: false,
      setList: [],
      setListApproved: false,
      title: `${candidate.title} copy`,
    });
    setEventStart(utcToZonedLocalDateTime(candidate.startsAt, resources.timezone) ?? "");
    setError(null);
    setSuccess("Clone prepared. Adjust the date and save it as a new event.");
  }

  async function archiveEvent(eventId: string) {
    beginAction();
    try {
      await archiveOrganizationEvent(eventId);
      setResources((current) =>
        current.status === "ready"
          ? { ...current, events: current.events.filter((candidate) => candidate.id !== eventId) }
          : current,
      );
      setArchiveConfirmId(null);
      setSuccess("Event archived.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The event could not be archived.");
    }
  }

  async function updateTimezone() {
    beginAction();
    try {
      const settings = await updateOrganizationCalendarSettings(timezoneInput);
      setResources((current) =>
        current.status === "ready" ? { ...current, timezone: settings.timezone } : current,
      );
      setTimezoneInput(settings.timezone);
      setSuccess("Organization timezone updated.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The Organization timezone could not be updated.");
    }
  }

  async function updateRsvp() {
    beginAction();
    try {
      await setOrganizationEventRsvp(rsvpEventId, rsvpProfileId, rsvpStatus, rsvpNote);
      if (rsvpStatus !== "No") setRsvpNote("");
      setSuccess("RSVP updated.");
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The RSVP could not be updated.");
    }
  }

  async function importRoster(): Promise<void> {
    if (!rosterImportFile) return;
    beginAction();
    try {
      const result = await importOrganizationProfilesCsv(
        mapRosterCsvColumns(await rosterImportFile.text(), rosterImportMappings),
      );
      const profiles = await listOrganizationProfiles();
      setResources((current) => (current.status === "ready" ? { ...current, profiles } : current));
      setRosterImportFile(null);
      setRosterImportDialogOpen(false);
      setRosterImportCsv("");
      setRosterImportHeaders([]);
      setRosterImportMappings([]);
      setRosterImportInspection(null);
      setRosterImportConfirmed(false);
      setRosterImportInspecting(false);
      setSuccess(
        `${String(result.imported)} Profile(s) imported. ${String(result.invitationCandidates)} email address(es) are ready for separate Membership invitations.`,
      );
      setBusy(false);
    } catch (actionError: unknown) {
      failAction(actionError, "The roster CSV could not be imported.");
    }
  }

  function handleRosterImportFile(file: File | null): void {
    setRosterImportFile(file);
    setRosterImportCsv("");
    setRosterImportHeaders([]);
    setRosterImportMappings([]);
    setRosterImportInspection(null);
    setRosterImportConfirmed(false);
    setRosterImportInspecting(Boolean(file));
    if (!file) return;
    void file
      .text()
      .then((csv) => {
        const initialInspection = inspectRosterCsv(csv);
        const mappings = initialInspection.headers.map((header, sourceIndex) => ({
          sourceIndex,
          targetHeader: rosterCsvColumnForHeader(header),
        }));
        setRosterImportCsv(csv);
        setRosterImportHeaders(initialInspection.headers);
        setRosterImportMappings(mappings);
        setRosterImportInspection(inspectRosterCsv(mapRosterCsvColumns(csv, mappings)));
      })
      .catch(() => {
        setError("The CSV could not be read.");
      })
      .finally(() => {
        setRosterImportInspecting(false);
      });
  }

  function handleRosterColumnMap(sourceIndex: number, targetHeader: string | null): void {
    const nextMappings = rosterImportMappings.map((mapping) =>
      mapping.sourceIndex === sourceIndex ? { ...mapping, targetHeader } : mapping,
    );
    setRosterImportMappings(nextMappings);
    setRosterImportConfirmed(false);
    setRosterImportInspection(inspectRosterCsv(mapRosterCsvColumns(rosterImportCsv, nextMappings)));
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
      <CalendarNotices
        enabled={enabled}
        error={error}
        resourceStatus={resources.status}
        success={success}
      />
      {enabled && resources.status === "ready" ? (
        <>
          <div className="calendar-summary-grid">
            <div>
              <h3>Profiles</h3>
              <p>{resources.profiles.length} total</p>
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
              <RosterCsvControls
                onOpenImport={() => {
                  setError(null);
                  setSuccess(null);
                  setRosterImportDialogOpen(true);
                }}
              />
              <form
                className="form-stack"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void updateTimezone();
                }}
              >
                <h3>Organization timezone</h3>
                <div className="field">
                  <label htmlFor="organization-timezone">IANA timezone</label>
                  <input
                    id="organization-timezone"
                    list="common-timezones"
                    maxLength={100}
                    onChange={(change) => {
                      setTimezoneInput(change.target.value);
                    }}
                    required
                    value={timezoneInput}
                  />
                  <datalist id="common-timezones">
                    <option value="UTC" />
                    <option value="America/New_York" />
                    <option value="America/Chicago" />
                    <option value="America/Denver" />
                    <option value="America/Los_Angeles" />
                  </datalist>
                </div>
                <button className="button button--primary" disabled={busy} type="submit">
                  Save timezone
                </button>
              </form>
              <form
                className="form-stack"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void addProfile();
                }}
              >
                <h3>{editingProfileId ? "Edit Profile" : "Create Profile"}</h3>
                <div className="field">
                  <label htmlFor="profile-name">Display name</label>
                  <input
                    id="profile-name"
                    maxLength={200}
                    onChange={(change) => {
                      setProfile((current) => ({ ...current, displayName: change.target.value }));
                    }}
                    required
                    value={profile.displayName}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-phone">Phone</label>
                  <input
                    id="profile-phone"
                    maxLength={50}
                    onChange={(change) => {
                      setProfile((current) => ({ ...current, phone: change.target.value }));
                    }}
                    value={profile.phone}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-voice-part">Voice part</label>
                  <select
                    id="profile-voice-part"
                    onChange={(change) => {
                      setProfile((current) => ({ ...current, voicePart: change.target.value }));
                    }}
                    value={profile.voicePart}
                  >
                    <option value="">No voice part</option>
                    {resources.rosterConfiguration.voiceParts.map(({ fullName, label }) => (
                      <option key={label} value={label}>
                        {fullName} ({label})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="profile-status">Status</label>
                  <select
                    id="profile-status"
                    onChange={(change) => {
                      const value = change.target.value;
                      setProfile((current) => ({
                        ...current,
                        globalStatus: value === "Idle" || value === "Inactive" ? value : "Active",
                      }));
                    }}
                    value={profile.globalStatus}
                  >
                    <option value="Active">Active</option>
                    <option value="Idle">On Break</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="profile-notes">Notes</label>
                  <textarea
                    id="profile-notes"
                    maxLength={100000}
                    onChange={(change) => {
                      setProfile((current) => ({ ...current, notes: change.target.value }));
                    }}
                    rows={3}
                    value={profile.notes}
                  />
                </div>
                <label className="checkbox-row">
                  <input
                    checked={profile.showInDirectory}
                    onChange={(change) => {
                      setProfile((current) => ({
                        ...current,
                        showInDirectory: change.target.checked,
                      }));
                    }}
                    type="checkbox"
                  />
                  Show in directory
                </label>
                <label className="checkbox-row">
                  <input
                    checked={profile.isSectionLeader}
                    onChange={(change) => {
                      setProfile((current) => ({
                        ...current,
                        isSectionLeader: change.target.checked,
                      }));
                    }}
                    type="checkbox"
                  />
                  Section leader
                </label>
                <label className="checkbox-row">
                  <input
                    checked={profile.doNotEmail}
                    onChange={(change) => {
                      setProfile((current) => ({
                        ...current,
                        doNotEmail: change.target.checked,
                      }));
                    }}
                    type="checkbox"
                  />
                  Do not email
                </label>
                <button className="button button--primary" disabled={busy} type="submit">
                  {editingProfileId ? "Save Profile" : "Create Profile"}
                </button>
                {editingProfileId ? (
                  <button
                    className="button button--secondary"
                    onClick={() => {
                      setEditingProfileId(null);
                      setProfile(emptyProfile);
                    }}
                    type="button"
                  >
                    Cancel Profile edit
                  </button>
                ) : null}
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
                <h3>{editingEventId ? "Edit event" : "Create event"}</h3>
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
                      const type = readEventType(change.target.value);
                      setEvent((current) => ({
                        ...current,
                        parentPerformanceId:
                          type === "Rehearsal" ? current.parentPerformanceId : null,
                        type,
                      }));
                    }}
                    value={event.type}
                  >
                    <option value="Rehearsal">Rehearsal</option>
                    <option value="Performance">Performance</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="event-start">Start ({resources.timezone})</label>
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
                {event.type === "Rehearsal" ? (
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
                ) : null}
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
                <PublicPerformanceFields
                  event={event}
                  eventStart={eventStart}
                  onChange={(changes) => {
                    setEvent((current) => ({ ...current, ...changes }));
                  }}
                  onFileChange={setEventGraphicFile}
                  timezone={resources.timezone}
                />
                <button className="button button--primary" disabled={busy} type="submit">
                  {editingEventId ? "Save event" : "Create event"}
                </button>
                {editingEventId ? (
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditingEventId(null);
                      setEvent(emptyEvent);
                      setEventGraphicFile(null);
                      setEventStart("");
                    }}
                    type="button"
                  >
                    Cancel edit
                  </button>
                ) : null}
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
                {rsvpStatus === "No" ? (
                  <div className="field">
                    <label htmlFor="rsvp-note">Decline note</label>
                    <textarea
                      id="rsvp-note"
                      maxLength={2000}
                      onChange={(change) => {
                        setRsvpNote(change.target.value);
                      }}
                      rows={3}
                      value={rsvpNote}
                    />
                  </div>
                ) : null}
                <button className="button button--primary" disabled={busy} type="submit">
                  Update RSVP
                </button>
              </form>
            </div>
          ) : null}
          <div className="calendar-event-list">
            <h3>Profiles</h3>
            <ul className="account-list">
              {resources.profiles.map((item) => (
                <li key={item.id}>
                  <div>
                    <h3>{item.displayName}</h3>
                    <p>
                      {profileStatusLabel(item.globalStatus)} · {item.voicePart || "No voice part"}
                    </p>
                  </div>
                  {manager ? (
                    <button
                      className="button button--secondary"
                      disabled={busy}
                      onClick={() => {
                        beginProfileEdit(item);
                      }}
                      type="button"
                    >
                      Edit Profile
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <h3>Venues</h3>
            {resources.venues.length === 0 ? (
              <p className="empty-state">No venues have been created yet.</p>
            ) : (
              <ul className="account-list">
                {resources.venues.map((item) => (
                  <li key={item.id}>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.address || "No address"}</p>
                    </div>
                    {manager ? (
                      venueDeleteConfirmId === item.id ? (
                        <div className="button-row" role="group" aria-label={`Delete ${item.name}`}>
                          <button
                            className="button button--danger"
                            disabled={busy}
                            onClick={() => {
                              void removeVenue(item.id);
                            }}
                            type="button"
                          >
                            Confirm delete
                          </button>
                          <button
                            className="button button--secondary"
                            disabled={busy}
                            onClick={() => {
                              setVenueDeleteConfirmId(null);
                            }}
                            type="button"
                          >
                            Keep venue
                          </button>
                        </div>
                      ) : (
                        <button
                          className="button button--secondary"
                          disabled={busy}
                          onClick={() => {
                            setVenueDeleteConfirmId(item.id);
                          }}
                          type="button"
                        >
                          Delete venue
                        </button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
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
                        {item.type} · {displayEventDate(item.startsAt, resources.timezone)} (
                        {resources.timezone})
                      </p>
                    </div>
                    <EventActions
                      archiveConfirmId={archiveConfirmId}
                      busy={busy}
                      event={item}
                      onArchive={(eventId) => {
                        void archiveEvent(eventId);
                      }}
                      onCancelArchive={() => {
                        setArchiveConfirmId(null);
                      }}
                      onClone={beginClone}
                      onEdit={beginEdit}
                      onRequestArchive={setArchiveConfirmId}
                      visible={manager}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
      <CsvImportDialog
        busy={busy || rosterImportInspecting}
        columnMappings={rosterImportMappings.map((mapping) => ({
          ...mapping,
          header: rosterImportHeaders[mapping.sourceIndex] ?? "",
        }))}
        confirmed={rosterImportConfirmed}
        description="Add Profiles from the established roster CSV format."
        error={error}
        file={rosterImportFile}
        helpText="Profiles are created without login access. CSV email addresses are counted as invitation candidates; send Membership invitations separately when ready."
        invalid={Boolean(rosterImportInspection?.fatalError)}
        mappingOptions={rosterCsvColumnOptions.map((value) => ({
          label: value,
          required: value === "Name",
          value,
        }))}
        onClose={() => {
          if (busy) return;
          setRosterImportDialogOpen(false);
          setRosterImportFile(null);
          setRosterImportCsv("");
          setRosterImportHeaders([]);
          setRosterImportMappings([]);
          setRosterImportInspection(null);
          setRosterImportConfirmed(false);
          setRosterImportInspecting(false);
        }}
        onConfirmationChange={setRosterImportConfirmed}
        onFileChange={handleRosterImportFile}
        onImport={() => {
          void importRoster();
        }}
        onMapColumn={handleRosterColumnMap}
        open={rosterImportDialogOpen}
        title="Import roster CSV"
      />
    </section>
  );
}
