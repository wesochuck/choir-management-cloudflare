import { useEffect, useState } from "react";
import type {
  DayOfWeek,
  OrganizationEvent,
  OrganizationAuditionSettings,
  OrganizationVenue,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { AuthApiError, createOrganizationVenue } from "../../../../auth/api";
import { usePersistedDraft } from "../../../../persistence";
import { formatDate, slotUtcValue } from "../utils";
import type { AdministratorRecipient } from "../types";
import {
  DEFAULT_REHEARSAL_END,
  DEFAULT_REHEARSAL_START,
  DEFAULT_SLOT_END,
  DEFAULT_SLOT_START,
} from "./constants";
import { auditionSettingsKey } from "./utils";
import { RegularRehearsalScheduleSection } from "./RehearsalScheduleSection";
import { AuditionSlotsSection } from "./SlotsSection";
import { AdminNotificationsSection } from "./AdminNotificationsSection";

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

  const {
    dirty,
    draft,
    error: draftError,
    save: saveDraft,
    saving: busy,
    setDraft,
  } = usePersistedDraft<OrganizationAuditionSettings>({
    equals: (a, b) => auditionSettingsKey(a) === auditionSettingsKey(b),
    initialValue: initial,
    resourceKey: "organization-audition-settings",
    save: async (currentDraft) => {
      const isAudition = currentDraft.mode === "audition";
      if (isAudition && !currentDraft.venueId) {
        throw new Error("Choose an Organization venue for the auditions before saving.");
      }
      if (isAudition && currentDraft.slots.length === 0) {
        throw new Error("Add at least one audition time slot before saving.");
      }
      const payload: OrganizationAuditionSettings = isAudition
        ? currentDraft
        : {
            ...currentDraft,
            defaultPerformanceId: null,
            startDate: currentDraft.startDate ?? null,
            venueId: null,
          };
      await onSave(payload);
      return payload;
    },
  });

  useEffect(() => {
    onDirtyChange(dirty);
    return () => {
      onDirtyChange(false);
    };
  }, [dirty, onDirtyChange]);

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
    if (!email || !email.includes("@") || !draft || draft.adminNotifyUsers.includes(email)) return;
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

  if (!draft) return null;

  const isAuditionMode = draft.mode === "audition";
  const effectiveError = error ?? draftError;

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void saveDraft();
      }}
    >
      {effectiveError ? (
        <p className="notice notice--error" role="alert">
          {effectiveError}
        </p>
      ) : null}

      <fieldset className="surface-card organization-settings-panel form-stack">
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
