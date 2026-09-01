import { createContext, useContext, useEffect, useId, useRef } from "react";
import type { LeaveOptions, SaveCoordinatorContextValue, SaveRegistration } from "./types";

export const SaveCoordinatorContext = createContext<SaveCoordinatorContextValue | null>(null);

export function useSaveCoordinator(): SaveCoordinatorContextValue {
  const context = useContext(SaveCoordinatorContext);
  if (!context) {
    throw new Error("useSaveCoordinator must be used within a SaveCoordinatorProvider");
  }
  return context;
}

export function useOptionalSaveCoordinator(): SaveCoordinatorContextValue | null {
  return useContext(SaveCoordinatorContext);
}

// Global fallback bridge for leave requests invoked outside React render trees
type GlobalLeaveHandler = (options: LeaveOptions) => Promise<boolean>;
let globalLeaveHandler: GlobalLeaveHandler | null = null;

export function registerGlobalLeaveHandler(handler: GlobalLeaveHandler): () => void {
  globalLeaveHandler = handler;
  return () => {
    if (globalLeaveHandler === handler) globalLeaveHandler = null;
  };
}

export async function requestGlobalLeave(options: LeaveOptions): Promise<boolean> {
  if (globalLeaveHandler) {
    return globalLeaveHandler(options);
  }
  if (options.action) {
    await options.action();
  }
  return true;
}

export function useSaveRegistration(registration: SaveRegistration | null): void {
  const coordinator = useOptionalSaveCoordinator();
  const registerFn = coordinator?.register;
  const registrationRef = useRef(registration);
  useEffect(() => {
    registrationRef.current = registration;
  });

  const registrationId = useId();
  const id = registration?.id ?? registrationId;
  const resourceKey = registration?.resourceKey;
  const dirty = registration?.dirty;
  const busy = registration?.busy;

  useEffect(() => {
    if (!registerFn || !registrationRef.current) return;
    return registerFn({
      busy: Boolean(busy),
      dirty: Boolean(dirty),
      discard: () => {
        registrationRef.current?.discard();
      },
      id,
      resourceKey: resourceKey ?? "",
      save: () => registrationRef.current?.save() ?? Promise.resolve(true),
    });
  }, [busy, dirty, id, registerFn, resourceKey]);
}
