import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog, type ConfirmationOptions } from "./ConfirmDialog";

interface PendingConfirmation extends ConfirmationOptions {
  readonly resolve: (value: boolean | PromiseLike<boolean>) => void;
}

export function useConfirmation(): {
  readonly confirm: (options: ConfirmationOptions) => Promise<boolean>;
  readonly confirmationDialog: ReactNode;
} {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);

  const settle = useCallback((confirmed: boolean): void => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(confirmed);
  }, []);

  const confirm = useCallback((options: ConfirmationOptions): Promise<boolean> => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next: PendingConfirmation = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, []);

  return {
    confirm,
    confirmationDialog: pending ? (
      <ConfirmDialog
        {...(pending.confirmLabel ? { confirmLabel: pending.confirmLabel } : {})}
        description={pending.description}
        destructive={pending.destructive === true}
        onCancel={() => {
          settle(false);
        }}
        onConfirm={() => {
          settle(true);
        }}
        open
        title={pending.title}
      />
    ) : null,
  };
}
