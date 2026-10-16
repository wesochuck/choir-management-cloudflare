import {
  savedSeatingTemplateSchema,
  seatingConfigurationRequestSchema,
  type SeatingFormation,
} from "@choir/contracts";
import { z } from "zod";

/** One explicit settings conversion, inside the caller's transaction; never scheduled work. */
export function convertRosterReferences(
  storage: DurableObjectStorage,
  conversion: ReadonlyMap<string, string>,
  occurredAt: string,
): void {
  const mappings = JSON.stringify(Object.fromEntries(conversion));
  for (const table of ["profiles", "auditions", "prepared_roster_invite_enrollments"]) {
    storage.sql.exec(
      `WITH mapping AS (SELECT key AS oldLabel, value AS newLabel FROM json_each(?))
       UPDATE ${table} SET voice_part = mapping.newLabel, updated_at = ?
       FROM mapping WHERE ${table}.voice_part = mapping.oldLabel`,
      mappings,
      occurredAt,
    );
  }
  // Preserve targeted groups after their subdivisions collapse. Sent/queued delivery snapshots stay intact.
  for (const [table, column, filter] of [
    ["events", "other_event_audience_json", "1 = 1"],
    ["communication_messages", "audience_json", "status = 'Draft'"],
  ] as const) {
    storage.sql.exec(
      `UPDATE ${table} SET ${column} = json_set(${column}, '$.voiceParts', json((
         SELECT json_group_array(DISTINCT COALESCE(mapping.value, part.value))
         FROM json_each(${table}.${column}, '$.voiceParts') part
         LEFT JOIN json_each(?) mapping ON mapping.key = part.value
       ))) WHERE ${filter} AND json_array_length(${column}, '$.voiceParts') > 0`,
      mappings,
    );
  }
  convertSeatingReferences(storage, conversion, occurredAt);
}

function convertSeatingReferences(
  storage: DurableObjectStorage,
  conversion: ReadonlyMap<string, string>,
  occurredAt: string,
): void {
  const stored = storage.sql
    .exec<{ readonly configuration: string; readonly templates: string }>(
      "SELECT seating_configuration_json AS configuration, seating_templates_json AS templates FROM organization_metadata LIMIT 1",
    )
    .one();
  const configuration = seatingConfigurationRequestSchema.parse(
    JSON.parse(stored.configuration) as unknown,
  );
  const templates = z
    .array(savedSeatingTemplateSchema)
    .parse(JSON.parse(stored.templates) as unknown);
  const convertFormation = (formation: SeatingFormation): SeatingFormation =>
    formation.isVoicePartLayout
      ? {
          ...formation,
          isVoicePartLayout: false,
          sectionOrder: [
            ...new Set(formation.sectionOrder.map((label) => conversion.get(label) ?? label)),
          ],
        }
      : formation;
  const mappings = JSON.stringify(Object.fromEntries(conversion));
  for (const formation of configuration.formations) {
    if (!formation.isVoicePartLayout) continue;
    storage.sql.exec(
      `UPDATE seating_charts SET section_suggestions_json = (
         SELECT json_group_object(seat.key, COALESCE(mapping.value, seat.value))
         FROM json_each(seating_charts.section_suggestions_json) seat
         LEFT JOIN json_each(?) mapping ON mapping.key = seat.value
       ), updated_at = ? WHERE formation_id = ?`,
      mappings,
      occurredAt,
      formation.id,
    );
  }
  storage.sql.exec(
    "UPDATE organization_metadata SET seating_configuration_json = ?, seating_templates_json = ?",
    JSON.stringify({
      ...configuration,
      formations: configuration.formations.map(convertFormation),
    }),
    JSON.stringify(
      templates.map((template) => ({
        ...template,
        formation: convertFormation(template.formation),
      })),
    ),
  );
}
