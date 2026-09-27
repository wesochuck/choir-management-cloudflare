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
  MessageOriginFilter,
  MessageStatusFilter,
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
  ticketBuyerMode: "marketing",
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

export function getEmptyStateText(
  status: MessageStatusFilter,
  origin: MessageOriginFilter,
): string {
  if (status === "all") {
    if (origin === "manual") return "No manual messages found.";
    if (origin === "automated") return "No automated messages found.";
    return "No messages found.";
  }

  if (status === "draft") {
    if (origin === "automated") return "No automated drafts found.";
    if (origin === "manual") return "No manual drafts found.";
    return "No drafts found.";
  }

  const originAdjective = origin === "all" ? "" : origin === "manual" ? " manual" : " automated";

  switch (status) {
    case "scheduled":
      return `No scheduled${originAdjective} messages found.`;
    case "queued":
      return `No queued${originAdjective} messages found.`;
    case "sent":
      return `No sent${originAdjective} messages found.`;
    case "failed":
      return `No failed${originAdjective} messages found.`;
    default:
      return "No messages found matching the selected filter.";
  }
}

export interface InitialNavigationState {
  readonly draftId: string | null;
  readonly messageMode: MessageWorkspaceMode;
  readonly originFilter: MessageOriginFilter;
  readonly section: CommunicationSection;
  readonly statusFilter: MessageStatusFilter;
}

function parseSearchOrigin(
  rawType: string | null,
  rawStatus: string | null,
  tab: string | null,
): MessageOriginFilter {
  if (rawType === "manual") return "manual";
  if (rawType === "automated" || rawStatus === "automated" || tab === "automated") {
    return "automated";
  }
  return "all";
}

function parseSearchStatus(rawStatus: string | null, tab: string | null): MessageStatusFilter {
  if (rawStatus === "draft" || rawStatus === "drafts") return "draft";
  if (rawStatus === "scheduled" || rawStatus === "upcoming") return "scheduled";
  if (rawStatus === "queued") return "queued";
  if (rawStatus === "sent") return "sent";
  if (rawStatus === "failed") return "failed";
  if (!rawStatus) {
    if (tab === "drafts") return "draft";
    if (tab === "upcoming") return "scheduled";
  }
  return "all";
}

function parseNavigationMode(tab: string | null): {
  readonly messageMode: MessageWorkspaceMode;
  readonly section: CommunicationSection;
} {
  if (tab === "compose") return { messageMode: "compose", section: "messages" };
  if (tab === "templates") return { messageMode: "list", section: "templates" };
  if (tab === "settings") return { messageMode: "list", section: "settings" };
  return { messageMode: "list", section: "messages" };
}

export function parseCommunicationSearch(search: string): InitialNavigationState {
  const params = new URLSearchParams(search);
  const draftId = params.get("draftId");
  const tab = params.get("tab")?.toLowerCase() ?? null;
  const rawStatus = (params.get("status") ?? params.get("filter"))?.toLowerCase() ?? null;
  const rawType = (params.get("type") ?? params.get("origin"))?.toLowerCase() ?? null;

  if (draftId) {
    return {
      draftId,
      messageMode: "compose",
      originFilter: "all",
      section: "messages",
      statusFilter: "all",
    };
  }

  const { messageMode, section } = parseNavigationMode(tab);
  return {
    draftId: null,
    messageMode,
    originFilter: parseSearchOrigin(rawType, rawStatus, tab),
    section,
    statusFilter: parseSearchStatus(rawStatus, tab),
  };
}

export function recipientTypeSummary(audience: CommunicationAudienceRequest): string {
  if (audience.targetAudiences.length === 0) return "No recipient type selected";
  const targets = audience.targetAudiences.join(" + ");
  return audience.ticketBuyerMode === "ticket_service"
    ? `${targets} · Important notice for current ticket holders`
    : targets;
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

export function reachSummaryText(
  reach: CommunicationReach,
  channel: CommunicationChannel,
  ticketBuyerMode: CommunicationAudienceRequest["ticketBuyerMode"] = "marketing",
): string {
  if (ticketBuyerMode === "ticket_service" && channel === "Email") {
    const reachableCount = reach.email;
    const unreachable =
      reach.unreachable > 0
        ? `${String(reach.unreachable)} are suppressed or undeliverable`
        : "0 are suppressed or undeliverable";
    const undeliverablePurchases =
      reach.undeliverableTicketBuyerPurchases > 0
        ? ` · ${String(reach.undeliverableTicketBuyerPurchases)} paid ticket orders have no matching Contact or usable email`
        : "";
    const purchasesOverLimit =
      reach.ticketBuyerPurchasesOverLimit > 0
        ? ` · ${String(reach.ticketBuyerPurchasesOverLimit)} paid ticket orders exceed the 1,000-order message limit; sending is blocked`
        : "";
    return `${String(reachableCount)} ticket-holder recipients can receive this email · ${unreachable}${undeliverablePurchases}${purchasesOverLimit}`;
  }
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
