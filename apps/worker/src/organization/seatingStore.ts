import {
  organizationRosterConfigurationRequestSchema,
  organizationSeatingChartRequestSchema,
  organizationSeatingChartSchema,
  seatingConfigurationRequestSchema,
  type OrganizationRosterConfiguration,
  type OrganizationSeatingChart,
  type SeatingConfiguration,
} from "@choir/contracts";
import { defaultRosterConfiguration, defaultSeatingConfiguration } from "@choir/domain";
import { z } from "zod";

const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const seatingMutationSchema = z.discriminatedUnion("action", [
  actorSchema.extend({
    action: z.literal("create_chart"),
    chart: organizationSeatingChartRequestSchema.extend({ id: z.uuid() }),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("update_chart"),
    chart: organizationSeatingChartRequestSchema.extend({ id: z.uuid() }),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("delete_chart"),
    chartId: z.uuid(),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("reorder_charts"),
    chartIds: z.array(z.uuid()).min(1).max(100),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("update_configuration"),
    configuration: seatingConfigurationRequestSchema,
  }),
]);

type SeatingMutation = z.infer<typeof seatingMutationSchema>;
type ChartWrite = Extract<SeatingMutation, { readonly chart: unknown }>;

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface SeatingChartRow {
  readonly [column: string]: SqlStorageValue;
  readonly assignmentsJson: string;
  readonly createdAt: string;
  readonly eventId: string;
  readonly formationId: string;
  readonly id: string;
  readonly name: string;
  readonly rowCountsJson: string;
  readonly sectionSuggestionsJson: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
  readonly venueId: string | null;
}

function identityMatches(storage: DurableObjectStorage, organizationId: string | null): boolean {
  if (!organizationId) return false;
  const identity = storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return identity?.organizationId === organizationId;
}

