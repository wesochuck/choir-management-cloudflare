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

export function parseMessage(row: MessageRow) {
  return communicationMessageSchema.parse({
    ...row,
    audience: JSON.parse(row.audienceJson) as unknown,
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
      readonly setListJson: string;
    }>(
      `SELECT e.title AS eventTitle, e.type AS eventType, e.starts_at AS eventDate,
        e.call_time AS callTime, e.details, COALESCE(v.name, e.location) AS eventLocation,
        e.set_list_json AS setListJson
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? AND e.is_archived = 0 ${canceledFilter} LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
  if (!event) return null;
  return {
    eventId,
    eventCallTime: event.callTime,
    eventDate: new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(event.eventDate)),
    eventDetails: event.details,
    eventLocation: event.eventLocation,
    eventTitle: event.eventTitle,
    eventType: event.eventType,
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
