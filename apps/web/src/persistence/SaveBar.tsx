import { useOptionalSaveCoordinator } from "./SaveCoordinator";

export function SaveBar() {
  const coordinator = useOptionalSaveCoordinator();
  if (!coordinator) return null;

  const { discardAll, isDirty, isSaving, saveAll } = coordinator;
  if (!isDirty && !isSaving) return null;

  return (
    <div
      aria-label="Unsaved changes"
      aria-live="polite"
      className="floating-save-bar"
      role="region"
    >
      <span>{isSaving ? "Saving changes…" : "You have unsaved changes"}</span>
      <div className="floating-save-bar__actions">
        <button
          className="button button--secondary button--small"
          disabled={isSaving}
          onClick={discardAll}
          type="button"
        >
          Discard
        </button>
        <button
          className="button button--primary button--small"
          disabled={isSaving}
          onClick={() => {
            void saveAll();
          }}
          type="button"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
