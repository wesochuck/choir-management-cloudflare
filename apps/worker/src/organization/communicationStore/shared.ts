import {
  communicationMessageSchema,
  organizationRosterConfigurationRequestSchema,
} from "@choir/contracts";

import {
  messageColumns,
  type CommunicationAudienceStorage,
  type ConfigurationRow,
  type IdentityRow,
  type MessageRow,
} from "./contracts";
import {
  filterUpcomingPerformances,
  ticketSalesPath,
  type UpcomingPerformanceListItem,
} from "@choir/domain";

export function identityMatches(
  storage: CommunicationAudienceStorage,
  organizationId: string,
): boolean {
  return (
    storage.sql
      .exec<IdentityRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId === organizationId
  );
}

export function eventPromotionIsEligible(
  storage: DurableObjectStorage,
  eventId: string,
  now: string,
): boolean {
  return (
    storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM events
         WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0
           AND publish_on_website = 1 AND is_ticketing_enabled = 1 AND starts_at > ?
         LIMIT 1`,
        eventId,
        now,
      )
      .toArray().length === 1
  );
}

export function parseMessage(row: MessageRow) {
  return communicationMessageSchema.parse({
    ...row,
    audience: JSON.parse(row.audienceJson) as unknown,
    eventPromotion: row.eventPromotionJson ? (JSON.parse(row.eventPromotionJson) as unknown) : null,
    reach: JSON.parse(row.reachJson) as unknown,
    status: row.canceledAt ? "Canceled" : row.status,
  });
}

export function readMessage(storage: DurableObjectStorage, messageId: string) {
  const row = storage.sql
    .exec<MessageRow>(
      `SELECT ${messageColumns} FROM communication_messages WHERE id = ? LIMIT 1`,
      messageId,
    )
    .toArray()
    .at(0);
  return row ? parseMessage(row) : null;
}

function setListTitles(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return "";
    return parsed
      .map((item: unknown) => {
        if (typeof item !== "object" || item === null) return "";
        const title = (item as { readonly title?: unknown }).title;
        return typeof title === "string" ? title.trim() : "";
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

export function queryUpcomingPerformancesForCommunication(
  storage: DurableObjectStorage,
  includeUnpublished: boolean,
  nowMs = Date.now(),
): {
  readonly performances: readonly UpcomingPerformanceListItem[];
  readonly timezone: string;
} {
  const timezone = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  const searchFloorIso = new Date(nowMs - 60_000).toISOString();
  const visibilityFilter = includeUnpublished
    ? ""
    : "AND (e.publish_on_website = 1 OR e.is_ticketing_enabled = 1)";
  const rows = storage.sql
    .exec<{
      readonly id: string;
      readonly isTicketingEnabled: number;
      readonly location: string;
      readonly publishOnWebsite: number;
      readonly startsAt: string;
      readonly ticketSlug: string | null;
      readonly title: string;
      readonly venueAddress: string;
      readonly venueName: string;
    }>(
      `SELECT e.id, e.title, e.starts_at AS startsAt, e.location,
         e.publish_on_website AS publishOnWebsite,
         e.is_ticketing_enabled AS isTicketingEnabled,
         COALESCE(v.name, '') AS venueName,
         COALESCE(v.address, '') AS venueAddress,
         (SELECT slug FROM ticket_url_names WHERE kind = 'performance' AND resource_id = e.id) AS ticketSlug
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.is_archived = 0
         AND e.is_canceled = 0
         AND e.starts_at >= ?
         AND e.type = 'Performance'
         ${visibilityFilter}
       ORDER BY e.starts_at ASC, e.title ASC, e.id ASC
       LIMIT 200`,
      searchFloorIso,
    )
    .toArray();

  const performances = filterUpcomingPerformances(
    rows.map((row): UpcomingPerformanceListItem => ({
      id: row.id,
      isArchived: false,
      isCanceled: false,
      isTicketingEnabled: row.isTicketingEnabled === 1,
      location: row.location,
      publishOnWebsite: row.publishOnWebsite === 1,
      startsAt: row.startsAt,
      ticketSlug: row.ticketSlug,
      title: row.title,
      type: "Performance",
      venueAddress: row.venueAddress,
      venueName: row.venueName,
    })),
    { includeUnpublished, nowMs },
  );

  return { performances, timezone };
}

export function eventCommunicationContext(
  storage: DurableObjectStorage,
  eventId: string | null,
  includeCanceled = false,
) {
  if (!eventId) return null;
  const canceledFilter = includeCanceled ? "" : "AND e.is_canceled = 0";
  const event = storage.sql
    .exec<{
      readonly callTime: string;
      readonly details: string;
      readonly eventDate: string;
      readonly eventLocation: string;
      readonly eventTitle: string;
      readonly eventType: string;
      readonly ticketSlug: string | null;
      readonly setListJson: string;
    }>(
      `SELECT e.title AS eventTitle, e.type AS eventType, e.starts_at AS eventDate,
        e.call_time AS callTime, e.details, COALESCE(v.name, e.location) AS eventLocation,
        e.set_list_json AS setListJson,
        (SELECT slug FROM ticket_url_names WHERE kind = 'performance' AND resource_id = e.id) AS ticketSlug
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? AND e.is_archived = 0 ${canceledFilter} LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
  if (!event) return null;
  const timezone = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  return {
    eventId,
    eventCallTime: event.callTime,
    eventDate: new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(event.eventDate)),
    eventDetails: event.details,
    eventLocation: event.eventLocation,
    eventTitle: event.eventTitle,
    eventType: event.eventType,
    eventTicketPath: ticketSalesPath({ id: eventId, ticketSlug: event.ticketSlug }),
    setlist: setListTitles(event.setListJson),
  };
}

