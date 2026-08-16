import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConfirmation } from "@choir/ui";

import { FloatingSaveBarContext, registerFloatingSaveNavigation } from "./useFloatingSaveAction";

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
  const { confirm, confirmationDialog } = useConfirmation();

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

  const discardChanges = useCallback((): void => {
    if (busy) return;
    dirtyActions.forEach(({ onDiscard }) => onDiscard?.());
  }, [busy, dirtyActions]);

  const requestNavigation = useCallback(
    async (navigate: () => void): Promise<void> => {
      if (dirtyActions.length === 0) {
        navigate();
        return;
      }
      if (busy) return;
      const shouldDiscard = await confirm({
        confirmLabel: "Discard changes",
        description:
          "You have unsaved changes. Save them from the floating save bar before leaving, or discard them to continue.",
        destructive: true,
        title: "Leave with unsaved changes?",
      });
      if (!shouldDiscard) return;
      discardChanges();
      navigate();
    },
    [busy, confirm, discardChanges, dirtyActions.length],
  );

  useEffect(() => registerFloatingSaveNavigation(requestNavigation), [requestNavigation]);

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

  useEffect(() => {
    if (dirtyActions.length === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari still requires returnValue for the native prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirtyActions.length]);

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
      {confirmationDialog}
    </FloatingSaveBarContext.Provider>
  );
}
