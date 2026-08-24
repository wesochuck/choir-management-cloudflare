import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationTemplate,
} from "@choir/contracts";

type CommunicationAudience = CommunicationAudienceRequest["targetAudiences"][number];

export type CommunicationPlaceholderContext =
  "standard" | "poll" | "ticket" | "bundle" | "attendance" | "audition";

type CommunicationPlaceholderCategory =
  | "Recipient"
  | "Event"
  | "Poll"
  | "RSVP"
  | "Ticket"
  | "Order"
  | "Bundle"
  | "Attendance"
  | "Audition";

export interface CommunicationPlaceholder {
  readonly audience?: readonly CommunicationAudience[];
  readonly category: CommunicationPlaceholderCategory;
  readonly channels?: readonly CommunicationChannel[];
  readonly contexts: readonly CommunicationPlaceholderContext[];
  readonly description: string;
  readonly label: string;
  readonly requiresEvent?: boolean;
  readonly tag: string;
}

const pollPlaceholderPattern = /\{\{POLL_LINK:[0-9a-f-]{36}\}\}/i;

const communicationPlaceholders: readonly CommunicationPlaceholder[] = [
  {
    category: "Recipient",
    contexts: ["standard", "poll", "ticket", "bundle", "attendance", "audition"],
    description: "The name of the person receiving this message.",
    label: "Recipient name",
    tag: "{singerName}",
  },
  {
    audience: ["Members", "Ticket Buyers"],
    category: "Event",
    contexts: ["standard", "attendance", "ticket"],
    description: "The title of the selected event.",
    label: "Event title",
    requiresEvent: true,
    tag: "{eventTitle}",
  },
  {
    audience: ["Members"],
    category: "Event",
    contexts: ["standard", "attendance"],
    description: "The event type, such as Performance or Rehearsal.",
    label: "Event type",
    requiresEvent: true,
    tag: "{eventType}",
  },
  {
    audience: ["Members", "Ticket Buyers"],
    category: "Event",
    contexts: ["standard", "attendance", "ticket"],
    description: "The selected event's date and time.",
    label: "Event date",
    requiresEvent: true,
    tag: "{eventDate}",
  },
  {
    audience: ["Members"],
    category: "Event",
    contexts: ["standard", "attendance"],
    description: "The venue or location entered for the event.",
    label: "Event location",
    requiresEvent: true,
    tag: "{eventLocation}",
  },
  {
    audience: ["Members"],
    category: "Event",
    contexts: ["standard"],
    description: "The call time entered for the selected event.",
    label: "Call time",
    requiresEvent: true,
    tag: "{eventCallTime}",
  },
  {
    audience: ["Members"],
    category: "Event",
    contexts: ["standard", "attendance"],
    description: "The event's administrative details.",
    label: "Event details",
    requiresEvent: true,
    tag: "{eventDetails}",
  },
  {
    audience: ["Members"],
    category: "Event",
    contexts: ["standard"],
    description: "The approved set list for the selected event.",
    label: "Set list",
    requiresEvent: true,
    tag: "{setlist}",
  },
  {
    audience: ["Ticket Buyers"],
    category: "Order",
    channels: ["Email"],
    contexts: ["ticket", "bundle"],
    description: "The number of tickets or bundle passes in the order.",
    label: "Ticket quantity",
    tag: "{ticketQuantity}",
  },
  {
    audience: ["Ticket Buyers"],
    category: "Order",
    channels: ["Email"],
    contexts: ["ticket", "bundle"],
    description: "The total amount paid for the ticket order.",
    label: "Ticket total",
    tag: "{ticketAmount}",
  },
  {
    audience: ["Ticket Buyers"],
    category: "Bundle",
    channels: ["Email"],
    contexts: ["bundle"],
    description: "The bundle name, when the order is for a ticket bundle.",
    label: "Ticket bundle name",
    tag: "{ticketBundleName}",
  },
  {
    audience: ["Ticket Buyers"],
    category: "Ticket",
    channels: ["Email"],
    contexts: ["ticket", "bundle"],
    description: "A no-login link to the buyer's ticket order and credential.",
    label: "Ticket order link (no login)",
    tag: "{{TICKET_LINK}}",
  },
  {
    audience: ["Members"],
    category: "RSVP",
    channels: ["Email"],
    contexts: ["standard"],
    description: "A personalized RSVP page link. Members can respond without signing in.",
    label: "RSVP link (no login)",
    requiresEvent: true,
    tag: "{{RSVP_LINKS}}",
  },
  {
    audience: ["Members"],
    category: "Event",
    channels: ["Email"],
    contexts: ["standard"],
    description:
      "A personalized practice player link for the selected event. Members can listen without signing in.",
    label: "Practice player link (no login)",
    requiresEvent: true,
    tag: "{{PLAYER_LINK}}",
  },
  {
    audience: ["Members"],
    category: "Attendance",
    channels: ["Email"],
    contexts: ["attendance"],
    description: "The percentage of rostered people marked Present in an attendance report.",
    label: "Attendance rate",
    requiresEvent: true,
    tag: "{attendanceRate}",
  },
  {
    audience: ["Members"],
    category: "Attendance",
    channels: ["Email"],
    contexts: ["attendance"],
    description: "The number of people marked Present.",
    label: "Present count",
    requiresEvent: true,
    tag: "{presentCount}",
  },
  {
    audience: ["Members"],
    category: "Attendance",
    channels: ["Email"],
    contexts: ["attendance"],
    description: "The total number of rostered people in the report.",
    label: "Total count",
    requiresEvent: true,
    tag: "{totalCount}",
  },
  {
    audience: ["Members"],
    category: "Attendance",
    channels: ["Email"],
    contexts: ["attendance"],
    description: "A Markdown list of Profiles not marked Present.",
    label: "Absentee list",
    requiresEvent: true,
    tag: "{absenteesList}",
  },
  {
    audience: ["Members"],
    category: "Attendance",
    channels: ["Email"],
    contexts: ["attendance"],
    description: "A section naming Profiles at or above the linked-Rehearsal warning threshold.",
    label: "Warning section",
    requiresEvent: true,
    tag: "{thresholdWarningsSection}",
  },
  {
    category: "Audition",
    channels: ["Email"],
    contexts: ["audition"],
    description: "The scheduled audition date.",
    label: "Audition date",
    tag: "{auditionDate}",
  },
  {
    category: "Audition",
    channels: ["Email"],
    contexts: ["audition"],
    description: "The scheduled audition time.",
    label: "Audition time",
    tag: "{auditionTime}",
  },
  {
    category: "Audition",
    channels: ["Email"],
    contexts: ["audition"],
    description: "The scheduled audition date and time together.",
    label: "Audition date and time",
    tag: "{auditionDateTime}",
  },
  {
    category: "Audition",
    channels: ["Email"],
    contexts: ["audition"],
    description: "The audition venue and address.",
    label: "Audition location",
    tag: "{auditionLocation}",
  },
  {
    category: "Audition",
    channels: ["Email"],
    contexts: ["audition"],
    description: "A no-login link for the applicant to review or update their audition.",
    label: "Audition link (no login)",
    tag: "{{AUDITION_LINK}}",
  },
];

