import { DialogClose } from "@choir/ui";
import type { ProfileTab } from "./types";

export interface ProfileEditorFooterProps {
  readonly activeTab: ProfileTab;
  readonly busy: boolean;
  readonly editingId: string | null;
  readonly isDirty: boolean;
  readonly onSave?: (() => void) | undefined;
  readonly saveLabel?: string | undefined;
}

const INDEPENDENT_TABS: readonly ProfileTab[] = ["performance", "dues", "folders", "messages"];

export function ProfileEditorFooter({
  activeTab,
  busy,
  editingId,
  isDirty,
  onSave,
  saveLabel,
}: ProfileEditorFooterProps) {
  const isIndependentTab = INDEPENDENT_TABS.includes(activeTab);

  // Disable save on independent tabs only when the general profile draft is pristine
  const isSaveDisabled = busy || (isIndependentTab && !isDirty);

  const defaultButtonLabel = editingId ? (saveLabel ?? "Save Profile") : "Create Profile";
  const buttonText = busy ? "Saving…" : defaultButtonLabel;

  return (
    <footer className="profile-editor-footer">
      <div className="profile-editor-footer__status-col">
        {busy ? (
          <span className="profile-editor-footer__status profile-editor-footer__status--busy">
            <span
              aria-hidden="true"
              className="profile-editor-footer__dot profile-editor-footer__dot--busy"
            />
            Saving…
          </span>
        ) : isDirty ? (
          <span className="profile-editor-footer__status profile-editor-footer__status--dirty">
            <span
              aria-hidden="true"
              className="profile-editor-footer__dot profile-editor-footer__dot--dirty"
            />
            Unsaved changes
          </span>
        ) : (
          <span className="profile-editor-footer__status profile-editor-footer__status--pristine">
            <span
              aria-hidden="true"
              className="profile-editor-footer__dot profile-editor-footer__dot--pristine"
            />
            No unsaved changes
          </span>
        )}
      </div>

      <div className="profile-editor-footer__actions-col">
        <DialogClose asChild>
          <button className="button button--secondary" disabled={busy} type="button">
            Cancel
          </button>
        </DialogClose>
        <button
          className="button button--primary"
          disabled={isSaveDisabled}
          onClick={onSave}
          title={
            isIndependentTab && !isDirty ? "No pending profile draft changes to save" : undefined
          }
          type="submit"
        >
          {buttonText}
        </button>
      </div>
    </footer>
  );
}
