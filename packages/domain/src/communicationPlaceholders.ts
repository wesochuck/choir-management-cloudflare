export type CommunicationAudienceTarget = "Members" | "Contacts" | "Ticket Buyers" | "Donors";
export type CommunicationChannel = "Both" | "Email" | "SMS";

export type CommunicationPlaceholderContext =
  "standard" | "poll" | "ticket" | "bundle" | "attendance" | "audition";

export type CommunicationPlaceholderCategory =
  | "Recipient"
  | "Organization"
  | "Event"
  | "Poll"
  | "RSVP"
  | "Ticket"
  | "Order"
  | "Bundle"
  | "Attendance"
  | "Audition";

export interface CommunicationPlaceholderDefinition {
  readonly audience?: readonly CommunicationAudienceTarget[];
  readonly category: CommunicationPlaceholderCategory;
  readonly channels?: readonly CommunicationChannel[];
  readonly contexts: readonly CommunicationPlaceholderContext[];
  readonly description: string;
  readonly label: string;
  readonly requiresEvent?: boolean;
  readonly tag: string;
}

export interface CommunicationAudienceLike {
  readonly eventId?: string | null;
  readonly targetAudiences: readonly string[];
}

export function isCommunicationAudienceTarget(
  target: string,
): target is CommunicationAudienceTarget {
  return (
    target === "Members" ||
    target === "Contacts" ||
    target === "Ticket Buyers" ||
    target === "Donors"
  );
}

export interface CommunicationContextIssue {
  readonly code:
    "incompatible_audience" | "incompatible_channel" | "event_required" | "incompatible_context";
  readonly message: string;
  readonly placeholder: string;
}

export interface CommunicationTemplateLike {
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly isSystem?: boolean;
  readonly subject: string;
  readonly title: string;
}

const pollPlaceholderPattern = /\{\{POLL_LINK:[0-9a-f-]{36}\}\}/i;
const pollPlaceholderGlobalPattern = /\{\{POLL_LINK:[0-9a-f-]{36}\}\}/gi;

export const communicationPlaceholderDefinitions: readonly CommunicationPlaceholderDefinition[] = [
  {
    category: "Recipient",
    contexts: ["standard", "poll", "ticket", "bundle", "attendance", "audition"],
    description: "The name of the person receiving this message.",
    label: "Recipient name",
    tag: "{singerName}",
  },
  {
    category: "Organization",
    contexts: ["standard"],
    description:
      "Renders the organization logo in email messages, falling back to styled organization name.",
    label: "Organization logo",
    tag: "{organizationLogo}",
  },
  {
    category: "Organization",
    contexts: ["standard"],
    description: "The organization name.",
    label: "Organization name",
    tag: "{organizationName}",
  },
  {
    audience: ["Members", "Ticket Buyers", "Contacts"],
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
    audience: ["Members", "Ticket Buyers", "Contacts"],
    category: "Event",
    contexts: ["standard", "attendance", "ticket"],
    description: "The selected event's date and time.",
    label: "Event date",
    requiresEvent: true,
    tag: "{eventDate}",
  },
  {
    audience: ["Members", "Contacts"],
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
    audience: ["Members", "Contacts"],
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
    category: "Bundle",
    channels: ["Email"],
    contexts: ["bundle"],
    description:
      "A chronological list of included concerts with each title, date and time, venue, and address or event-location fallback.",
    label: "Included concerts",
    tag: "{{TICKET_EVENT_LIST}}",
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

function containsAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(value));
}

