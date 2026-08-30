import { Dialog, DialogClose } from "@choir/ui";
import { useState } from "react";

interface CommunicationTestDialogProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSend: (email: string) => Promise<void>;
  readonly open: boolean;
}

export function CommunicationTestDialog({
  busy,
  error,
  onClose,
  onSend,
  open,
}: CommunicationTestDialogProps) {
  const [email, setEmail] = useState("");

  async function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    await onSend(email.trim());
  }

  return (
    <Dialog
      description="Send a test version of this message using the current draft and sample recipient values."
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
      title="Send test email"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="communication-test-recipient-email">Test recipient email</label>
          <input
            id="communication-test-recipient-email"
            maxLength={320}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            placeholder="you@example.test"
            required
            type="email"
            value={email}
          />
          <p className="field-help">
            The test email will resolve sample recipient and event data matching the live preview.
          </p>
        </div>

        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button className="button button--primary" disabled={busy || !email.trim()} type="submit">
            {busy ? "Sending…" : "Send test email"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