export function audit(
  storage: DurableObjectStorage,
  actorUserId: string,
  requestId: string,
  action: string,
  targetId: string,
  summary: unknown,
  occurredAt: string,
  targetType = "communication_message",
  actorType: "organization_member" | "organization_system" = "organization_member",
): void {
  storage.sql.exec(
    `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
      request_id, change_summary, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `communication:${action}:${requestId}`,
    actorType,
    actorUserId,
    action,
    targetType,
    targetId,
    requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

export function allowedVoiceParts(
  storage: CommunicationAudienceStorage,
  requested: readonly string[],
): Set<string> | null {
  if (requested.length === 0) return null;
  const row = storage.sql
    .exec<ConfigurationRow>(
      "SELECT roster_configuration_json AS rosterConfigurationJson FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  const configuration = organizationRosterConfigurationRequestSchema.parse(
    JSON.parse(row?.rosterConfigurationJson ?? "null") as unknown,
  );
  const sections = new Map(configuration.sections.map((section) => [section.code, section]));
  const result = new Set<string>();
  for (const token of requested) {
    if (sections.has(token)) {
      for (const part of configuration.voiceParts) {
        if (part.sectionCode === token) result.add(part.label);
      }
    } else {
      result.add(token);
    }
  }
  return result;
}

export function trackOnlyVoiceParts(storage: CommunicationAudienceStorage): Set<string> {
  const row = storage.sql
    .exec<ConfigurationRow>(
      "SELECT roster_configuration_json AS rosterConfigurationJson FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  const configuration = organizationRosterConfigurationRequestSchema.parse(
    JSON.parse(row?.rosterConfigurationJson ?? "null") as unknown,
  );
  const trackOnlySections = new Set(
    configuration.sections.filter(({ trackOnly }) => trackOnly).map(({ code }) => code),
  );
  return new Set(
    configuration.voiceParts
      .filter(({ sectionCode }) => trackOnlySections.has(sectionCode))
      .map(({ label }) => label),
  );
}
