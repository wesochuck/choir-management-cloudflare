import { contactListCreateRequestSchema, type ContactList } from "@choir/contracts";
import { useState } from "react";
import { contactErrorMessage, createOrganizationContactList } from "../api";

export function InlineContactListCreator({
  onCreated,
  onBusyChange,
  disabled,
}: {
  readonly onCreated: (list: ContactList) => Promise<void>;
  readonly onBusyChange: (busy: boolean) => void;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    const parsed = contactListCreateRequestSchema.safeParse({ name: name.trim() });
    if (!parsed.success) {
      setError("Enter a list name (up to 200 characters).");
      return;
    }
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const list = await createOrganizationContactList(parsed.data);
      await onCreated(list);
      setOpen(false);
      setName("");
    } catch (cause: unknown) {
      setError(contactErrorMessage(cause, "The contact list could not be created."));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  if (!open)
    return (
      <button
        className="button button--secondary button--control-height"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        New list
      </button>
    );
  return (
    <form
      className="inline-contact-list-creator"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label className="field">
        <span>New list name</span>
        <input
          autoFocus
          disabled={busy || disabled}
          value={name}
          maxLength={200}
          required
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </label>
      <button
        className="button button--primary button--control-height"
        disabled={busy || disabled || !name.trim()}
        type="submit"
      >
        {busy ? "Creating…" : "Create list and add contacts"}
      </button>
      <button
        className="button button--secondary button--control-height"
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setName("");
          setError(null);
        }}
        type="button"
      >
        Cancel
      </button>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
