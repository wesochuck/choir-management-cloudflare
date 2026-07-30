import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationTemplate,
} from "@choir/contracts";

export type CommunicationAudience = CommunicationAudienceRequest["targetAudiences"][number];

export interface CommunicationPlaceholder {
  readonly audience?: readonly CommunicationAudience[];
  readonly channels?: readonly CommunicationChannel[];
  readonly description: string;
  readonly label: string;
  readonly requiresEvent?: boolean;
  readonly tag: string;
}

export const communicationPlaceholders: readonly CommunicationPlaceholder[] = [
  {
    description: "The name of the person receiving this message.",
    label: "Recipient name",
    tag: "{singerName}",
  },
  {
    audience: ["Members", "Ticket Buyers"],
    description: "The title of the selected event.",
    label: "Event title",
    requiresEvent: true,
    tag: "{eventTitle}",
  },
  {
    audience: ["Members", "Ticket Buyers"],
    description: "The event type, such as Performance or Rehearsal.",
    label: "Event type",
    requiresEvent: true,
    tag: "{eventType}",
  },
  {
    audience: ["Members", "Ticket Buyers"],
    description: "The selected event's date and time.",
    label: "Event date",
    requiresEvent: true,
    tag: "{eventDate}",
  },
  {
    audience: ["Members", "Ticket Buyers"],
    description: "The venue or location entered for the event.",
    label: "Event location",
    requiresEvent: true,
    tag: "{eventLocation}",
  },
  {
    audience: ["Members"],
    description: "The call time entered for the selected event.",
    label: "Call time",
    requiresEvent: true,
    tag: "{eventCallTime}",
  },
  {
    audience: ["Members", "Ticket Buyers"],
    description: "The event's administrative details.",
    label: "Event details",
    requiresEvent: true,
    tag: "{eventDetails}",
  },
  {
    audience: ["Members"],
    channels: ["Email"],
    description: "A personalized RSVP page link. Members can respond without signing in.",
    label: "RSVP link (no login)",
    requiresEvent: true,
    tag: "{{RSVP_LINKS}}",
  },
  {
    audience: ["Members"],
    description: "The approved set list for the selected event.",
    label: "Set list",
    requiresEvent: true,
    tag: "{setlist}",
  },
];

export function visibleCommunicationPlaceholders(
  audience: CommunicationAudienceRequest,
  channel: CommunicationChannel,
): readonly CommunicationPlaceholder[] {
  return communicationPlaceholders.filter((placeholder) => {
    const audienceMatches =
      !placeholder.audience ||
      placeholder.audience.some((target) => audience.targetAudiences.includes(target));
    const channelMatches = !placeholder.channels || placeholder.channels.includes(channel);
    const eventMatches = !placeholder.requiresEvent || Boolean(audience.eventId);
    return audienceMatches && channelMatches && eventMatches;
  });
}

export function templateMatchesCommunicationContext(
  template: CommunicationTemplate,
  audience: CommunicationAudienceRequest,
  channel: CommunicationChannel,
): boolean {
  if (template.channel !== channel && template.channel !== "Both" && channel !== "Both") {
    return false;
  }
  const text = `${template.subject}\n${template.contentMarkdown}`;
  return communicationPlaceholders.every((placeholder) => {
    if (!text.includes(placeholder.tag)) return true;
    return visibleCommunicationPlaceholders(audience, channel).some(
      ({ tag }) => tag === placeholder.tag,
    );
  });
}
