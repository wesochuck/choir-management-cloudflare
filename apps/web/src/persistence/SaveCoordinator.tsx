import { useConfirmation } from "@choir/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

export function SaveCoordinatorProvider({ children }: { readonly children: ReactNode }) {
  const [registrations, setRegistrations] = useState<Readonly<Record<string, SaveRegistration>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const { confirm, confirmationDialog } = useConfirmation();
  const registrationsRef = useRef(registrations);
  useEffect(() => {
    registrationsRef.current = registrations;
  });

  const register = useCallback((registration: SaveRegistration) => {
    setRegistrations((current) => {
      const existing = current[registration.id];
      if (
        existing &&
        existing.dirty === registration.dirty &&
        existing.busy === registration.busy &&
        existing.resourceKey === registration.resourceKey
      ) {
        return current;
      }
      const duplicate = Object.values(current).find(
        (other) => other.id !== registration.id && other.resourceKey === registration.resourceKey,
      );
      if (duplicate) {
        console.error(
          `[SaveCoordinator] Duplicate draft registration detected for resourceKey: "${registration.resourceKey}". Component id "${registration.id}" collided with "${duplicate.id}".`,
        );
      }
      return { ...current, [registration.id]: registration };
    });

    return () => {
      setRegistrations((current) => {
        if (!current[registration.id]) return current;
        const next = { ...current };
        delete next[registration.id];
        return next;
      });
    };
  }, []);

  const dirtyRegistrations = useMemo(
    () => Object.values(registrations).filter(({ dirty }) => dirty),
    [registrations],
  );

  const isDirty = dirtyRegistrations.length > 0;
  const isBusy = saving || Object.values(registrations).some(({ busy }) => busy);

  const discardAll = useCallback(() => {
    if (isBusy) return;
    dirtyRegistrations.forEach(({ discard }) => {
      discard();
    });
  }, [dirtyRegistrations, isBusy]);

  const saveAll = useCallback(async (): Promise<{
    readonly errors: readonly string[];
    readonly success: boolean;
  }> => {
    if (isBusy || dirtyRegistrations.length === 0) {
      return { errors: [], success: true };
    }
    setSaving(true);
    try {
      const results = await Promise.allSettled(
        dirtyRegistrations.map(async (reg) => {
          const ok = await reg.save();
          if (!ok) {
            throw new Error(`Failed to save draft for ${reg.resourceKey}`);
          }
        }),
      );
      const errors: string[] = [];
      results.forEach((res) => {
        if (res.status === "rejected") {
          errors.push(
            res.reason instanceof Error ? res.reason.message : "An unexpected save error occurred.",
          );
        }
      });
      return {
        errors,
        success: errors.length === 0,
      };
    } finally {
      setSaving(false);
    }
  }, [dirtyRegistrations, isBusy]);

  const requestLeave = useCallback(
    async (options: LeaveOptions): Promise<boolean> => {
      const activeDirty = Object.values(registrationsRef.current).filter(({ dirty }) => dirty);
      if (activeDirty.length === 0) {
        if (options.action) await options.action();
        return true;
      }
      if (isBusy) return false;

      let title = options.title;
      let description = options.description;
      let confirmLabel = "Discard changes";

      if (!title) {
        if (options.reason === "sign-out") {
          title = "Sign out with unsaved changes?";
          description =
            "Your unsaved changes will be discarded if you sign out without saving them.";
          confirmLabel = "Discard & sign out";
        } else if (options.reason === "workspace-switch") {
          title = "Switch workspace with unsaved changes?";
          description =
            "You have unsaved changes in this workspace. Discard them to switch workspaces, or stay to save them.";
          confirmLabel = "Discard & switch";
        } else {
          title = "Leave with unsaved changes?";
          description =
            "You have unsaved changes. Save them from the save bar before leaving, or discard them to continue.";
          confirmLabel = "Discard changes";
        }
      }

      const shouldDiscard = await confirm({
        confirmLabel,
        description: description ?? "You have unsaved changes that will be lost if you leave.",
        destructive: true,
        title,
      });

      if (!shouldDiscard) return false;

      activeDirty.forEach(({ discard }) => {
        discard();
      });

      if (options.action) {
        await options.action();
      }
      return true;
    },
    [confirm, isBusy],
  );

  useEffect(() => {
    return registerGlobalLeaveHandler(requestLeave);
  }, [requestLeave]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari still requires returnValue
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty]);

  const contextValue: SaveCoordinatorContextValue = useMemo(
    () => ({
      dirtyCount: dirtyRegistrations.length,
      discardAll,
      isDirty,
      isSaving: saving,
      register,
      requestLeave,
      saveAll,
    }),
    [dirtyRegistrations.length, discardAll, isDirty, register, requestLeave, saveAll, saving],
  );

  return (
    <SaveCoordinatorContext.Provider value={contextValue}>
      {children}
      {confirmationDialog}
    </SaveCoordinatorContext.Provider>
  );
}

export function useSaveRegistration(registration: SaveRegistration | null): void {
  const coordinator = useOptionalSaveCoordinator();
  const registerFn = coordinator?.register;
  const registrationRef = useRef(registration);
  useEffect(() => {
    registrationRef.current = registration;
  });

  const registrationId = useId();
  const id = registration?.id || registrationId;
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