function parseStored<T>(raw: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function rosterConfiguration(storage: DurableObjectStorage): OrganizationRosterConfiguration {
  const fallback = organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  const raw = storage.sql
    .exec<{ readonly configuration: string }>(
      "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
    )
    .one().configuration;
  return parseStored(raw, organizationRosterConfigurationRequestSchema, fallback);
}

function seatingConfiguration(storage: DurableObjectStorage): SeatingConfiguration {
  const fallback = seatingConfigurationRequestSchema.parse(defaultSeatingConfiguration);
  const raw = storage.sql
    .exec<{ readonly configuration: string }>(
      "SELECT seating_configuration_json AS configuration FROM organization_metadata LIMIT 1",
    )
    .one().configuration;
  return parseStored(raw, seatingConfigurationRequestSchema, fallback);
}

function chartFromRow(row: SeatingChartRow): OrganizationSeatingChart {
  return organizationSeatingChartSchema.parse({
    assignments: parseStored(row.assignmentsJson, z.record(z.string(), z.uuid()), {}),
    createdAt: row.createdAt,
    eventId: row.eventId,
    formationId: row.formationId,
    id: row.id,
    name: row.name,
    rowCounts: parseStored(row.rowCountsJson, z.array(z.number()), []),
    sectionSuggestions: parseStored(
      row.sectionSuggestionsJson,
      z.record(z.string(), z.string()),
      {},
    ),
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt,
    venueId: row.venueId,
  });
}

const chartSelect = `SELECT id, event_id AS eventId, venue_id AS venueId, name,
  formation_id AS formationId, row_counts_json AS rowCountsJson,
  section_suggestions_json AS sectionSuggestionsJson, assignments_json AS assignmentsJson,
  sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
  FROM seating_charts`;

function eventAcceptsSeating(storage: DurableObjectStorage, eventId: string): boolean {
  return (
    storage.sql
      .exec(
        `SELECT 1 FROM events
         WHERE id = ? AND type = 'Performance' AND is_archived = 0 LIMIT 1`,
        eventId,
      )
      .toArray().length === 1
  );
}

function chartReferencesAreValid(storage: DurableObjectStorage, operation: ChartWrite): boolean {
  if (!eventAcceptsSeating(storage, operation.eventId)) return false;
  if (
    operation.chart.venueId &&
    storage.sql.exec("SELECT 1 FROM venues WHERE id = ? LIMIT 1", operation.chart.venueId).toArray()
      .length !== 1
  ) {
    return false;
  }
  const configuration = seatingConfiguration(storage);
  const formation = configuration.formations.find(({ id }) => id === operation.chart.formationId);
  if (!formation) return false;
  if (
    Object.values(operation.chart.sectionSuggestions).some(
      (suggestion) => !formation.sectionOrder.includes(suggestion),
    )
  ) {
    return false;
  }
  const assignedIds = Object.values(operation.chart.assignments);
  if (assignedIds.length === 0) return true;
  const placeholders = assignedIds.map(() => "?").join(",");
  const eligible = storage.sql
    .exec<{ readonly id: string }>(
      `SELECT p.id FROM profiles p
       JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
       WHERE p.id IN (${placeholders}) AND p.global_status = 'Active'
         AND p.voice_part <> '' AND r.rsvp = 'Yes'`,
      operation.eventId,
      ...assignedIds,
    )
    .toArray();
  return eligible.length === assignedIds.length;
}

function configurationReferencesAreValid(
  storage: DurableObjectStorage,
  configuration: SeatingConfiguration,
): boolean {
  const roster = rosterConfiguration(storage);
  const sectionCodes = new Set(
    roster.sections.filter(({ trackOnly }) => !trackOnly).map(({ code }) => code),
  );
  const voicePartLabels = new Set(
    roster.voiceParts
      .filter(({ sectionCode }) => sectionCodes.has(sectionCode))
      .map(({ label }) => label),
  );
  return configuration.formations.every((formation) => {
    const allowed = formation.isVoicePartLayout ? voicePartLabels : sectionCodes;
    return formation.sectionOrder.every((value) => allowed.has(value));
  });
}

function insertAudit(
  storage: DurableObjectStorage,
  operation: { readonly actorUserId: string; readonly requestId: string },
  action: string,
  targetType: string,
  targetId: string,
  summary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, ?, ?, ?, ?, ?)`,
    `${action}:${operation.requestId}`,
    operation.actorUserId,
    action,
    targetType,
    targetId,
    operation.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

export function readSeatingConfigurationFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({ configuration: seatingConfiguration(storage) });
}

export function listSeatingChartsFromStore(
  storage: DurableObjectStorage,
  input: { readonly eventId: string | null; readonly organizationId: string | null },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  if (!eventAcceptsSeating(storage, eventId.data)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const charts = storage.sql
    .exec<SeatingChartRow>(
      `${chartSelect} WHERE event_id = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC`,
      eventId.data,
    )
    .toArray()
    .map(chartFromRow);
  return Response.json({ charts });
}

export function readSingerSeatingFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly chartId: string | null;
    readonly eventId: string | null;
    readonly organizationId: string | null;
    readonly profileId: string | null;
  },
): Response {
  const chartId = input.chartId ? z.uuid().safeParse(input.chartId) : null;
  const eventId = z.uuid().safeParse(input.eventId);
  const profileId = z.uuid().safeParse(input.profileId);
  if (
    !identityMatches(storage, input.organizationId) ||
    (chartId !== null && !chartId.success) ||
    !eventId.success ||
    !profileId.success
  ) {
    return Response.json({ code: "seating_not_found" }, { status: 404 });
  }
  const rostered = storage.sql
    .exec(
      "SELECT 1 FROM event_rosters WHERE event_id = ? AND profile_id = ? LIMIT 1",
      eventId.data,
      profileId.data,
    )
    .toArray().length;
  if (rostered === 0) return Response.json({ code: "forbidden" }, { status: 403 });
  const rows = chartId?.success
    ? storage.sql
        .exec<SeatingChartRow>(
          `${chartSelect} WHERE id = ? AND event_id = ? LIMIT 1`,
          chartId.data,
          eventId.data,
        )
        .toArray()
    : storage.sql
        .exec<SeatingChartRow>(
          `${chartSelect} WHERE event_id = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC`,
          eventId.data,
        )
        .toArray();
  if (chartId && rows.length === 0) {
    return Response.json({ code: "seating_not_found" }, { status: 404 });
  }
  const charts = rows.map(chartFromRow);
  const profileIds = [...new Set(charts.flatMap(({ assignments }) => Object.values(assignments)))];
  const profiles =
    profileIds.length === 0
      ? []
      : storage.sql
          .exec<{
            readonly displayName: string;
            readonly id: string;
            readonly voicePart: string;
          }>(
            `SELECT id, display_name AS displayName, voice_part AS voicePart
             FROM profiles WHERE id IN (${profileIds.map(() => "?").join(",")})`,
            ...profileIds,
          )
          .toArray();
  return Response.json({ charts, profiles, selfProfileId: profileId.data });
}

function writeChart(
  storage: DurableObjectStorage,
  operation: ChartWrite,
  occurredAt: string,
): Response {
  if (!chartReferencesAreValid(storage, operation)) {
    return Response.json({ code: "invalid_seating_reference" }, { status: 409 });
  }
  const existing = storage.sql
    .exec<SeatingChartRow>(`${chartSelect} WHERE id = ? LIMIT 1`, operation.chart.id)
    .toArray()
    .at(0);
  if (operation.action === "create_chart" && existing) {
    return Response.json({ code: "chart_exists" }, { status: 409 });
  }
  if (operation.action === "update_chart" && existing?.eventId !== operation.eventId) {
    return Response.json({ code: "chart_not_found" }, { status: 404 });
  }
  const createdAt = existing?.createdAt ?? occurredAt;
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO seating_charts
        (id, event_id, venue_id, name, formation_id, row_counts_json,
         section_suggestions_json, assignments_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET venue_id = excluded.venue_id, name = excluded.name,
         formation_id = excluded.formation_id, row_counts_json = excluded.row_counts_json,
         section_suggestions_json = excluded.section_suggestions_json,
         assignments_json = excluded.assignments_json, sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
      operation.chart.id,
      operation.eventId,
      operation.chart.venueId,
      operation.chart.name,
      operation.chart.formationId,
      JSON.stringify(operation.chart.rowCounts),
      JSON.stringify(operation.chart.sectionSuggestions),
      JSON.stringify(operation.chart.assignments),
      operation.chart.sortOrder,
      createdAt,
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      operation.action === "create_chart" ? "seating.chart.created" : "seating.chart.updated",
      "seating_chart",
      operation.chart.id,
      {
        assignmentCount: Object.keys(operation.chart.assignments).length,
        eventId: operation.eventId,
      },
      occurredAt,
    );
  });
  return Response.json({
    ...operation.chart,
    createdAt,
    eventId: operation.eventId,
    updatedAt: occurredAt,
  });
}

function deleteChart(
  storage: DurableObjectStorage,
  operation: Extract<SeatingMutation, { readonly action: "delete_chart" }>,
  occurredAt: string,
): Response {
  const existing = storage.sql
    .exec<SeatingChartRow>(
      `${chartSelect} WHERE id = ? AND event_id = ? LIMIT 1`,
      operation.chartId,
      operation.eventId,
    )
    .toArray()
    .at(0);
  if (!existing) return Response.json({ code: "chart_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM seating_charts WHERE id = ?", operation.chartId);
    insertAudit(
      storage,
      operation,
      "seating.chart.deleted",
      "seating_chart",
      operation.chartId,
      { eventId: operation.eventId },
      occurredAt,
    );
  });
  return Response.json({ chartId: operation.chartId, status: "deleted" });
}

function reorderCharts(
  storage: DurableObjectStorage,
  operation: Extract<SeatingMutation, { readonly action: "reorder_charts" }>,
  occurredAt: string,
): Response {
  if (!eventAcceptsSeating(storage, operation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const requestedIds = new Set(operation.chartIds);
  if (requestedIds.size !== operation.chartIds.length) {
    return Response.json({ code: "invalid_chart_order" }, { status: 400 });
  }
  const existing = storage.sql
    .exec<{ readonly id: string }>(
      "SELECT id FROM seating_charts WHERE event_id = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC",
      operation.eventId,
    )
    .toArray()
    .map(({ id }) => id);
  if (
    existing.length !== operation.chartIds.length ||
    existing.some((id) => !requestedIds.has(id))
  ) {
    return Response.json({ code: "invalid_chart_order" }, { status: 409 });
  }
  storage.transactionSync(() => {
    operation.chartIds.forEach((chartId, index) => {
      storage.sql.exec(
        "UPDATE seating_charts SET sort_order = ?, updated_at = ? WHERE id = ? AND event_id = ?",
        index,
        occurredAt,
        chartId,
        operation.eventId,
      );
    });
    insertAudit(
      storage,
      operation,
      "seating.charts.reordered",
      "performance",
      operation.eventId,
      { chartIds: operation.chartIds },
      occurredAt,
    );
  });
  const charts = storage.sql
    .exec<SeatingChartRow>(
      `${chartSelect} WHERE event_id = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC`,
      operation.eventId,
    )
    .toArray()
    .map(chartFromRow);
  return Response.json({ charts });
}

function updateConfiguration(
  storage: DurableObjectStorage,
  operation: Extract<SeatingMutation, { readonly action: "update_configuration" }>,
  occurredAt: string,
): Response {
  if (!configurationReferencesAreValid(storage, operation.configuration)) {
    return Response.json({ code: "invalid_formation_reference" }, { status: 409 });
  }
  const ids = new Set(operation.configuration.formations.map(({ id }) => id));
  const inUse = storage.sql
    .exec<{ readonly formationId: string }>(
      "SELECT DISTINCT formation_id AS formationId FROM seating_charts",
    )
    .toArray()
    .some(({ formationId }) => !ids.has(formationId));
  if (inUse) return Response.json({ code: "formation_in_use" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET seating_configuration_json = ?, updated_at = ?",
      JSON.stringify(operation.configuration),
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      "seating.configuration.updated",
      "organization",
      operation.organizationId,
      { formationCount: operation.configuration.formations.length },
      occurredAt,
    );
  });
  return Response.json({ configuration: operation.configuration });
}

export async function manageSeatingInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = seatingMutationSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "invalid_seating_operation" }, { status: 400 });
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  if (parsed.data.action === "create_chart" || parsed.data.action === "update_chart") {
    return writeChart(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "delete_chart") {
    return deleteChart(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "reorder_charts") {
    return reorderCharts(storage, parsed.data, occurredAt);
  }
  return updateConfiguration(storage, parsed.data, occurredAt);
}
