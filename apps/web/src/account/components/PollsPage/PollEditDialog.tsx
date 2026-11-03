import { Dialog, DialogClose } from "@choir/ui";
import { useState, type ReactNode, type SyntheticEvent } from "react";

import { UnusualTimeInput } from "../../../shared/UnusualTimeInput";

function PollOptionsFieldset({
  editingPollHasResponses,
  error,
  onOptionsChange,
  options,
}: {
  readonly editingPollHasResponses: boolean;
  readonly error?: string | null | undefined;
  readonly onOptionsChange: (val: string[]) => void;
  readonly options: readonly string[];
}) {
  return (
    <fieldset>
      <legend>Options</legend>
      {options.map((option, index) => (
        <label key={index}>
          Option {String(index + 1)}
          <input
            aria-describedby={error ? "poll-dialog-error" : undefined}
            aria-invalid={Boolean(error)}
            disabled={editingPollHasResponses}
            onChange={(event) => {
              onOptionsChange(
                options.map((value, optionIndex) =>
                  optionIndex === index ? event.target.value : value,
                ),
              );
            }}
            required
            value={option}
          />
        </label>
      ))}
    </fieldset>
  );
}

function PollEditFormFields({
  description,
  error,
  expiresAt,
  onDescriptionChange,
  onExpiresAtChange,
  onTitleChange,
  title,
}: {
  readonly description: string;
  readonly error?: string | null | undefined;
  readonly expiresAt: string;
  readonly onDescriptionChange: (val: string) => void;
  readonly onExpiresAtChange: (val: string) => void;
  readonly onTitleChange: (val: string) => void;
  readonly title: string;
}) {
  const errorId = error ? "poll-dialog-error" : undefined;
  const isInvalid = Boolean(error);
  return (
    <>
      <label>
        Title
        <input
          aria-describedby={errorId}
          aria-invalid={isInvalid}
          onChange={(event) => {
            onTitleChange(event.target.value);
          }}
          required
          value={title}
        />
      </label>
      <label>
        Description
        <textarea
          aria-describedby={errorId}
          aria-invalid={isInvalid}
          onChange={(event) => {
            onDescriptionChange(event.target.value);
          }}
          value={description}
        />
      </label>
      <label>
        Expiration date and time
        <UnusualTimeInput
          aria-describedby={errorId}
          aria-invalid={isInvalid}
          onChange={(event) => {
            onExpiresAtChange(event.target.value);
          }}
          required
          type="datetime-local"
          value={expiresAt}
        />
        <span className="field-help">Responses will no longer be accepted after this time.</span>
      </label>
    </>
  );
}

function PollEditDialogActions({
  archivedAt,
  archiving,
  confirmingArchive,
  editingPollId,
  onArchive,
  onRequestArchive,
  saving,
}: {
  readonly archivedAt: string;
  readonly archiving: boolean;
  readonly confirmingArchive: boolean;
  readonly editingPollId: string | null;
  readonly onArchive?: ((pollId: string) => Promise<void>) | undefined;
  readonly onRequestArchive: () => void;
  readonly saving: boolean;
}) {
  const canArchive = Boolean(editingPollId && !archivedAt && onArchive && !confirmingArchive);
  const saveLabel = saving ? "Saving…" : editingPollId ? "Save changes" : "Create poll";
  return (
    <div className="dialog__actions">
      <DialogClose asChild>
        <button className="button button--secondary" disabled={saving || archiving} type="button">
          Cancel
        </button>
      </DialogClose>
      {canArchive ? (
        <button
          className="button button--secondary"
          disabled={saving || archiving}
          onClick={onRequestArchive}
          type="button"
        >
          Archive poll
        </button>
      ) : null}
      <button
        aria-busy={saving}
        className="button button--primary"
        disabled={saving || archiving || confirmingArchive}
        type="submit"
      >
        {saveLabel}
      </button>
    </div>
  );
}

export function PollEditDialog({
  archivedAt = "",
  archiving = false,
  description,
  editingPollHasResponses,
  editingPollId,
  error,
  expiresAt,
  onArchive,
  onClose,
  onDescriptionChange,
  onExpiresAtChange,
  onOptionsChange,
  onSave,
  onTitleChange,
  open,
  options,
  renderArchiveConfirmation,
  saving,
  title,
}: {
  readonly archivedAt?: string | undefined;
  readonly archiving?: boolean | undefined;
  readonly description: string;
  readonly editingPollHasResponses: boolean;
  readonly editingPollId: string | null;
  readonly error?: string | null | undefined;
  readonly expiresAt: string;
  readonly onArchive?: ((pollId: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
  readonly onDescriptionChange: (val: string) => void;
  readonly onExpiresAtChange: (val: string) => void;
  readonly onOptionsChange: (val: string[]) => void;
  readonly onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
  readonly onTitleChange: (val: string) => void;
  readonly open: boolean;
  readonly options: string[];
  readonly renderArchiveConfirmation?:
    | ((callbacks: { readonly onCancel: () => void; readonly onConfirm: () => void }) => ReactNode)
    | undefined;
  readonly saving: boolean;
  readonly title: string;
}) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  function handleClose(): void {
    setConfirmingArchive(false);
    onClose();
  }

  return (
    <Dialog
      description="Ask a question with exactly two response options (Yes and No by default)."
      onClose={handleClose}
      open={open}
      title={editingPollId ? "Edit poll" : "Create poll"}
    >
      <form className="stack-form" onSubmit={onSave}>
        {error ? (
          <p className="notice notice--error" id="poll-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        {editingPollHasResponses ? (
          <p className="notice notice--info">
            This poll has received responses. Option structure is locked to protect response
            integrity. You can still update the title, description, and expiration date.
          </p>
        ) : null}
        <PollEditFormFields
          description={description}
          error={error}
          expiresAt={expiresAt}
          onDescriptionChange={onDescriptionChange}
          onExpiresAtChange={onExpiresAtChange}
          onTitleChange={onTitleChange}
          title={title}
        />
        <PollOptionsFieldset
          editingPollHasResponses={editingPollHasResponses}
          error={error}
          onOptionsChange={onOptionsChange}
          options={options}
        />

        {confirmingArchive && editingPollId && onArchive ? (
          renderArchiveConfirmation ? (
            renderArchiveConfirmation({
              onCancel: () => {
                setConfirmingArchive(false);
              },
              onConfirm: () => {
                void onArchive(editingPollId).then(() => {
                  setConfirmingArchive(false);
                  onClose();
                });
              },
            })
          ) : (
            <div className="danger-confirmation" role="group" aria-label="Confirm archiving poll">
              <p>
                Archive this poll? Voting will close immediately while preserving all responses.
              </p>
              <div className="form-actions">
                <button
                  className="button button--secondary button--small"
                  disabled={archiving}
                  onClick={() => {
                    setConfirmingArchive(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="button button--danger button--small"
                  disabled={archiving}
                  onClick={() => {
                    void onArchive(editingPollId).then(() => {
                      setConfirmingArchive(false);
                      onClose();
                    });
                  }}
                  type="button"
                >
                  {archiving ? "Archiving…" : "Confirm archive"}
                </button>
              </div>
            </div>
          )
        ) : null}

        <PollEditDialogActions
          archivedAt={archivedAt}
          archiving={archiving}
          confirmingArchive={confirmingArchive}
          editingPollId={editingPollId}
          onArchive={onArchive}
          onRequestArchive={() => {
            setConfirmingArchive(true);
          }}
          saving={saving}
        />
      </form>
    </Dialog>
  );
}
