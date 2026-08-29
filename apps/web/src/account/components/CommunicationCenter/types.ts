import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationDeliverySummary,
  CommunicationMessage,
  CommunicationReach,
  CommunicationScheduledMessage,
  CommunicationTemplate,
  OrganizationEmailSettings,
  OrganizationEvent,
  OrganizationProviderStatusResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import type { CommunicationContextIssue } from "@choir/domain";

export type CommunicationAudienceTarget = CommunicationAudienceRequest["targetAudiences"][number];
export type CommunicationMessageStatus = CommunicationMessage["status"];
export type { CommunicationChannel };

export type CommunicationSection = "messages" | "templates" | "settings";

export type MessageWorkspaceMode = "list" | "compose";

export type MessageFilter =
  "all" | "drafts" | "scheduled" | "queued" | "sent" | "failed" | "automated";

export type UnifiedCommunicationItem =
  | {
      readonly automated: false;
      readonly channel: CommunicationChannel;
      readonly id: string;
      readonly kind: "manual";
      readonly message: CommunicationMessage;
      readonly recipientCount: number;
      readonly status: CommunicationMessageStatus;
      readonly timestamp: string;
      readonly title: string;
    }
  | {
      readonly automated: true;
      readonly channel: "Email";
      readonly id: string;
      readonly kind: "scheduled";
      readonly recipientCount: number | null;
      readonly scheduledMessage: CommunicationScheduledMessage;
      readonly status: "Failed" | "Queued" | "Scheduled" | "Sent";
      readonly timestamp: string;
      readonly title: string;
    };

export interface CommunicationReachState {
  readonly data: CommunicationReach | null;
  readonly error: string | null;
  readonly loading: boolean;
}

export interface CommunicationCenterControllerModel {
  readonly activeSection: CommunicationSection;
  readonly audience: CommunicationMessage["audience"];
  readonly audienceOptions: readonly CommunicationAudienceTarget[];
  readonly busy: boolean;
  readonly cancelQueuedMessage: (messageId: string) => Promise<void>;
  readonly channel: CommunicationChannel;
  readonly confirmationDialog: React.ReactNode;
  readonly contentMarkdown: string;
  readonly contextIssues: readonly CommunicationContextIssue[];
  readonly deleteDraft: (messageId: string) => Promise<void>;
  readonly deleteTemplate: (templateId: string) => Promise<void>;
  readonly deliveryDetailsMessage: CommunicationMessage | null;
  readonly deliverySummary: CommunicationDeliverySummary | null;
  readonly emailSettings: OrganizationEmailSettings | null;
  readonly error: string | null;
  readonly events: readonly OrganizationEvent[];
  readonly formatVoiceParts: (parts: readonly string[]) => string;
  readonly isReviewOpen: boolean;
  readonly isSaveTemplateOpen: boolean;
  readonly isTestEmailOpen: boolean;
  readonly loadingDeliveryId: string | null;
  readonly messageFilter: MessageFilter;
  readonly messageMode: MessageWorkspaceMode;
  readonly openDeliveryDetails: (message: CommunicationMessage) => Promise<void>;
  readonly openNewMessage: () => void;
  readonly openNewTemplateDialog: () => void;
  readonly openReviewAndSend: () => Promise<void>;
  readonly openSaveAsTemplate: () => void;
  readonly openTestEmail: () => void;
  readonly providerStatus: OrganizationProviderStatusResponse | null;
  readonly reachState: CommunicationReachState;
  readonly recipientsExpanded: boolean;
  readonly removeConflictingPlaceholder: (tag: string) => void;
  readonly resumeDraft: (draft: CommunicationMessage) => void;
  readonly retryDeliveries: (messageId: string) => Promise<void>;
  readonly rosterConfiguration: OrganizationRosterConfiguration | null;
  readonly saveDraft: () => Promise<void>;
  readonly saveTemplate: (templateName: string) => Promise<void>;
  readonly selectedEvent: OrganizationEvent | null;
  readonly sendCommunication: () => Promise<void>;
  readonly sendTestEmail: (email: string) => Promise<void>;
  readonly setActiveSection: (section: CommunicationSection) => void;
  readonly setChannel: (channel: CommunicationChannel) => void;
  readonly setContentMarkdown: (content: string) => void;
  readonly setIsReviewOpen: (open: boolean) => void;
  readonly setIsSaveTemplateOpen: (open: boolean) => void;
  readonly setIsTestEmailOpen: (open: boolean) => void;
  readonly setMessageFilter: (filter: MessageFilter) => void;
  readonly setMessageMode: (mode: MessageWorkspaceMode) => void;
  readonly setRecipientsExpanded: (expanded: boolean) => void;
  readonly setSubject: (subject: string) => void;
  readonly setVoiceParts: (voiceParts: string) => void;
  readonly subject: string;
  readonly successNotice: string | null;
  readonly templates: readonly CommunicationTemplate[];
  readonly unifiedMessages: readonly UnifiedCommunicationItem[];
  readonly updateAudience: (
    updater: (current: CommunicationMessage["audience"]) => CommunicationMessage["audience"],
  ) => void;
  readonly voiceParts: string;
}
