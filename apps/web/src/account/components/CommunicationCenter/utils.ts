import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationReach,
  CommunicationScheduledMessage,
  OrganizationEvent,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { AuthApiError } from "../../../auth/api";
import type {
  CommunicationAudienceTarget,
  CommunicationSection,
  MessageFilter,
  MessageWorkspaceMode,
  UnifiedCommunicationItem,
} from "./types";

export const defaultAudience: CommunicationAudienceRequest = {
  contactEmailStatus: null,
  contactIds: [],
  contactListIds: [],
  contactSmsStatus: null,
  contactSource: null,
  eventId: null,
  globalStatuses: ["Active"],
  profileIds: [],
  rsvp: "All",
  targetAudiences: ["Members"],
  voiceParts: [],
};

export const audienceOptions: readonly CommunicationAudienceTarget[] = [
  "Members",
  "Contacts",
  "Ticket Buyers",
  "Donors",
];

export function failureMessage(error: unknown): string {
  return error instanceof AuthApiError
    ? error.message
    : "Organization communications are temporarily unavailable.";
}

export function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function eventLabel(event: OrganizationEvent): string {
  return `${event.title} · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(event.startsAt))}`;
}

export function channelFromValue(value: string): CommunicationChannel {
  if (value === "SMS" || value === "Both") return value;
  return "Email";
}

export interface InitialNavigationState {
  readonly draftId: string | null;
  readonly messageFilter: MessageFilter;
  readonly messageMode: MessageWorkspaceMode;
  readonly section: CommunicationSection;
}

export function parseCommunicationSearch(search: string): InitialNavigationState {
  const params = new URLSearchParams(search);
  const draftId = params.get("draftId");
  const tab = params.get("tab");

  if (draftId) {
    return {
      draftId,
      messageFilter: "all",
      messageMode: "compose",
      section: "messages",
    };
  }

  if (tab === "compose") {
    return {
      draftId: null,
      messageFilter: "all",
      messageMode: "compose",
      section: "messages",
    };
  }

  if (tab === "drafts") {
    return {
      draftId: null,
      messageFilter: "drafts",
      messageMode: "list",
      section: "messages",
    };
  }

  if (tab === "upcoming") {
    return {
      draftId: null,
      messageFilter: "scheduled",
      messageMode: "list",
      section: "messages",
    };
  }

  if (tab === "history") {
    return {
      draftId: null,
      messageFilter: "all",
      messageMode: "list",
      section: "messages",
    };
  }

  if (tab === "templates") {
    return {
      draftId: null,
      messageFilter: "all",
      messageMode: "list",
      section: "templates",
    };
  }

  if (tab === "settings") {
    return {
      draftId: null,
      messageFilter: "all",
      messageMode: "list",
      section: "settings",
    };
  }

  return {
    draftId: null,
    messageFilter: "all",
    messageMode: "list",
    section: "messages",
  };
}

export function recipientTypeSummary(audience: CommunicationAudienceRequest): string {
  if (audience.targetAudiences.length === 0) return "No recipient type selected";
  return audience.targetAudiences.join(" + ");
}

export function memberFiltersSummary(
  audience: CommunicationAudienceRequest,
  rosterConfiguration: OrganizationRosterConfiguration | null,
): string {
  const parts: string[] = [];

  // Global statuses
  if (audience.globalStatuses.length === 1 && audience.globalStatuses[0] === "Active") {
    parts.push("Active");
  } else if (audience.globalStatuses.length > 0) {
    parts.push(audience.globalStatuses.map((s) => (s === "Idle" ? "On Break" : s)).join(", "));
  }

  // Voice parts / sections
  if (audience.voiceParts.length > 0) {
    if (rosterConfiguration) {
      const sectionNames = audience.voiceParts.map((code) => {
        const sec = rosterConfiguration.sections.find((s) => s.code === code);
        return sec?.name ?? code;
      });
      parts.push(sectionNames.join(" + "));
    } else {
      parts.push(audience.voiceParts.join(" + "));
    }
  } else {
    parts.push("All sections");
  }

  // RSVP response
  if (audience.eventId && audience.rsvp !== "All") {
    parts.push(`RSVP: ${audience.rsvp}`);
  }

  return parts.join(" · ");
}

export function contactFiltersSummary(
  audience: CommunicationAudienceRequest,
  listNames: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  if (audience.contactListIds.length === 0 && audience.contactIds.length === 0) {
    parts.push("All eligible contacts");
  } else {
    if (audience.contactListIds.length > 0) {
      const names = audience.contactListIds.map((id) => listNames.get(id) ?? "Selected list");
      parts.push(names.join(" + "));
    }
    if (audience.contactIds.length > 0) {
      parts.push(
        `${String(audience.contactIds.length)} selected contact${audience.contactIds.length === 1 ? "" : "s"}`,
      );
    }
  }
  if (audience.contactSource) parts.push(`Source: ${audience.contactSource}`);
  if (audience.contactEmailStatus) parts.push(`Email: ${audience.contactEmailStatus}`);
  if (audience.contactSmsStatus) parts.push(`SMS: ${audience.contactSmsStatus}`);
  return parts.join(" · ");
}

export function reachSummaryText(reach: CommunicationReach, channel: CommunicationChannel): string {
  if (channel === "Email") {
    const reachableCount = reach.email;
    const reachable = `${String(reachableCount)} ${reachableCount === 1 ? "person can" : "people can"} receive this email`;
    const unreachable = reach.unreachable > 0 ? `${String(reach.unreachable)} cannot` : "0 cannot";
    return `${reachable} · ${unreachable}`;
  }

  if (channel === "SMS") {
    const reachableCount = reach.sms;
    const reachable = `${String(reachableCount)} ${reachableCount === 1 ? "person can" : "people can"} receive this text`;
    const unreachable = reach.unreachable > 0 ? `${String(reach.unreachable)} cannot` : "0 cannot";
    return `${reachable} · ${unreachable}`;
  }

  return `${String(reach.total)} reachable · ${String(reach.email)} have email · ${String(reach.sms)} have SMS · ${String(reach.unreachable)} unreachable`;
}

export function scheduledMessageKindLabel(kind: CommunicationScheduledMessage["kind"]): string {
  switch (kind) {
    case "attendance_report":
      return "Attendance Report";
    case "event_reminder":
      return "Event Reminder";
    case "rsvp_follow_up":
      return "RSVP Follow-up";
    case "ticket_confirmation":
      return "Ticket Confirmation";
    case "ticket_reminder":
      return "Ticket Reminder";
    case "ticket_refund":
      return "Ticket Refund Confirmation";
    case "audition_confirmation":
      return "Audition Confirmation";
    case "audition_reminder":
      return "Audition Reminder";
    default:
      return kind;
  }
}

export function unifiedItemSortTimestamp(item: UnifiedCommunicationItem): number {
  return new Date(item.timestamp).getTime() || 0;
}
