import { z } from "zod";

import { identity } from "./readModel";

interface TicketCloseoutEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventStartsAt: string;
  readonly eventLocation: string;
  readonly venueName: string;
  readonly timezone: string;
}

interface TicketCloseoutSingleEventTotals {
  readonly [column: string]: SqlStorageValue;
  readonly ticketAdmissions: number;
  readonly complimentaryAdmissions: number;
  readonly paymentCents: number;
  readonly refundCents: number;
}

interface TicketCloseoutBundleTotals {
  readonly [column: string]: SqlStorageValue;
  readonly passAdmissions: number;
  readonly paymentCents: number;
  readonly refundCents: number;
}

interface TicketCloseoutScanTotals {
  readonly [column: string]: SqlStorageValue;
  readonly ticketAdmissions: number;
  readonly complimentaryAdmissions: number;
  readonly passAdmissions: number;
}

function notFound(): Response {
  return Response.json({ code: "ticket_closeout_job_not_found" }, { status: 404 });
}

export function readTicketCloseoutJobFromStore(
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
       WHERE job_id = ? AND kind = 'ticket_closeout' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const eventId = scheduledJob?.idempotencyKey.split(":").at(-1);
  if (
    !eventId ||
    scheduledJob?.idempotencyKey !== `ticket-closeout:${organizationId}:${eventId}` ||
    !z.uuid().safeParse(eventId).success
  ) {
    return notFound();
  }

  const event = storage.sql
    .exec<TicketCloseoutEventRow>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.starts_at AS eventStartsAt,
         e.location AS eventLocation, COALESCE(v.name, '') AS venueName,
         o.timezone AS timezone
       FROM events e
       CROSS JOIN organization_metadata o
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? AND e.type = 'Performance'
         AND e.is_archived = 0 AND e.is_canceled = 0
       LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
  if (!event) return notFound();

  const singleEvent = storage.sql
    .exec<TicketCloseoutSingleEventTotals>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid'
                           AND amount_paid_cents > 0 THEN quantity ELSE 0 END), 0)
           AS ticketAdmissions,
         COALESCE(SUM(CASE WHEN status = 'paid' AND amount_paid_cents = 0
                           THEN quantity ELSE 0 END), 0) AS complimentaryAdmissions,
         COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded')
                           THEN amount_paid_cents ELSE 0 END), 0) AS paymentCents,
         COALESCE(SUM(CASE WHEN status = 'refunded'
                           THEN amount_paid_cents ELSE 0 END), 0) AS refundCents
       FROM ticket_purchases
       WHERE event_id = ? AND bundle_id IS NULL
         AND status IN ('paid', 'refunded')`,
      eventId,
    )
    .one();

  const bundles = storage.sql
    .exec<TicketCloseoutBundleTotals>(
      `SELECT
         COALESCE(SUM(CASE WHEN p.status = 'paid' THEN a.quantity ELSE 0 END), 0)
           AS passAdmissions,
         COALESCE(SUM(CASE WHEN p.event_id = ? AND p.status IN ('paid', 'refunded')
                           THEN p.amount_paid_cents ELSE 0 END), 0) AS paymentCents,
         COALESCE(SUM(CASE WHEN p.event_id = ? AND p.status = 'refunded'
                           THEN p.amount_paid_cents ELSE 0 END), 0) AS refundCents
       FROM ticket_bundle_allocations a
       JOIN ticket_purchases p ON p.id = a.purchase_id
       WHERE a.event_id = ? AND p.bundle_id IS NOT NULL
         AND p.status IN ('paid', 'refunded')`,
      eventId,
      eventId,
      eventId,
    )
    .one();

  const scanRecordCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM ticket_scan_events WHERE event_id = ?",
      eventId,
    )
    .one().count;
  const scans = storage.sql
    .exec<TicketCloseoutScanTotals>(
      `WITH valid_purchases AS (
         SELECT DISTINCT purchase_id AS purchaseId
         FROM ticket_scan_events
         WHERE event_id = ? AND result = 'valid'
       )
       SELECT
         COALESCE(SUM(CASE WHEN p.bundle_id IS NULL AND p.amount_paid_cents > 0
                           THEN p.quantity ELSE 0 END), 0) AS ticketAdmissions,
         COALESCE(SUM(CASE WHEN p.bundle_id IS NULL AND p.amount_paid_cents = 0
                           THEN p.quantity ELSE 0 END), 0) AS complimentaryAdmissions,
         COALESCE(SUM(CASE WHEN p.bundle_id IS NOT NULL
                           THEN COALESCE(a.quantity, p.quantity) ELSE 0 END), 0)
           AS passAdmissions
       FROM valid_purchases s
       JOIN ticket_purchases p ON p.id = s.purchaseId
       LEFT JOIN ticket_bundle_allocations a
         ON a.purchase_id = p.id AND a.event_id = ?
       WHERE (p.bundle_id IS NULL AND p.event_id = ?)
          OR (p.bundle_id IS NOT NULL AND a.event_id IS NOT NULL)`,
      eventId,
      eventId,
      eventId,
    )
    .one();

  const singleEventPaymentsCents = singleEvent.paymentCents;
  const seasonPassProceedsCents = bundles.paymentCents;
  const refundsCents = singleEvent.refundCents + bundles.refundCents;
  const netProceedsCents = singleEventPaymentsCents + seasonPassProceedsCents - refundsCents;
  const totalAdmissions =
    singleEvent.ticketAdmissions + singleEvent.complimentaryAdmissions + bundles.passAdmissions;

  return Response.json({
    admissions: {
      complimentaryAdmissions: singleEvent.complimentaryAdmissions,
      singleEventAdmissions: singleEvent.ticketAdmissions,
      seasonPassAdmissions: bundles.passAdmissions,
      totalAdmissions,
    },
    event,
    financials: {
      netProceedsCents,
      refundsCents,
      seasonPassProceedsCents,
      singleEventPaymentsCents,
    },
    scans: {
      complimentaryAdmissions: scans.complimentaryAdmissions,
      recordsAvailable: scanRecordCount > 0,
      seasonPassAdmissions: scans.passAdmissions,
      singleEventAdmissions: scans.ticketAdmissions,
      totalAdmissions:
        scans.ticketAdmissions + scans.complimentaryAdmissions + scans.passAdmissions,
    },
  });
}
