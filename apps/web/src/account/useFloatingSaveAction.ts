import { createContext, useContext, useEffect, useRef } from "react";

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

export const FloatingSaveBarContext = createContext<FloatingSaveBarContextValue | null>(null);

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
