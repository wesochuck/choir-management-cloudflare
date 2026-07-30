import { useCallback, useMemo, useState, type ReactNode } from "react";

import { FloatingSaveBarContext } from "./useFloatingSaveAction";

interface SaveAction {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly id: string;
  readonly onDiscard?: () => void;
  readonly onSave: () => Promise<void> | void;
}

export function FloatingSaveBarProvider({ children }: { readonly children: ReactNode }) {
  const [actions, setActions] = useState<Readonly<Record<string, SaveAction>>>({});
  const [saving, setSaving] = useState(false);

  const register = useCallback((action: SaveAction) => {
    setActions((current) => ({ ...current, [action.id]: action }));
    return () => {
      setActions((current) => {
        if (current[action.id] !== action) return current;
        return Object.fromEntries(Object.entries(current).filter(([key]) => key !== action.id));
      });
    };
  }, []);

  const dirtyActions = Object.values(actions).filter(({ dirty }) => dirty);
  const busy = saving || Object.values(actions).some(({ busy: actionBusy }) => actionBusy);

  async function saveChanges(): Promise<void> {
    if (busy || dirtyActions.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        dirtyActions.map(async ({ onSave }) => {
          await onSave();
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  function discardChanges(): void {
    if (busy) return;
    dirtyActions.forEach(({ onDiscard }) => onDiscard?.());
  }

  const contextValue = useMemo(() => ({ register }), [register]);

  return (
    <FloatingSaveBarContext.Provider value={contextValue}>
      {children}
      {dirtyActions.length > 0 || saving ? (
        <div className="floating-save-bar" role="status" aria-live="polite">
          <span>{saving ? "Saving changes…" : "You have unsaved changes"}</span>
          <div className="floating-save-bar__actions">
            <button
              className="button button--secondary button--small"
              disabled={busy}
              onClick={discardChanges}
              type="button"
            >
              Discard
            </button>
            <button
              className="button button--primary button--small"
              disabled={busy}
              onClick={() => void saveChanges()}
              type="button"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
    </FloatingSaveBarContext.Provider>
  );
}
