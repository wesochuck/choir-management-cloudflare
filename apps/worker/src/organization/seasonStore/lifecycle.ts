import type { seasonCreateRequestSchema } from "@choir/contracts";
import type { z } from "zod";

import { seasonSelect } from "./contracts";
import type {
  SeasonRow,
  seasonActivateOperationSchema,
  seasonCreateOperationSchema,
  seasonDeleteOperationSchema,
  seasonUpdateOperationSchema,
} from "./contracts";
import { seasonById, seasonResult } from "./shared";

export function validateSeasonInput(
  storage: DurableObjectStorage,
  season: z.infer<typeof seasonCreateRequestSchema>,
  excludedSeasonId?: string,
): Response | null {
  if (new Date(season.endsAt).getTime() < new Date(season.startsAt).getTime()) {
    return Response.json(
      { code: "season_dates_invalid", message: "End date cannot be before start date." },
      { status: 400 },
    );
  }
  const overlap = storage.sql
    .exec<SeasonRow>(`${seasonSelect} ORDER BY s.starts_at ASC, s.id ASC`)
    .toArray()
    .find(
      (candidate) =>
        candidate.id !== excludedSeasonId &&
        season.startsAt <= candidate.endsAt &&
        season.endsAt >= candidate.startsAt,
    );
  return overlap
    ? Response.json(
        {
          code: "season_overlap",
          message: `The selected dates overlap with ${overlap.name}.`,
        },
        { status: 409 },
      )
    : null;
}

export function createSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonCreateOperationSchema>,
): Response {
  const validation = validateSeasonInput(storage, operation.season);
  if (validation) return validation;
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO seasons
        (id, name, starts_at, ends_at, dues_amount_cents, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      operation.seasonId,
      operation.season.name,
      operation.season.startsAt,
      operation.season.endsAt,
      operation.season.duesAmountCents,
      occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'season.created', 'season', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.actorUserId,
      operation.seasonId,
      operation.requestId,
      JSON.stringify(operation.season),
      occurredAt,
    );
  });
  const created = seasonById(storage, operation.seasonId);
  return created
    ? Response.json(seasonResult(created), { status: 201 })
    : Response.json({ code: "season_not_found" }, { status: 404 });
}

export function updateSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonUpdateOperationSchema>,
): Response {
  if (!seasonById(storage, operation.seasonId)) {
    return Response.json({ code: "season_not_found" }, { status: 404 });
  }
  const validation = validateSeasonInput(storage, operation.season, operation.seasonId);
  if (validation) return validation;
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE seasons
       SET name = ?, starts_at = ?, ends_at = ?, dues_amount_cents = ?, updated_at = ?
       WHERE id = ?`,
      operation.season.name,
      operation.season.startsAt,
      operation.season.endsAt,
      operation.season.duesAmountCents,
      occurredAt,
      operation.seasonId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'season.updated', 'season', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.actorUserId,
      operation.seasonId,
      operation.requestId,
      JSON.stringify(operation.season),
      occurredAt,
    );
  });
  const updated = seasonById(storage, operation.seasonId);
  return updated
    ? Response.json(seasonResult(updated))
    : Response.json({ code: "season_not_found" }, { status: 404 });
}

export function activateSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonActivateOperationSchema>,
): Response {
  if (!seasonById(storage, operation.seasonId)) {
    return Response.json({ code: "season_not_found" }, { status: 404 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec("UPDATE seasons SET is_active = 0, updated_at = ?", occurredAt);
    storage.sql.exec(
      "UPDATE seasons SET is_active = 1, updated_at = ? WHERE id = ?",
      occurredAt,
      operation.seasonId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'season.activated', 'season', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.actorUserId,
      operation.seasonId,
      operation.requestId,
      JSON.stringify({ seasonId: operation.seasonId }),
      occurredAt,
    );
  });
  const activated = seasonById(storage, operation.seasonId);
  return activated
    ? Response.json(seasonResult(activated))
    : Response.json({ code: "season_not_found" }, { status: 404 });
}

export function deleteSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonDeleteOperationSchema>,
): Response {
  if (!seasonById(storage, operation.seasonId)) {
    return Response.json({ code: "season_not_found" }, { status: 404 });
  }
  try {
    storage.transactionSync(() => {
      storage.sql.exec("DELETE FROM seasons WHERE id = ?", operation.seasonId);
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'season.deleted', 'season', ?, ?, ?, ?)`,
        crypto.randomUUID(),
        operation.actorUserId,
        operation.seasonId,
        operation.requestId,
        JSON.stringify({ seasonId: operation.seasonId }),
        new Date().toISOString(),
      );
    });
  } catch {
    return Response.json(
      {
        code: "season_has_dues",
        message: "This season has dues records and cannot be deleted.",
      },
      { status: 409 },
    );
  }
  return Response.json({ deleted: true, seasonId: operation.seasonId });
}
