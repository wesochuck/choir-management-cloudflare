import type {
  DuesRecord,
  OrganizationMembershipSummary,
  OrganizationProfile,
  OrganizationProfileDeliveriesResponse,
  OrganizationProfileFolderNumber,
  OrganizationProfilePerformanceHistoryResponse,
  OrganizationProfileRequest,
  OrganizationProfileStatusHistoryResponse,
  OrganizationRosterConfiguration,
  Season,
} from "@choir/contracts";

export type ProfileTab = "dues" | "email" | "folders" | "info" | "messages" | "performance";

export type ProfileStatusHistoryState =
  | { readonly status: "error" | "idle" | "loading" }
  | { readonly data: OrganizationProfileStatusHistoryResponse; readonly status: "ready" };

export type ProfileDeliveriesState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly data: OrganizationProfileDeliveriesResponse;
      readonly status: "ready";
    };

export type PerformanceHistoryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly data: OrganizationProfilePerformanceHistoryResponse;
      readonly status: "ready";
    };

export type ProfileDuesState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly dues: readonly DuesRecord[];
      readonly seasons: readonly Season[];
      readonly status: "ready";
    };

export type ProfileFolderNumbersState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly folderNumbers: readonly OrganizationProfileFolderNumber[];
      readonly status: "ready";
    };

export interface ProfileEditorDialogProps {
  readonly busy: boolean;
  readonly editingId: string | null;
  readonly editingProfileRecord?: OrganizationProfile | null | undefined;
  readonly error: string | null;
  readonly linkedMembership?: OrganizationMembershipSummary | null | undefined;
  readonly onClose: () => void;
  readonly onCloseAutoFocus?: ((event: Event) => void) | undefined;
  readonly onImpersonate?: (() => void) | undefined;
  readonly onPhotoChanged?: ((fileId: string | null) => void) | undefined;
  readonly onPhotoPendingChange?: ((pending: boolean) => void) | undefined;
  readonly onRegisterPhotoSave?: ((saveFn: (() => Promise<boolean>) | null) => void) | undefined;
  /** Notified when the Performance RSVPs tab changes an RSVP (issue #137). */
  readonly onRsvpChanged?: ((eventId: string) => void) | undefined;
  readonly onResolveDuplicate?: (() => void) | undefined;
  readonly open: boolean;
  readonly performanceHistory: PerformanceHistoryState;
  readonly profile: OrganizationProfileRequest;
  readonly profileDeliveries: ProfileDeliveriesState;
  readonly profileDues: ProfileDuesState;
  readonly profileEmail: string;
  readonly profileFolderNumbers: ProfileFolderNumbersState;
  readonly profilePhotoFileId: string | null;
  readonly profileStatusHistory: ProfileStatusHistoryState;
  readonly profileTab: ProfileTab;
  readonly resetFeedback?: string | null | undefined;
  readonly resettingProfileId?: string | null | undefined;
  readonly rosterConfiguration?: OrganizationRosterConfiguration | undefined;
  readonly rosterMemberships?: readonly OrganizationMembershipSummary[] | undefined;
  /**
   * Whether the roster control-plane data is ready. Gates admin actions such
   * as Impersonate so they never appear from an empty membership list while
   * loading. Callers should pass `roster.status === "ready"`.
   */
  readonly rosterReady?: boolean | undefined;
  /**
   * Contextual save label for shared-editor reuse. Roster uses the default
   * "Save Profile". When opened from RSVPs (issue #137), callers pass
   * "Save & Return to RSVPs" to preserve return-state behavior. Ignored in
   * Add mode, which always shows "Create Profile".
   */
  readonly saveLabel?: string | undefined;
  readonly saveProfile: () => Promise<void>;
  readonly sendPasswordReset?: (() => Promise<void>) | undefined;
  readonly setPerformanceHistory: React.Dispatch<React.SetStateAction<PerformanceHistoryState>>;
  readonly setProfile: React.Dispatch<React.SetStateAction<OrganizationProfileRequest>>;
  readonly setProfileDeliveries: React.Dispatch<React.SetStateAction<ProfileDeliveriesState>>;
  readonly setProfileDues: React.Dispatch<React.SetStateAction<ProfileDuesState>>;
  readonly setProfileEmail: (email: string) => void;
  readonly setProfileFolderNumbers: React.Dispatch<React.SetStateAction<ProfileFolderNumbersState>>;
  readonly setProfilePhotoFileId?: ((fileId: string | null) => void) | undefined;
  readonly setProfileTab: (tab: ProfileTab) => void;
}
