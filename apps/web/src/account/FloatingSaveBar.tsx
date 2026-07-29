import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface SaveAction {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly id: string;
  readonly onDiscard?: () => void;
  readonly onSave: () => Promise<void> | void;
}

interface SaveActionOptions {
  readonly busy?: boolean;
  readonly dirty: boolean;
  readonly id: string;
  readonly onDiscard?: () => void;
  readonly onSave: () => Promise<void> | void;
}

interface FloatingSaveBarContextValue {
  readonly register: (action: SaveAction) => () => void;
}

const FloatingSaveBarContext = createContext<FloatingSaveBarContextValue | null>(null);

export function useFloatingSaveAction({
  busy = false,
  dirty,
  id,
  onDiscard,
  onSave,
}: SaveActionOptions): void {
  const context = useContext(FloatingSaveBarContext);
  if (!context)
    throw new Error("useFloatingSaveAction must be used inside FloatingSaveBarProvider");

  const saveRef = useRef(onSave);
  const discardRef = useRef(onDiscard);

  useEffect(() => {
    saveRef.current = onSave;
    discardRef.current = onDiscard;
  }, [onDiscard, onSave]);

  useEffect(() => {
    const action: SaveAction = {
      busy,
      dirty,
      id,
      onDiscard: () => discardRef.current?.(),
      onSave: () => saveRef.current(),
    };
    return context.register(action);
  }, [busy, context, dirty, id]);
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
