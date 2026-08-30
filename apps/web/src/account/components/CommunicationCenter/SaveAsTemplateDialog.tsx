import { Dialog, DialogClose } from "@choir/ui";
import { useState } from "react";

interface SaveAsTemplateDialogProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSave: (title: string) => Promise<void>;
  readonly open: boolean;
}

export function SaveAsTemplateDialog({
  busy,
  error,
  onClose,
  onSave,
  open,
}: SaveAsTemplateDialogProps) {
  const [title, setTitle] = useState("");

  async function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await onSave(title.trim());
  }

  return (
    <Dialog
      description="Save the current subject and message body as a reusable template."
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
      title="Save as template"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="communication-save-template-name">Template name</label>
          <input
            id="communication-save-template-name"
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            placeholder="e.g. Monthly Rehearsal Reminder"
            required
            value={title}
          />
        </div>

        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button className="button button--primary" disabled={busy || !title.trim()} type="submit">
            {busy ? "Saving…" : "Save template"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
