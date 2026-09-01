/* eslint-disable react-refresh/only-export-components */
import { useConfirmation } from "@choir/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SaveCoordinatorContext } from "./SaveCoordinatorContext";
import type { LeaveOptions, SaveCoordinatorContextValue, SaveRegistration } from "./types";

export {
  SaveCoordinatorContext,
  useSaveCoordinator,
  useOptionalSaveCoordinator,
  registerGlobalLeaveHandler,
  requestGlobalLeave,
  useSaveRegistration,
} from "./SaveCoordinatorContext";

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
        existing?.dirty === registration.dirty &&
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
        const next: Record<string, SaveRegistration> = {};
        for (const [key, val] of Object.entries(current)) {
          if (key !== registration.id) {
            next[key] = val;
          }
        }
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
    for (const reg of Object.values(registrationsRef.current)) {
      if (reg.dirty) {
        reg.discard();
      }
    }
  }, [isBusy]);

  const saveAll = useCallback(async (): Promise<{
    errors: readonly string[];
    success: boolean;
  }> => {
    if (isBusy) return { errors: ["Save already in progress."], success: false };
    const dirtyItems = Object.values(registrationsRef.current).filter(({ dirty }) => dirty);
    if (dirtyItems.length === 0) return { errors: [], success: true };

    setSaving(true);
    try {
      const results = await Promise.allSettled(dirtyItems.map((reg) => reg.save()));
      const errors: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const dirtyItem = dirtyItems[i];
        if (!res || !dirtyItem) continue;
        if (res.status === "rejected") {
          const reason: unknown = res.reason;
          errors.push(
            reason instanceof Error ? reason.message : `Failed to save ${dirtyItem.resourceKey}`,
          );
        } else if (!res.value) {
          errors.push(`Failed to save ${dirtyItem.resourceKey}`);
        }
      }

      return {
        errors,
        success: errors.length === 0,
      };
    } finally {
      setSaving(false);
    }
  }, [isBusy]);

  const requestLeave = useCallback(
    async ({ action, reason }: LeaveOptions): Promise<boolean> => {
      if (!isDirty) {
        if (action) await action();
        return true;
      }

      const confirmed = await confirm({
        confirmLabel: "Discard changes",
        description:
          reason === "workspace-switch"
            ? "You have unsaved changes in this Organization. Discard changes and switch Organizations?"
            : reason === "sign-out"
              ? "You have unsaved changes. Discard changes and sign out?"
              : "You have unsaved changes. Discard changes and leave this page?",
        destructive: true,
        title: "Unsaved changes",
      });

      if (!confirmed) {
        return false;
      }

      discardAll();
      if (action) {
        await action();
      }
      return true;
    },
    [confirm, discardAll, isDirty],
  );

  // Intercept window unload / tab close
  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
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
      isSaving: isBusy,
      register,
      requestLeave,
      saveAll,
    }),
    [dirtyRegistrations.length, discardAll, isBusy, isDirty, register, requestLeave, saveAll],
  );

  return (
    <SaveCoordinatorContext.Provider value={contextValue}>
      {children}
      {confirmationDialog}
    </SaveCoordinatorContext.Provider>
  );
}