function matchesAudience(
  placeholder: CommunicationPlaceholder,
  audience: CommunicationAudienceRequest,
): boolean {
  return (
    !placeholder.audience ||
    placeholder.audience.some((target) => audience.targetAudiences.includes(target))
  );
}

function matchesChannel(
  placeholder: CommunicationPlaceholder,
  channel: CommunicationChannel,
): boolean {
  return !placeholder.channels || placeholder.channels.includes(channel);
}

function containsAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(value));
}

export function communicationPlaceholderContext(text: string): CommunicationPlaceholderContext {
  const normalized = text.toLowerCase();

  if (pollPlaceholderPattern.exec(text) || normalized.includes("poll:")) return "poll";
  if (
    containsAny(normalized, ["{ticketbundlename}", "bundle ticket confirmation", "bundle ticket"])
  ) {
    return "bundle";
  }
  if (
    containsAny(normalized, [
      "{ticketquantity}",
      "{ticketamount}",
      "{{ticket_link}}",
      "ticket confirmation",
      "ticket reminder",
    ])
  ) {
    return "ticket";
  }
  if (
    containsAny(normalized, [
      "{attendancerate}",
      "{presentcount}",
      "{totalcount}",
      "{absenteeslist}",
      "{thresholdwarningssection}",
      "attendance report",
    ])
  ) {
    return "attendance";
  }
  if (
    containsAny(normalized, [
      "{auditiondate}",
      "{auditiontime}",
      "{auditiondatetime}",
      "{auditionlocation}",
      "{{audition_link}}",
      "audition",
    ])
  ) {
    return "audition";
  }
  return "standard";
}

