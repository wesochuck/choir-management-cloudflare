export interface PersistedDraftOptions<T, TRequest = T> {
  readonly autoRegister?: boolean;
  readonly equals?: (a: TRequest, b: TRequest) => boolean;
  readonly initialValue: T | null;
  readonly normalize?: (value: TRequest) => TRequest;
  readonly onSaveError?: (error: unknown) => void;
  readonly onSaveSuccess?: (saved: T) => void;
  readonly resourceKey: string;
  readonly save: (draft: TRequest) => Promise<T>;
  readonly toRequest?: (value: T) => TRequest;
}

export interface PersistedDraftReturn<T, TRequest = T> {
  readonly clearError: () => void;
  readonly dirty: boolean;
  readonly discard: () => void;
  readonly draft: TRequest | null;
  readonly error: string | null;
  readonly lastSavedAt: number | null;
  readonly persisted: T | null;
  readonly replaceDraft: (value: TRequest) => void;
  readonly save: () => Promise<boolean>;
  readonly saving: boolean;
  readonly setDraft: (updater: TRequest | ((prev: TRequest) => TRequest)) => void;
  readonly updateField: <K extends keyof TRequest>(key: K, value: TRequest[K]) => void;
}

export interface SaveRegistration {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly discard: () => void;
  readonly id: string;
  readonly resourceKey: string;
  readonly save: () => Promise<boolean>;
}

export interface LeaveOptions {
  readonly action?: () => void | Promise<void>;
  readonly description?: string;
  readonly reason: "navigate" | "popstate" | "workspace-switch" | "sign-out" | "tab-close";
  readonly title?: string;
}

export interface SaveCoordinatorContextValue {
  readonly dirtyCount: number;
  readonly discardAll: () => void;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly register: (registration: SaveRegistration) => () => void;
  readonly requestLeave: (options: LeaveOptions) => Promise<boolean>;
  readonly saveAll: () => Promise<{
    readonly errors: readonly string[];
    readonly success: boolean;
  }>;
}
