import { useEffect, useMemo, useState } from "react";

import type {
  AuditionStatus,
  OrganizationEvent,
  OrganizationAudition,
  OrganizationAuditionCreateRequest,
  OrganizationAuditionSettings,
  OrganizationMembershipSummary,
  OrganizationProfile,
} from "@choir/contracts";
import { auditionStatusSchema } from "@choir/contracts";
import { Dialog } from "@choir/ui";

import {
  convertOrganizationAudition,
  createOrganizationAudition,
  deleteOrganizationAudition,
  generateAuditionTokens,
  getOrganizationAuditionSettings,
  listOrganizationEvents,
  listOrganizationAuditions,
  listOrganizationMemberships,
  listOrganizationProfiles,
  updateOrganizationAudition,
  updateOrganizationAuditionSettings,
} from "../auth/api";
import { QRCodeShareCard } from "./QRCodeShareCard";

interface Props {
  readonly enabled: boolean;
}

type ManagerState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly auditions: readonly OrganizationAudition[] };

interface AdministratorRecipient {
  readonly email: string;
  readonly profile: OrganizationProfile;
  readonly role: OrganizationMembershipSummary["role"];
}

const STATUS_LABELS: Record<AuditionStatus, string> = {
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No Show",
  pending: "Pending Review",
  scheduled: "Scheduled",
};

