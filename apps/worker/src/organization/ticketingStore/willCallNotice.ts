import { z } from "zod";

import { identity } from "./readModel";

interface TicketWillCallNoticeEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventLocation: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly timezone: string;
}

function notFound(): Response {
  return Response.json({ code: "ticket_will_call_job_not_found" }, { status: 404 });
}

export function readTicketWillCallNoticeFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  const parsedJobId = z.uuid().safeParse(jobId);
  if (
    !organizationId ||
    identity(storage)?.organizationId !== organizationId ||
    !parsedJobId.success
  ) {
    return notFound();
  }

  const scheduledJob = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'ticket_will_call' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const prefix = `ticket-will-call:${organizationId}:`;
  const suffix = scheduledJob?.idempotencyKey.startsWith(prefix)
    ? scheduledJob.idempotencyKey.slice(prefix.length)
    : "";
  const separator = suffix.indexOf(":");
  if (separator < 0) return notFound();
  const eventId = suffix.slice(0, separator);
  const expectedStartsAt = suffix.slice(separator + 1);
  const parsedEventId = z.uuid().safeParse(eventId);
  const parsedStartsAt = z.iso.datetime().safeParse(expectedStartsAt);
  if (
    !scheduledJob ||
    !parsedEventId.success ||
    !parsedStartsAt.success ||
    scheduledJob.idempotencyKey !== `${prefix}${parsedEventId.data}:${parsedStartsAt.data}`
  ) {
    return notFound();
  }

  const event = storage.sql
    .exec<TicketWillCallNoticeEventRow>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.starts_at AS eventStartsAt,
         COALESCE(NULLIF(e.location, ''), v.name, '') AS eventLocation,
         o.timezone AS timezone
       FROM events e
       CROSS JOIN organization_metadata o
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? AND e.starts_at = ? AND e.type = 'Performance'
         AND e.is_archived = 0 AND e.is_canceled = 0
         AND e.is_ticketing_enabled = 1
         AND (
           EXISTS (
             SELECT 1 FROM ticket_purchases p
             WHERE p.event_id = e.id AND p.bundle_id IS NULL AND p.status = 'paid'
           )
           OR EXISTS (
             SELECT 1 FROM ticket_bundle_allocations a
             JOIN ticket_purchases p ON p.id = a.purchase_id
             WHERE a.event_id = e.id AND p.status = 'paid'
           )
         )
       LIMIT 1`,
      parsedEventId.data,
      parsedStartsAt.data,
    )
    .toArray()
    .at(0);
  return event ? Response.json(event) : notFound();
}
