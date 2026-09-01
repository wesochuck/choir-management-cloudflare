import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useOptionalSaveCoordinator } from "./SaveCoordinator";
import type { PersistedDraftOptions, PersistedDraftReturn, SaveRegistration } from "./types";

function isArraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!defaultEquals(a[i], b[i])) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectsEqual(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!defaultEquals(a[key], b[key])) return false;
  }
  return true;
}

function defaultEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return isArraysEqual(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return false;
  }
  if (isRecord(a) && isRecord(b)) {
    return isObjectsEqual(a, b);
  }
  return false;
}

function defaultNormalize<T>(value: T): T {
  return value;
}

function isFunctionUpdater<T>(value: T | ((prev: T) => T)): value is (prev: T) => T {
  return typeof value === "function";
}

export function usePersistedDraft<T, TRequest = T>({
  autoRegister = true,
  equals = defaultEquals,
  initialValue,
  normalize = defaultNormalize,
  onSaveError,
  onSaveSuccess,
  resourceKey,
  save: saveFn,
  toRequest,
}: PersistedDraftOptions<T, TRequest>): PersistedDraftReturn<T, TRequest> {
  const coordinator = useOptionalSaveCoordinator();
  const id = useId();

  const toDraftRequest = useCallback(
    (value: T | null): TRequest | null => {
      if (value === null) return null;
      if (toRequest) return toRequest(value);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- identity conversion when TRequest defaults to T
      return value as unknown as TRequest;
    },
    [toRequest],
  );

  const [persisted, setPersisted] = useState<T | null>(initialValue);
  const [draft, setDraftState] = useState<TRequest | null>(() => toDraftRequest(initialValue));
  const [prevInitial, setPrevInitial] = useState<T | null>(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const draftRevisionRef = useRef(0);
  const saveRevisionRef = useRef<number | null>(null);

  // Keep references to latest callbacks and handlers outside render
  const saveFnRef = useRef(saveFn);
  const onSaveSuccessRef = useRef(onSaveSuccess);
  const onSaveErrorRef = useRef(onSaveError);

  useEffect(() => {
    saveFnRef.current = saveFn;
    onSaveSuccessRef.current = onSaveSuccess;
    onSaveErrorRef.current = onSaveError;
  });

  // Compute dirty boolean directly from render values without reading mutable refs
  const dirty = useMemo(() => {
    if (draft === null && persisted === null) return false;
    if (draft === null || persisted === null) return true;
    const persistedRequest = toDraftRequest(persisted);
    if (persistedRequest === null) return true;
    const normDraft = normalize(draft);
    const normPersisted = normalize(persistedRequest);
    return !equals(normDraft, normPersisted);
  }, [draft, equals, normalize, persisted, toDraftRequest]);

  // Adjust state during render when initialValue prop / query response updates
  if (initialValue !== prevInitial) {
    setPrevInitial(initialValue);
    setPersisted(initialValue);
    if (persisted === null || !dirty) {
      setDraftState(toDraftRequest(initialValue));
    }
  }

  const setDraft = useCallback((updater: TRequest | ((prev: TRequest) => TRequest)): void => {
    setDraftState((current) => {
      if (current === null) return null;
      const next = isFunctionUpdater(updater) ? updater(current) : updater;
      draftRevisionRef.current += 1;
      return next;
    });
    setError(null);
  }, []);

  const updateField = useCallback(
    <K extends keyof TRequest>(key: K, value: TRequest[K]): void => {
      setDraft((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [setDraft],
  );

  const replaceDraft = useCallback(
    (value: TRequest): void => {
      setDraft(value);
    },
    [setDraft],
  );

  const discard = useCallback((): void => {
    if (persisted !== null) {
      setDraftState(toDraftRequest(persisted));
      draftRevisionRef.current += 1;
    }
    setError(null);
  }, [persisted, toDraftRequest]);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (draft === null) return false;
    const saveRevision = draftRevisionRef.current;
    saveRevisionRef.current = saveRevision;
    const draftSnapshot = draft;

    setSaving(true);
    setError(null);

    try {
      const saved = await saveFnRef.current(draftSnapshot);
      setPersisted(saved);
      setLastSavedAt(Date.now());

      // If no new edits occurred while the save request was in flight,
      // update draft to the returned server data to ensure full sync.
      if (draftRevisionRef.current === saveRevision) {
        setDraftState(toDraftRequest(saved));
      }
      // If newer edits were made during save (draftRevisionRef.current > saveRevision),
      // we leave the local draft state intact and dirty remains true!

      onSaveSuccessRef.current?.(saved);
      return true;
    } catch (caught: unknown) {
      const errorMessage =
        caught instanceof Error
          ? caught.message
          : typeof caught === "string"
            ? caught
            : "Failed to save draft.";
      setError(errorMessage);
      onSaveErrorRef.current?.(caught);
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, toDraftRequest]);

  // Auto-registration with SaveCoordinator
  const registerFn = coordinator?.register;
  const saveRef = useRef(save);
  const discardRef = useRef(discard);

  useEffect(() => {
    saveRef.current = save;
    discardRef.current = discard;
  });

  useEffect(() => {
    if (!autoRegister || !registerFn) return;
    const registration: SaveRegistration = {
      busy: saving,
      dirty,
      discard: () => {
        discardRef.current();
      },
      id,
      resourceKey,
      save: () => saveRef.current(),
    };
    return registerFn(registration);
  }, [autoRegister, dirty, id, registerFn, resourceKey, saving]);

  return {
    clearError,
    dirty,
    discard,
    draft,
    error,
    lastSavedAt,
    persisted,
    replaceDraft,
    save,
    saving,
    setDraft,
    updateField,
  };
}