function pollPlaceholder(contentMarkdown: string): CommunicationPlaceholder | null {
  const tag = pollPlaceholderPattern.exec(contentMarkdown)?.[0];
  if (!tag) return null;
  return {
    audience: ["Members"],
    category: "Poll",
    channels: ["Email"],
    contexts: ["poll"],
    description: "A private, one-time response link for this poll and each member.",
    label: "Poll response link",
    tag,
  };
}

export function visibleCommunicationPlaceholders(
  audience: CommunicationAudienceRequest,
  channel: CommunicationChannel,
  context: CommunicationPlaceholderContext = "standard",
  contentMarkdown = "",
): readonly CommunicationPlaceholder[] {
  const placeholders = [
    ...communicationPlaceholders.filter((placeholder) => placeholder.contexts.includes(context)),
    ...(context === "poll" ? [pollPlaceholder(contentMarkdown)] : []),
  ].filter((placeholder): placeholder is CommunicationPlaceholder => Boolean(placeholder));

  return placeholders.filter((placeholder) => {
    const audienceMatches = matchesAudience(placeholder, audience);
    const channelMatches = matchesChannel(placeholder, channel);
    const orderContext = context === "ticket" || context === "bundle";
    const eventMatches = !placeholder.requiresEvent || orderContext || Boolean(audience.eventId);
    return audienceMatches && channelMatches && eventMatches;
  });
}

export function hasEventDependentCommunicationPlaceholders(
  audience: CommunicationAudienceRequest,
  channel: CommunicationChannel,
  context: CommunicationPlaceholderContext,
): boolean {
  if (context === "ticket" || context === "bundle") return false;
  return communicationPlaceholders.some(
    (placeholder) =>
      placeholder.requiresEvent &&
      placeholder.contexts.includes(context) &&
      matchesAudience(placeholder, audience) &&
      matchesChannel(placeholder, channel),
  );
}

function communicationPlaceholderTags(text: string): readonly string[] {
  const tags = communicationPlaceholders
    .filter((placeholder) => text.includes(placeholder.tag))
    .map((placeholder) => placeholder.tag);
  const pollTag = pollPlaceholderPattern.exec(text)?.[0];
  return [...new Set(pollTag ? [...tags, pollTag] : tags)];
}

export function templateMatchesCommunicationContext(
  template: CommunicationTemplate,
  audience: CommunicationAudienceRequest,
  channel: CommunicationChannel,
): boolean {
  if (template.channel !== channel && template.channel !== "Both" && channel !== "Both") {
    return false;
  }
  const text = `${template.title}\n${template.subject}\n${template.contentMarkdown}`;
  const context = communicationPlaceholderContext(text);
  const visible = visibleCommunicationPlaceholders(
    audience,
    channel,
    context,
    template.contentMarkdown,
  );
  return communicationPlaceholderTags(text).every((tag) =>
    visible.some((placeholder) => placeholder.tag === tag),
  );
}
