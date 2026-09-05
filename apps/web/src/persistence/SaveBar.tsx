import { useState } from "react";
import { useOptionalSaveCoordinator } from "./SaveCoordinator";

export function SaveBar() {
  const coordinator = useOptionalSaveCoordinator();
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDirty = coordinator?.isDirty ?? false;
  const isSaving = coordinator?.isSaving ?? false;

  if (!isDirty && !isSaving && saveError) {
    setSaveError(null);
  }

  if (!coordinator) return null;

  const { discardAll, saveAll } = coordinator;
  if (!isDirty && !isSaving) return null;

  const handleSave = async () => {
    setSaveError(null);
    const result = await saveAll();
    if (!result.success && result.errors.length > 0) {
      setSaveError(result.errors.join(". "));
    }
  };

  const handleDiscard = () => {
    setSaveError(null);
    discardAll();
  };

  return (
    <div
      aria-label="Unsaved changes"
      aria-live="polite"
      className="floating-save-bar"
      role="region"
    >
      {saveError ? (
        <p className="notice notice--error" role="alert">
          {saveError}
        </p>
      ) : (
        <span>{isSaving ? "Saving changes…" : "You have unsaved changes"}</span>
      )}
      <div className="floating-save-bar__actions">
        <button
          className="button button--secondary button--small"
          disabled={isSaving}
          onClick={handleDiscard}
          type="button"
        >
          Discard
        </button>
        <button
          className="button button--primary button--small"
          disabled={isSaving}
          onClick={() => {
            void handleSave();
          }}
          type="button"
        >
          {isSaving ? "Saving…" : saveError ? "Retry save" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
