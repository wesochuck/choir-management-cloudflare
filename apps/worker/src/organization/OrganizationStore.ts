import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import type { Env } from "../env";
import { migrateOrganization } from "./migrations";
import { runOrganizationAlarm, wakeOrganizationAlarm } from "./scheduler";
import { dispatchPostRequest } from "./organizationStore/post";
import { dispatchGetRequest } from "./organizationStore/read";

const eventReminderResultSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  status: z.enum(["failed", "sent", "terminal"]),
});

function isAlarmWakePath(pathname: string): boolean {
  return (
    pathname === "/internal/audition/create" ||
    pathname === "/internal/audition/update" ||
    pathname === "/internal/donations/manage" ||
    pathname === "/internal/export/create" ||
    pathname === "/internal/seasons/manage"
  );
}

function clearUnsuccessfulEventReminderMarkers(storage: DurableObjectStorage): void {
  storage.sql.exec(
    `UPDATE events
     SET reminder_sent_at = NULL
     WHERE reminder_sent_at IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM scheduled_job_outbox o
         LEFT JOIN job_ledger l ON l.job_id = o.job_id
         WHERE o.kind = 'event_reminder'
           AND o.idempotency_key =
             'event-reminder:' ||
             (SELECT organization_id FROM organization_metadata LIMIT 1) || ':' || events.id
           AND COALESCE(l.status, '') != 'completed'
       )`,
  );
}

function recordEventReminderResult(storage: DurableObjectStorage, input: unknown): Response {
  const parsed = eventReminderResultSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ code: "invalid_event_reminder_result" }, { status: 400 });
  }
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const job = storage.sql
    .exec<{ readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey
       FROM scheduled_job_outbox WHERE job_id = ? AND kind = 'event_reminder' LIMIT 1`,
      parsed.data.jobId,
    )
    .toArray()
    .at(0);
  const prefix = `event-reminder:${parsed.data.organizationId}:`;
  if (!job?.idempotencyKey.startsWith(prefix)) {
    return Response.json({ code: "event_reminder_not_found" }, { status: 404 });
  }
  const eventId = job.idempotencyKey.slice(prefix.length).split(":retry:", 1)[0];
  const event = storage.sql
    .exec<{ readonly id: string }>("SELECT id FROM events WHERE id = ? LIMIT 1", eventId)
    .toArray()
    .at(0);
  if (!event) return Response.json({ code: "event_reminder_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE events SET reminder_sent_at = ? WHERE id = ?",
      parsed.data.status === "sent" ? now : null,
      eventId,
    );
    if (parsed.data.status === "terminal") {
      storage.sql.exec(
        `INSERT INTO job_ledger
          (idempotency_key, job_id, kind, status, attempt, claimed_at, failed_at)
         VALUES (?, ?, 'event_reminder', 'failed', ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           status = 'failed', attempt = MAX(job_ledger.attempt, excluded.attempt),
           completed_at = NULL, failed_at = excluded.failed_at`,
        parsed.data.idempotencyKey,
        parsed.data.jobId,
        parsed.data.attempt,
        now,
        now,
      );
    }
  });
  return Response.json({ recorded: true });
}

export class OrganizationStore extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    migrateOrganization(state.storage.sql);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST") {
      if (url.pathname === "/internal/scheduling/event-reminder-result") {
        return recordEventReminderResult(this.ctx.storage, await request.json().catch(() => null));
      }
      const response = await dispatchPostRequest(
        this.ctx.storage,
        this.env.JOBS_QUEUE,
        url.pathname,
        request,
      );
      if (response) {
        if (response.ok && isAlarmWakePath(url.pathname)) {
          await wakeOrganizationAlarm(this.ctx.storage);
        }
        return response;
      }
    }
    if (request.method === "GET") {
      const response = dispatchGetRequest(this.ctx.storage, url);
      if (response) return response;
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  }

  override async alarm(): Promise<void> {
    try {
      await runOrganizationAlarm(this.ctx.storage, this.env.JOBS_QUEUE);
    } finally {
      clearUnsuccessfulEventReminderMarkers(this.ctx.storage);
    }
  }
}
