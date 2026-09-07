import type {
  ContactCommunicationStatus,
  ContactList,
  OrganizationProfile,
} from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useMemo, useState } from "react";

import {
  contactEditorBaselineKey,
  validateContactEditorValues,
  type ContactEditorFieldErrors,
  type ContactEditorInitial,
  type ContactEditorValues,
} from "./contactEditorUtils";

const STATUS_OPTIONS: readonly {
  readonly label: string;
  readonly value: ContactCommunicationStatus;
}[] = [
  { label: "Unknown", value: "unknown" },
  { label: "Subscribed", value: "subscribed" },
  { label: "Unsubscribed", value: "unsubscribed" },
];

function StatusSelect({
  id,
  label,
  onChange,
  value,
}: {
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: ContactCommunicationStatus) => void;
  readonly value: ContactCommunicationStatus;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        onChange={(event) => {
          onChange(
            STATUS_OPTIONS.find((option) => option.value === event.target.value)?.value ??
              "unknown",
          );
        }}
        value={value}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Pure contact form fields (no Dialog wrapper) so labels, validation
 * association, and product language stay covered by component tests.
 */
export function ContactEditorFields({
  fieldErrors,
  formErrorId,
  lists,
  onChange,
  profiles,
  values,
}: {
  readonly fieldErrors: ContactEditorFieldErrors;
  readonly formErrorId: string | undefined;
  readonly lists: readonly ContactList[];
  readonly onChange: (values: ContactEditorValues) => void;
  readonly profiles: readonly OrganizationProfile[];
  readonly values: ContactEditorValues;
}) {
  function set(patch: Partial<ContactEditorValues>): void {
    onChange({ ...values, ...patch });
  }
  const describedBy = [fieldErrors.identity ? `${formErrorId ?? "contact-editor"}-identity` : null]
    .filter((id): id is string => id !== null)
    .join(" ");
  return (
    <>
      {fieldErrors.identity ? (
        <p
          className="notice notice--error"
          id={`${formErrorId ?? "contact-editor"}-identity`}
          role="alert"
        >
          {fieldErrors.identity}
        </p>
      ) : null}
      <div className="contacts-form-row">
        <div className="field">
          <label htmlFor="contact-editor-first-name">First name</label>
          <input
            aria-describedby={describedBy || undefined}
            autoComplete="given-name"
            id="contact-editor-first-name"
            maxLength={200}
            onChange={(event) => {
              set({ firstName: event.target.value });
            }}
            value={values.firstName}
          />
        </div>
        <div className="field">
          <label htmlFor="contact-editor-last-name">Last name</label>
          <input
            autoComplete="family-name"
            id="contact-editor-last-name"
            maxLength={200}
            onChange={(event) => {
              set({ lastName: event.target.value });
            }}
            value={values.lastName}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="contact-editor-display-name">Display name</label>
        <input
          id="contact-editor-display-name"
          maxLength={200}
          onChange={(event) => {
            set({ displayName: event.target.value });
          }}
          value={values.displayName}
        />
        <p className="field-help">Shown in contact lists when no full name is available.</p>
      </div>
      <div className="field">
        <label htmlFor="contact-editor-email">Email</label>
        <input
          aria-describedby={fieldErrors.email ? "contact-editor-email-error" : undefined}
          aria-invalid={Boolean(fieldErrors.email)}
          autoComplete="email"
          id="contact-editor-email"
          maxLength={320}
          onChange={(event) => {
            set({ email: event.target.value });
          }}
          type="email"
          value={values.email}
        />
        {fieldErrors.email ? (
          <p className="contacts-field-error" id="contact-editor-email-error" role="alert">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="contact-editor-phone">Phone</label>
        <input
          autoComplete="tel"
          id="contact-editor-phone"
          maxLength={50}
          onChange={(event) => {
            set({ phone: event.target.value });
          }}
          type="tel"
          value={values.phone}
        />
      </div>
      <div className="field">
        <label htmlFor="contact-editor-source">Source</label>
        <input
          id="contact-editor-source"
          maxLength={200}
          onChange={(event) => {
            set({ source: event.target.value });
          }}
          placeholder="For example: Website signup"
          value={values.source}
        />
        <p className="field-help">Where this contact came from. Importing never implies consent.</p>
      </div>
      <div className="field">
        <label htmlFor="contact-editor-profile">Linked Organization Profile</label>
        <select
          id="contact-editor-profile"
          onChange={(event) => {
            set({ profileId: event.target.value });
          }}
          value={values.profileId}
        >
          <option value="">No linked Organization Profile</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.displayName}
            </option>
          ))}
        </select>
        <p className="field-help">
          Linking never grants sign-in access and never adds the contact to the roster.
        </p>
      </div>
      <div className="contacts-form-row">
        <StatusSelect
          id="contact-editor-email-status"
          label="Email marketing status"
          onChange={(emailStatus) => {
            set({ emailStatus });
          }}
          value={values.emailStatus}
        />
        <StatusSelect
          id="contact-editor-sms-status"
          label="SMS marketing status"
          onChange={(smsStatus) => {
            set({ smsStatus });
          }}
          value={values.smsStatus}
        />
      </div>
      <fieldset className="field">
        <legend>Contact lists</legend>
        {lists.length === 0 ? (
          <p className="field-help">No contact lists exist yet. Create one from Contact lists.</p>
        ) : (
          <div className="contacts-checkbox-group">
            {lists.map((list) => {
              const checked = values.listIds.includes(list.id);
              const checkboxId = `contact-editor-list-${list.id}`;
              return (
                <label className="checkbox-row" htmlFor={checkboxId} key={list.id}>
                  <input
                    checked={checked}
                    id={checkboxId}
                    onChange={(event) => {
                      set({
                        listIds: event.target.checked
                          ? [...values.listIds, list.id]
                          : values.listIds.filter((candidate) => candidate !== list.id),
                      });
                    }}
                    type="checkbox"
                  />
                  {list.name}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
    </>
  );
}

export function ContactEditorDialog({
  busy,
  error,
  initial,
  lists,
  mode,
  onClose,
  onSubmit,
  open,
  profiles,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly initial: ContactEditorInitial;
  readonly lists: readonly ContactList[];
  readonly mode: "create" | "edit";
  readonly onClose: () => void;
  readonly onSubmit: (values: ContactEditorValues) => void;
  readonly open: boolean;
  readonly profiles: readonly OrganizationProfile[];
}) {
  const [values, setValues] = useState<ContactEditorValues>(initial);
  const [attempted, setAttempted] = useState(false);
  const baseline = useMemo(() => contactEditorBaselineKey(initial), [initial]);
  const dirty = contactEditorBaselineKey(values) !== baseline;
  const fieldErrors = attempted ? validateContactEditorValues(values) : {};
  const hasErrors = Boolean(fieldErrors.email ?? fieldErrors.identity);

  return (
    <Dialog
      description={
        mode === "create"
          ? "Add a marketing or community contact. Contacts never appear on the roster."
          : "Update contact details, communication status, and list membership."
      }
      dirty={dirty}
      onClose={onClose}
      open={open}
      title={mode === "create" ? "Add contact" : "Edit contact"}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          const validation = validateContactEditorValues(values);
          if (validation.email ?? validation.identity) {
            return;
          }
          onSubmit(values);
        }}
      >
        {error ? (
          <p className="notice notice--error" id="contact-editor-error" role="alert">
            {error}
          </p>
        ) : null}
        <ContactEditorFields
          fieldErrors={fieldErrors}
          formErrorId="contact-editor-error"
          lists={lists}
          onChange={setValues}
          profiles={profiles}
          values={values}
        />
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            aria-busy={busy}
            className="button button--primary"
            disabled={busy || hasErrors}
            type="submit"
          >
            {busy ? "Saving…" : mode === "create" ? "Create contact" : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
