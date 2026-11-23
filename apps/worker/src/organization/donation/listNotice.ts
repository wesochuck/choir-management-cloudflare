import { z } from "zod";

import { identity } from "./queries";

interface DonorListNoticeRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventLocation: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly timezone: string;
}

function notFound(): Response {
  return Response.json({ code: "donor_list_job_not_found" }, { status: 404 });
}

export function readDonorListNoticeFromStore(
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
       WHERE job_id = ? AND kind = 'donor_list_reminder' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const prefix = `donor-list:${organizationId}:`;
  const key = scheduledJob?.idempotencyKey ?? "";
  const eventId = key.startsWith(prefix) ? key.slice(prefix.length, prefix.length + 36) : "";
  const expectedStartsAt = key.startsWith(`${prefix}${eventId}:`)
    ? key.slice(prefix.length + eventId.length + 1)
    : "";
  const parsedEventId = z.uuid().safeParse(eventId);
  const parsedStartsAt = z.iso.datetime().safeParse(expectedStartsAt);
  if (
    !scheduledJob ||
    !parsedEventId.success ||
    !parsedStartsAt.success ||
    key !== `${prefix}${parsedEventId.data}:${parsedStartsAt.data}`
  ) {
    return notFound();
  }

  const event = storage.sql
    .exec<DonorListNoticeRow>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.starts_at AS eventStartsAt,
         COALESCE(NULLIF(e.location, ''), v.name, '') AS eventLocation,
         o.timezone AS timezone
       FROM events e
       CROSS JOIN organization_metadata o
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? AND e.starts_at = ? AND e.type = 'Performance'
         AND e.is_archived = 0 AND e.is_canceled = 0
         AND EXISTS (SELECT 1 FROM donations LIMIT 1)
       LIMIT 1`,
      parsedEventId.data,
      parsedStartsAt.data,
    )
    .toArray()
    .at(0);
  return event ? Response.json(event) : notFound();
}