function auditionFollowUpUrl(token: string): string {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL("/auditions", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

const STATUS_OPTIONS: readonly { readonly label: string; readonly value: AuditionStatus }[] = [
  { label: "Pending Review", value: "pending" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "No Show", value: "no_show" },
];

const fallbackSettings: OrganizationAuditionSettings = {
  adminNotifyEnabled: false,
  adminNotifyUsers: [],
  confirmationMessage: "Thank you for your interest. We will be in touch soon.",
  defaultPerformanceId: null,
  enabled: true,
  slots: [],
};

const emptyCreate: OrganizationAuditionCreateRequest = {
  availabilityNotes: "",
  email: "",
  experience: "",
  name: "",
  performanceId: null,
  phone: "",
  requestedSlots: [],
  scheduledTimeSlot: null,
  status: "pending",
  voicePart: "",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ManagerStatusPanel({
  enabled,
  status,
}: {
  readonly enabled: boolean;
  readonly status: ManagerState["status"];
}) {
  const message = !enabled
    ? "Audition management requires Organization Manager access and MFA verification."
    : status === "loading"
      ? "Loading auditions…"
      : "Auditions could not be loaded. Try refreshing the page.";
  return (
    <section className="panel" aria-label="Audition management status">
      <p
        className={!enabled || status === "loading" ? undefined : "notice notice--error"}
        role={!enabled || status === "loading" ? undefined : "alert"}
      >
        {message}
      </p>
    </section>
  );
}

function EditAuditionForm({
  audition,
  onCancel,
  onSave,
}: {
  readonly audition: OrganizationAudition;
  readonly onCancel: () => void;
  readonly onSave: (update: {
    readonly adminNotes: string;
    readonly availabilityNotes: string;
    readonly email: string;
    readonly experience: string;
    readonly name: string;
    readonly phone: string;
    readonly status: AuditionStatus;
    readonly voicePart: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(audition.name);
  const [email, setEmail] = useState(audition.email);
  const [phone, setPhone] = useState(audition.phone ?? "");
  const [voicePart, setVoicePart] = useState(audition.voicePart ?? "");
  const [experience, setExperience] = useState(audition.experience ?? "");
  const [availabilityNotes, setAvailabilityNotes] = useState(audition.availabilityNotes ?? "");
  const [status, setStatus] = useState(audition.status);
  const [notes, setNotes] = useState(audition.adminNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        onSave({
          adminNotes: notes,
          availabilityNotes,
          email,
          experience,
          name,
          phone,
          status,
          voicePart,
        })
          .catch(() => {
            setError("The audition could not be saved.");
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
      <label className="field">
        Name
        <input
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <label className="field">
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </label>
      <div className="form-grid form-grid--compact">
        <label className="field">
          Phone
          <input
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Voice part
          <input
            value={voicePart}
            onChange={(event) => {
              setVoicePart(event.target.value);
            }}
          />
        </label>
      </div>
      <label className="field">
        Musical experience
        <textarea
          rows={3}
          value={experience}
          onChange={(event) => {
            setExperience(event.target.value);
          }}
        />
      </label>
      <label className="field">
        Availability notes
        <textarea
          rows={3}
          value={availabilityNotes}
          onChange={(event) => {
            setAvailabilityNotes(event.target.value);
          }}
        />
      </label>
      <label className="field">
        Status
        <select
          value={status}
          onChange={(event) => {
            const parsed = auditionStatusSchema.safeParse(event.target.value);
            if (parsed.success) setStatus(parsed.data);
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Admin notes
        <textarea
          maxLength={10_000}
          rows={5}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </label>
      <div className="form-actions">
        <button className="button button--secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="button" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function CreateAuditionForm({
  onCancel,
  onSave,
}: {
  readonly onCancel: () => void;
  readonly onSave: (audition: OrganizationAuditionCreateRequest) => Promise<void>;
}) {
  const [draft, setDraft] = useState(emptyCreate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function update<K extends keyof OrganizationAuditionCreateRequest>(
    key: K,
    value: OrganizationAuditionCreateRequest[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        onSave(draft)
          .then(onCancel)
          .catch(() => {
            setError("The audition could not be created.");
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
      <label className="field">
        Name
        <input
          required
          value={draft.name}
          onChange={(event) => {
            update("name", event.target.value);
          }}
        />
      </label>
      <label className="field">
        Email
        <input
          required
          type="email"
          value={draft.email}
          onChange={(event) => {
            update("email", event.target.value);
          }}
        />
      </label>
      <label className="field">
        Phone
        <input
          value={draft.phone}
          onChange={(event) => {
            update("phone", event.target.value);
          }}
        />
      </label>
      <label className="field">
        Voice part
        <input
          value={draft.voicePart}
          onChange={(event) => {
            update("voicePart", event.target.value);
          }}
        />
      </label>
      <label className="field">
        Experience
        <textarea
          rows={4}
          value={draft.experience}
          onChange={(event) => {
            update("experience", event.target.value);
          }}
        />
      </label>
      <label className="field">
        Availability notes
        <textarea
          rows={3}
          value={draft.availabilityNotes}
          onChange={(event) => {
            update("availabilityNotes", event.target.value);
          }}
        />
      </label>
      <div className="form-actions">
        <button className="button button--secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="button" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create audition"}
        </button>
      </div>
    </form>
  );
}

function SettingsForm({
  administratorRecipients,
  initial,
  onCancel,
  onSave,
  performances,
}: {
  readonly administratorRecipients: readonly AdministratorRecipient[];
  readonly initial: OrganizationAuditionSettings;
  readonly onCancel: () => void;
  readonly onSave: (settings: OrganizationAuditionSettings) => Promise<void>;
  readonly performances: readonly OrganizationEvent[];
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotStart, setSlotStart] = useState("");
  const [slotEnd, setSlotEnd] = useState("");
  const [slotDate, setSlotDate] = useState("");
  const [slotInterval, setSlotInterval] = useState("15");
  const [recipientEmail, setRecipientEmail] = useState("");
  function addSlot() {
    if (!slotStart || !slotEnd) return;
    const startsAt = new Date(slotStart).toISOString();
    const endsAt = new Date(slotEnd).toISOString();
    if (startsAt >= endsAt) return;
    setDraft((current) => ({
      ...current,
      slots: [...current.slots, { endsAt, id: crypto.randomUUID(), startsAt }].toSorted((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
    }));
    setSlotStart("");
    setSlotEnd("");
  }
  function generateSlots() {
    if (!slotDate || !slotStart || !slotEnd) return;
    const start = new Date(`${slotDate}T${slotStart}`);
    const end = new Date(`${slotDate}T${slotEnd}`);
    const intervalMinutes = Number(slotInterval);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end ||
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < 5 ||
      intervalMinutes > 240
    ) {
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
        setBusy(true);
        setError(null);
        onSave(draft)
          .catch(() => {
            setError("Audition settings could not be saved.");
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
        Confirmation message
        <textarea
          rows={3}
          value={draft.confirmationMessage}
          onChange={(event) => {
            setDraft((current) => ({ ...current, confirmationMessage: event.target.value }));
          }}
        />
      </label>
      <fieldset className="form-stack">
        <legend>Audition time slots</legend>
        <div className="form-grid form-grid--compact">
          <label className="field">
            Generate date
            <input
              type="date"
              value={slotDate}
              onChange={(event) => {
                setSlotDate(event.target.value);
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
                setSlotInterval(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="form-grid form-grid--compact">
          <label className="field">
            Start
            <input
              type="datetime-local"
              value={slotStart}
              onChange={(event) => {
                setSlotStart(event.target.value);
              }}
            />
          </label>
          <label className="field">
            End
            <input
              type="datetime-local"
              value={slotEnd}
              onChange={(event) => {
                setSlotEnd(event.target.value);
              }}
            />
          </label>
        </div>
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
        <button className="button" disabled={busy || draft.slots.length === 0} type="submit">
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

function AuditionTable({
  auditions,
  onConvert,
  onDelete,
  onEdit,
  onSchedule,
  onToggle,
  selectedIds,
}: {
  readonly auditions: readonly OrganizationAudition[];
  readonly onConvert: (audition: OrganizationAudition) => void;
  readonly onDelete: (audition: OrganizationAudition) => void;
  readonly onEdit: (audition: OrganizationAudition) => void;
  readonly onSchedule: (audition: OrganizationAudition) => void;
  readonly onToggle: (id: string) => void;
  readonly selectedIds: readonly string[];
}) {
  return (
    <div className="audition-table" role="table">
      <div className="audition-table__header" role="row">
        <span role="columnheader"> </span>
        <span role="columnheader">Name / contact</span>
        <span role="columnheader">Preferred times</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Submitted</span>
        <span role="columnheader">Actions</span>
      </div>
      {auditions.map((audition) => (
        <div className="audition-table__row" key={audition.id} role="row">
          <span role="cell">
            <input
              aria-label={`Select ${audition.name} for token generation`}
              checked={selectedIds.includes(audition.id)}
              onChange={() => {
                onToggle(audition.id);
              }}
              type="checkbox"
            />
          </span>
          <span role="cell">
            <strong>{audition.name}</strong>
            <small className="table-secondary">
              {audition.email}
              {audition.phone ? ` · ${audition.phone}` : ""}
              {audition.voicePart ? ` · ${audition.voicePart}` : ""}
            </small>
          </span>
          <span role="cell">
            {audition.scheduledTimeSlot
              ? formatDate(audition.scheduledTimeSlot)
              : audition.requestedSlots.length > 0
                ? `${String(audition.requestedSlots.length)} requested`
                : "Any time"}
          </span>
          <span role="cell">
            <span className={`badge badge--${audition.status}`}>
              {STATUS_LABELS[audition.status]}
            </span>
          </span>
          <span role="cell">{formatDate(audition.createdAt)}</span>
          <span role="cell">
            <div className="table-actions">
              <button
                className="text-button"
                onClick={() => {
                  onEdit(audition);
                }}
                type="button"
              >
                Edit
              </button>
              {audition.status === "pending" ? (
                <button
                  className="text-button"
                  onClick={() => {
                    onSchedule(audition);
                  }}
                  type="button"
                >
                  Schedule
                </button>
              ) : null}
              {audition.status === "scheduled" ? (
                <button
                  className="text-button"
                  onClick={() => {
                    onConvert(audition);
                  }}
                  type="button"
                >
                  Convert to Profile
                </button>
              ) : null}
              <button
                className="text-button text-button--danger"
                onClick={() => {
                  onDelete(audition);
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </span>
        </div>
      ))}
    </div>
  );
}

function AuditionDialogs({
  administratorRecipients,
  confirm,
  createAudition,
  createOpen,
  editing,
  executeConfirm,
  onCancelConfirm,
  onCancelCreate,
  onCancelEdit,
  onCancelSchedule,
  onCancelSettings,
  onScheduleTimeChange,
  performances,
  saveEdit,
  saveSettings,
  schedule,
  scheduleAudition,
  scheduleOpen,
  scheduleTime,
  settings,
  settingsOpen,
}: {
  readonly administratorRecipients: readonly AdministratorRecipient[];
  readonly confirm: {
    readonly action: "convert" | "delete";
    readonly audition: OrganizationAudition;
  } | null;
  readonly createAudition: (next: OrganizationAuditionCreateRequest) => Promise<void>;
  readonly createOpen: boolean;
  readonly editing: OrganizationAudition | null;
  readonly executeConfirm: () => Promise<void>;
  readonly onCancelConfirm: () => void;
  readonly onCancelCreate: () => void;
  readonly onCancelEdit: () => void;
  readonly onCancelSchedule: () => void;
  readonly onCancelSettings: () => void;
  readonly onScheduleTimeChange: (value: string) => void;
  readonly performances: readonly OrganizationEvent[];
  readonly saveEdit: (update: {
    readonly adminNotes: string;
    readonly availabilityNotes: string;
    readonly email: string;
    readonly experience: string;
    readonly name: string;
    readonly phone: string;
    readonly status: AuditionStatus;
    readonly voicePart: string;
  }) => Promise<void>;
  readonly saveSettings: (next: OrganizationAuditionSettings) => Promise<void>;
  readonly schedule: OrganizationAudition | null;
  readonly scheduleAudition: () => Promise<void>;
  readonly scheduleOpen: boolean;
  readonly scheduleTime: string;
  readonly settings: OrganizationAuditionSettings;
  readonly settingsOpen: boolean;
}) {
  return (
    <>
      <Dialog
        description="Update contact details, status, and internal notes."
        onClose={onCancelEdit}
        open={editing !== null}
        title="Edit audition"
      >
        {editing ? (
          <EditAuditionForm audition={editing} onCancel={onCancelEdit} onSave={saveEdit} />
        ) : null}
      </Dialog>
      <Dialog
        description="Create an internal audition request."
        onClose={onCancelCreate}
        open={createOpen}
        title="New audition"
      >
        {createOpen ? (
          <CreateAuditionForm onCancel={onCancelCreate} onSave={createAudition} />
        ) : null}
      </Dialog>
      <Dialog
        description="Choose a confirmed time and send the applicant a scheduling update."
        onClose={onCancelSchedule}
        open={scheduleOpen}
        title="Schedule audition"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void scheduleAudition();
          }}
        >
          {schedule?.requestedSlots && schedule.requestedSlots.length > 0 ? (
            <label className="field">
              Requested time
              <select
                value={scheduleTime}
                onChange={(event) => {
                  onScheduleTimeChange(event.target.value);
                }}
              >
                <option value="">Choose a requested time…</option>
                {schedule.requestedSlots.map((slot) => (
                  <option key={slot} value={slot.slice(0, 16)}>
                    {formatDate(slot)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            {schedule?.requestedSlots && schedule.requestedSlots.length > 0
              ? "Or choose a different time"
              : "Confirmed time"}
            <input
              required
              type="datetime-local"
              value={scheduleTime}
              onChange={(event) => {
                onScheduleTimeChange(event.target.value);
              }}
            />
          </label>
          <div className="form-actions">
            <button className="button button--secondary" onClick={onCancelSchedule} type="button">
              Cancel
            </button>
            <button className="button" type="submit">
              Confirm schedule
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog
        description="This change affects the public audition form."
        onClose={onCancelSettings}
        open={settingsOpen}
        title="Audition settings"
      >
        {settingsOpen ? (
          <SettingsForm
            administratorRecipients={administratorRecipients}
            initial={settings}
            onCancel={onCancelSettings}
            onSave={saveSettings}
            performances={performances}
          />
        ) : null}
      </Dialog>
      <Dialog
        description="This action cannot be undone."
        onClose={onCancelConfirm}
        open={confirm !== null}
        title={
          confirm?.action === "convert" ? "Convert to Organization Profile?" : "Delete audition?"
        }
      >
        {confirm ? (
          <div className="form-stack">
            <p>
              {confirm.action === "convert"
                ? `Create an Organization Profile for ${confirm.audition.name} and mark this audition complete?`
                : `Delete the audition request for ${confirm.audition.name}?`}
            </p>
            <div className="form-actions">
              <button className="button button--secondary" onClick={onCancelConfirm} type="button">
                Cancel
              </button>
              <button
                className="button button--danger"
                onClick={() => void executeConfirm()}
                type="button"
              >
                {confirm.action === "convert" ? "Convert" : "Delete"}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

export function AuditionManager({ enabled }: Props) {
  const [state, setState] = useState<ManagerState>({ status: "loading" });
  const [settings, setSettings] = useState<OrganizationAuditionSettings>(fallbackSettings);
  const [performances, setPerformances] = useState<readonly OrganizationEvent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationAudition | null>(null);
  const [schedule, setSchedule] = useState<OrganizationAudition | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [confirm, setConfirm] = useState<{
    readonly action: "convert" | "delete";
    readonly audition: OrganizationAudition;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [administratorRecipients, setAdministratorRecipients] = useState<
    readonly AdministratorRecipient[]
  >([]);
  const [statusFilter, setStatusFilter] = useState<AuditionStatus | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationAuditions(controller.signal)
      .then((auditions) => {
        setState({ auditions, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    getOrganizationAuditionSettings(controller.signal)
      .then(setSettings)
      .catch(() => {
        setSettings(fallbackSettings);
      });
    listOrganizationEvents(controller.signal)
      .then(setPerformances)
      .catch(() => {
        setPerformances([]);
      });
    Promise.all([
      listOrganizationProfiles(controller.signal),
      listOrganizationMemberships(controller.signal),
    ])
      .then(([profiles, membershipResult]) => {
        const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
        setAdministratorRecipients(
          membershipResult.memberships
            .filter(
              (membership) =>
                (membership.role === "owner" || membership.role === "administrator") &&
                membership.profileId !== null,
            )
            .map((membership) => {
              const profile = profilesById.get(membership.profileId ?? "");
              return profile ? { email: membership.email, profile, role: membership.role } : null;
            })
            .filter((recipient): recipient is AdministratorRecipient => recipient !== null),
        );
      })
      .catch(() => {
        setAdministratorRecipients([]);
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const filteredAuditions = useMemo(() => {
    if (state.status !== "ready") return [];
    const query = search.trim().toLocaleLowerCase();
    return state.auditions.filter((audition) => {
      const matchesStatus = statusFilter === "all" || audition.status === statusFilter;
      const matchesSearch =
        !query ||
        `${audition.name} ${audition.email} ${audition.voicePart ?? ""}`
          .toLocaleLowerCase()
          .includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [search, state, statusFilter]);

  function replaceAudition(updated: OrganizationAudition) {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            auditions: current.auditions.map((candidate) =>
              candidate.id === updated.id ? updated : candidate,
            ),
          }
        : current,
    );
  }

  async function saveEdit(update: {
    readonly adminNotes: string;
    readonly availabilityNotes: string;
    readonly email: string;
    readonly experience: string;
    readonly name: string;
    readonly phone: string;
    readonly status: AuditionStatus;
    readonly voicePart: string;
  }) {
    if (!editing) return;
    const updated = await updateOrganizationAudition(editing.id, update);
    replaceAudition(updated);
    setEditing(null);
    setNotice("Audition updated.");
  }

  async function saveSettings(next: OrganizationAuditionSettings) {
    setSettings(await updateOrganizationAuditionSettings(next));
    setSettingsOpen(false);
    setNotice("Audition settings saved.");
  }

  async function createAudition(next: OrganizationAuditionCreateRequest) {
    const created = await createOrganizationAudition(next);
    setState((current) =>
      current.status === "ready"
        ? { ...current, auditions: [created, ...current.auditions] }
        : current,
    );
    setCreateOpen(false);
    setNotice("Audition created.");
  }

  async function executeConfirm() {
    if (!confirm) return;
    setActionError(null);
    try {
      if (confirm.action === "delete") {
        await deleteOrganizationAudition(confirm.audition.id);
        setState((current) =>
          current.status === "ready"
            ? {
                ...current,
                auditions: current.auditions.filter(({ id }) => id !== confirm.audition.id),
              }
            : current,
        );
        setNotice("Audition deleted.");
      } else {
        await convertOrganizationAudition(confirm.audition.id);
        replaceAudition({
          ...confirm.audition,
          status: "completed",
          updatedAt: new Date().toISOString(),
        });
        setNotice("Audition converted to an Organization Profile.");
      }
      setConfirm(null);
    } catch {
      setActionError("That audition action could not be completed. Try again.");
    }
  }

  async function scheduleAudition() {
    if (!schedule || !scheduleTime) return;
    setActionError(null);
    try {
      const updated = await updateOrganizationAudition(schedule.id, {
        scheduledTimeSlot: new Date(scheduleTime).toISOString(),
        status: "scheduled",
      });
      replaceAudition(updated);
      setSchedule(null);
      setScheduleTime("");
      setNotice("Audition scheduled.");
    } catch {
      setActionError("The audition could not be scheduled. Choose a valid time and try again.");
    }
  }

  async function generateTokens() {
    if (selectedIds.length === 0) return;
    setActionError(null);
    try {
      const generated = await generateAuditionTokens(selectedIds);
      setTokens((current) => ({ ...current, ...generated }));
      setNotice(`${String(selectedIds.length)} token(s) generated.`);
    } catch {
      setActionError("Tokens could not be generated. Confirm the selected auditions still exist.");
    }
  }

  if (!enabled || state.status !== "ready") {
    return <ManagerStatusPanel enabled={enabled} status={state.status} />;
  }

  return (
    <section className="panel" aria-label="Audition management">
      <div className="page-toolbar">
        <p className="section-description">
          Review inquiries, schedule time slots, and convert candidates into Organization Profiles.
        </p>
        <div className="table-actions">
          <button
            className="button"
            onClick={() => {
              setCreateOpen(true);
            }}
            type="button"
          >
            New audition
          </button>
          <button
            className="button button--secondary"
            onClick={() => {
              setSettingsOpen(true);
            }}
            type="button"
          >
            Settings
          </button>
        </div>
      </div>
      {notice ? (
        <p className="notice notice--success" role="status">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      <QRCodeShareCard
        description={
          settings.enabled && settings.defaultPerformanceId && settings.slots.length > 0
            ? "Share this link or download the QR code so prospective singers can submit an audition request."
            : "This is the public audition signup link. Configure a performance and time slots, then enable requests before sharing it."
        }
        path="/auditions"
        title="Public audition signup page"
      />
      <div className="form-grid form-grid--compact">
        <label className="field">
          Search
          <input
            placeholder="Name, email, voice part"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Narrow results
          <select
            aria-label="Audition filter"
            value={statusFilter}
            onChange={(event) => {
              const value = event.target.value;
              setStatusFilter(value === "all" ? "all" : auditionStatusSchema.parse(value));
            }}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="field-help audition-token-help">
        Need to follow up with selected applicants? Generate secure, expiring links that let them
        review or update their audition information. These links are different from the public
        signup page above.
      </p>
      <div className="form-actions form-actions--start audition-selection-actions">
        <button
          className="button button--secondary"
          disabled={selectedIds.length === 0}
          onClick={() => void generateTokens()}
          type="button"
        >
          Generate {String(selectedIds.length)} follow-up link(s)
        </button>
        <button
          className="button button--secondary"
          onClick={() => {
            setSelectedIds(filteredAuditions.map(({ id }) => id));
          }}
          type="button"
        >
          Select visible
        </button>
        <button
          className="text-button"
          onClick={() => {
            setSelectedIds([]);
          }}
          type="button"
        >
          Clear selection
        </button>
      </div>
      {filteredAuditions.length === 0 ? (
        <div className="notice">
          {state.auditions.length === 0
            ? "No audition inquiries yet. Configure settings or create an audition to begin."
            : "No auditions match the current filters."}
        </div>
      ) : (
        <AuditionTable
          auditions={filteredAuditions}
          onConvert={(audition) => {
            setConfirm({ action: "convert", audition });
          }}
          onDelete={(audition) => {
            setConfirm({ action: "delete", audition });
          }}
          onEdit={setEditing}
          onSchedule={(audition) => {
            setSchedule(audition);
            setScheduleTime(
              audition.scheduledTimeSlot
                ? new Date(audition.scheduledTimeSlot).toISOString().slice(0, 16)
                : "",
            );
          }}
          onToggle={(id) => {
            setSelectedIds((current) =>
              current.includes(id)
                ? current.filter((candidate) => candidate !== id)
                : [...current, id],
            );
          }}
          selectedIds={selectedIds}
        />
      )}
      {Object.keys(tokens).length > 0 ? (
        <details className="mt-4">
          <summary>Generated follow-up links</summary>
          <p className="field-help">
            These secure links expire after 90 days. Copy the full link when sending it to an
            applicant.
          </p>
          <ul className="account-list">
            {Object.entries(tokens).map(([id, token]) => {
              const link = auditionFollowUpUrl(token);
              return (
                <li className="flex items-center gap-2" key={id}>
                  <strong>
                    {`${state.auditions.find((audition) => audition.id === id)?.name ?? id}:`}
                  </strong>
                  <a
                    className="text-xs break-all flex-1"
                    href={link}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {link}
                  </a>
                  <button
                    className="button button--secondary button--sm"
                    onClick={() => void navigator.clipboard.writeText(link)}
                    type="button"
                  >
                    Copy link
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      <AuditionDialogs
        administratorRecipients={administratorRecipients}
        confirm={confirm}
        createAudition={createAudition}
        createOpen={createOpen}
        editing={editing}
        executeConfirm={executeConfirm}
        onCancelConfirm={() => {
          setConfirm(null);
        }}
        onCancelCreate={() => {
          setCreateOpen(false);
        }}
        onCancelEdit={() => {
          setEditing(null);
        }}
        onCancelSchedule={() => {
          setSchedule(null);
        }}
        onCancelSettings={() => {
          setSettingsOpen(false);
        }}
        onScheduleTimeChange={setScheduleTime}
        performances={performances}
        saveEdit={saveEdit}
        saveSettings={saveSettings}
        schedule={schedule}
        scheduleAudition={scheduleAudition}
        scheduleOpen={schedule !== null}
        scheduleTime={scheduleTime}
        settings={settings}
        settingsOpen={settingsOpen}
      />
    </section>
  );
}