export function determineCommunicationPlaceholderContext(
  text: string,
): CommunicationPlaceholderContext {
  const normalized = text.toLowerCase();

  if (pollPlaceholderPattern.test(text) || normalized.includes("poll:")) return "poll";
  if (
    containsAny(normalized, [
      "{ticketbundlename}",
      "{{ticket_event_list}}",
      "bundle ticket confirmation",
      "bundle ticket",
    ])
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

function pollPlaceholder(contentMarkdown: string): CommunicationPlaceholderDefinition | null {
  const match = pollPlaceholderPattern.exec(contentMarkdown);
  if (!match) return null;
  return {
    audience: ["Members"],
    category: "Poll",
    channels: ["Email"],
    contexts: ["poll"],
    description: "A private, one-time response link for this poll and each member.",
    label: "Poll response link",
    tag: match[0],
  };
}

export function isPlaceholderCompatibleWithAudience(
  placeholder: CommunicationPlaceholderDefinition,
  targetAudiences: readonly string[],
): boolean {
  const allowed = placeholder.audience;
  if (!allowed || targetAudiences.length === 0) return true;
  return targetAudiences.every((target) =>
    isCommunicationAudienceTarget(target) ? allowed.includes(target) : false,
  );
}

export function isPlaceholderCompatibleWithChannel(
  placeholder: CommunicationPlaceholderDefinition,
  channel: CommunicationChannel,
): boolean {
  if (!placeholder.channels) return true;
  if (channel === "Both") {
    return placeholder.channels.includes("Email") && placeholder.channels.includes("SMS");
  }
  return placeholder.channels.includes(channel);
}

export function findCommunicationPlaceholderDefinition(
  tag: string,
): CommunicationPlaceholderDefinition | null {
  if (pollPlaceholderPattern.test(tag)) {
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
  return (
    communicationPlaceholderDefinitions.find((p) => p.tag.toLowerCase() === tag.toLowerCase()) ??
    null
  );
}

export function extractCommunicationPlaceholders(text: string): readonly string[] {
  const found = new Set<string>();
  for (const placeholder of communicationPlaceholderDefinitions) {
    if (text.includes(placeholder.tag)) {
      found.add(placeholder.tag);
    }
  }
  const pollMatches = text.match(pollPlaceholderGlobalPattern);
  if (pollMatches) {
    for (const match of pollMatches) {
      found.add(match);
    }
  }
  return Array.from(found);
}

export function visibleCommunicationPlaceholders(
  audience: CommunicationAudienceLike,
  channel: CommunicationChannel,
  context: CommunicationPlaceholderContext = "standard",
  contentMarkdown = "",
): readonly CommunicationPlaceholderDefinition[] {
  const placeholders = [
    ...communicationPlaceholderDefinitions.filter((placeholder) =>
      placeholder.contexts.includes(context),
    ),
    ...(context === "poll" ? [pollPlaceholder(contentMarkdown)] : []),
  ].filter((placeholder): placeholder is CommunicationPlaceholderDefinition =>
    Boolean(placeholder),
  );

  return placeholders.filter((placeholder) => {
    const audienceMatches = isPlaceholderCompatibleWithAudience(
      placeholder,
      audience.targetAudiences,
    );
    const channelMatches = isPlaceholderCompatibleWithChannel(placeholder, channel);
    const orderContext = context === "ticket" || context === "bundle";
    const eventMatches = !placeholder.requiresEvent || orderContext || Boolean(audience.eventId);
    return audienceMatches && channelMatches && eventMatches;
  });
}

export function hasEventDependentCommunicationPlaceholders(
  audience: CommunicationAudienceLike,
  channel: CommunicationChannel,
  context: CommunicationPlaceholderContext,
): boolean {
  if (context === "ticket" || context === "bundle") return false;
  return communicationPlaceholderDefinitions.some(
    (placeholder) =>
      placeholder.requiresEvent &&
      placeholder.contexts.includes(context) &&
      isPlaceholderCompatibleWithAudience(placeholder, audience.targetAudiences) &&
      isPlaceholderCompatibleWithChannel(placeholder, channel),
  );
}

export function validateCommunicationContext(request: {
  readonly audience: CommunicationAudienceLike;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly subject: string;
}): readonly CommunicationContextIssue[] {
  const { audience, channel, contentMarkdown, subject } = request;
  const fullText = `${subject}\n${contentMarkdown}`;
  const usedTags = extractCommunicationPlaceholders(fullText);
  const context = determineCommunicationPlaceholderContext(fullText);
  const issues: CommunicationContextIssue[] = [];

  for (const tag of usedTags) {
    const def = findCommunicationPlaceholderDefinition(tag);
    if (!def) continue;

    const isOrderContext = context === "ticket" || context === "bundle";

    // 1. Check audience compatibility (every selected audience must be supported)
    if (!isPlaceholderCompatibleWithAudience(def, audience.targetAudiences)) {
      const supported = def.audience?.join(" or ") ?? "all audiences";
      const incompatibleSelected = audience.targetAudiences.filter((target) => {
        if (!isCommunicationAudienceTarget(target)) return true;
        return !def.audience?.includes(target);
      });
      issues.push({
        code: "incompatible_audience",
        message: `${def.label} can only be used when all selected recipients are ${supported}. ${incompatibleSelected.join(" and ")} ${incompatibleSelected.length === 1 ? "is" : "are"} currently included.`,
        placeholder: tag,
      });
      continue;
    }

    // 2. Check channel compatibility
    if (!isPlaceholderCompatibleWithChannel(def, channel)) {
      issues.push({
        code: "incompatible_channel",
        message: `${def.label} is only available for ${def.channels?.join(" or ") ?? "specific"} delivery.`,
        placeholder: tag,
      });
      continue;
    }

    // 3. Check event requirement
    if (def.requiresEvent && !isOrderContext && !audience.eventId) {
      issues.push({
        code: "event_required",
        message: `${def.label} requires an event to be selected.`,
        placeholder: tag,
      });
      continue;
    }

    // 4. Check context requirement
    if (!def.contexts.includes(context)) {
      issues.push({
        code: "incompatible_context",
        message: `${def.label} cannot be used in this message context.`,
        placeholder: tag,
      });
    }
  }

  return issues;
}

export function templateMatchesCommunicationContext(
  template: CommunicationTemplateLike,
  audience: CommunicationAudienceLike,
  channel: CommunicationChannel,
): boolean {
  if (template.channel !== channel && template.channel !== "Both" && channel !== "Both") {
    return false;
  }
  const text = `${template.title}\n${template.subject}\n${template.contentMarkdown}`;
  const context = determineCommunicationPlaceholderContext(text);
  const visible = visibleCommunicationPlaceholders(
    audience,
    channel,
    context,
    template.contentMarkdown,
  );
  const usedTags = extractCommunicationPlaceholders(text);
  return usedTags.every((tag) => visible.some((placeholder) => placeholder.tag === tag));
}

export function removeCommunicationPlaceholder(text: string, tag: string): string {
  return text
    .split(tag)
    .join("")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
