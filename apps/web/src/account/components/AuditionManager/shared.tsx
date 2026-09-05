import { useState } from "react";
import { DialogClose } from "@choir/ui";
import type {
  AuditionStatus,
  OrganizationAudition,
  OrganizationAuditionCreateRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { auditionStatusSchema } from "@choir/contracts";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { emptyCreate, STATUS_OPTIONS } from "./utils";
import type { ManagerState } from "./types";

export function ManagerStatusPanel({
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

export function EditAuditionForm({
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
  const { partLabel } = useOrganizationTerminology();
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
          {partLabel}
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
        <DialogClose asChild>
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </DialogClose>
        <button aria-busy={busy} className="button button--primary" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function CreateAuditionForm({
  onCancel,
  onSave,
  rosterConfiguration,
}: {
  readonly onCancel: () => void;
  readonly onSave: (audition: OrganizationAuditionCreateRequest) => Promise<void>;
  readonly rosterConfiguration: OrganizationRosterConfiguration | null;
}) {
  const { partLabel, partLabelPlural } = useOrganizationTerminology();
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
        {partLabel}
        <select
          disabled={rosterConfiguration === null}
          value={draft.voicePart}
          onChange={(event) => {
            update("voicePart", event.target.value);
          }}
        >
          <option value="">
            {rosterConfiguration === null
              ? `Loading ${partLabelPlural.toLowerCase()}…`
              : `No ${partLabel.toLowerCase()}`}
          </option>
          {rosterConfiguration
            ? (() => {
                const partsBySection = new Map<string, typeof rosterConfiguration.voiceParts>();
                for (const part of rosterConfiguration.voiceParts) {
                  const parts = partsBySection.get(part.sectionCode) ?? [];
                  parts.push(part);
                  partsBySection.set(part.sectionCode, parts);
                }
                return rosterConfiguration.sections
                  .filter((section) => !section.trackOnly)
                  .map((section) => {
                    const parts = partsBySection.get(section.code) ?? [];
                    if (parts.length === 0) return null;
                    return (
                      <optgroup key={section.code} label={section.name}>
                        {parts.map((part) => (
                          <option key={part.label} value={part.label}>
                            {part.fullName} ({part.label})
                          </option>
                        ))}
                      </optgroup>
                    );
                  });
              })()
            : null}
        </select>
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
        <DialogClose asChild>
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </DialogClose>
        <button aria-busy={busy} className="button button--primary" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create audition"}
        </button>
      </div>
    </form>
  );
}
