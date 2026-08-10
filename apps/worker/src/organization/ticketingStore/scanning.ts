import { ticketScanResultSchema } from "@choir/contracts";
import type { z } from "zod";

import type { issueScanCredentialOperationSchema, validateScanOperationSchema } from "./contracts";
import { purchaseSelect, type TicketPurchaseRow } from "./contracts";
import { purchaseResult } from "./readModel";

export function issueTicketScanCredential(
  storage: DurableObjectStorage,
  operation: z.infer<typeof issueScanCredentialOperationSchema>,
): Response {
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  if (row?.status !== "paid") {
    return Response.json({ code: "ticket_scan_unavailable" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    row.scanCredentialNonce &&
    row.scanCredentialIssuedAt !== null &&
    row.scanCredentialExpiresAt !== null &&
    row.scanCredentialExpiresAt > now
  ) {
    return Response.json({
      expiresAt: row.scanCredentialExpiresAt,
      issuedAt: row.scanCredentialIssuedAt,
      nonce: row.scanCredentialNonce,
    });
  }
  if (row.scanCredentialIssuedAt !== null && now - row.scanCredentialIssuedAt < 60) {
    return Response.json({ code: "ticket_scan_rate_limited" }, { status: 429 });
  }

  const nonce = crypto.randomUUID();
  const expiresAt = now + 15 * 60;
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE ticket_purchases
       SET scan_credential_nonce = ?, scan_credential_issued_at = ?,
           scan_credential_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'paid'`,
      nonce,
      now,
      expiresAt,
      occurredAt,
      operation.purchaseId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'public_visitor', 'ticket-holder', 'ticket.scan_credential.issued',
         'ticket_purchase', ?, ?, ?, ?)`,
      `ticket-scan-credential:${operation.purchaseId}:${String(now)}`,
      operation.purchaseId,
      operation.requestId,
      JSON.stringify({ expiresAt }),
      occurredAt,
    );
  });
  return Response.json({ expiresAt, issuedAt: now, nonce });
}

export function validateTicketScan(
  storage: DurableObjectStorage,
  operation: z.infer<typeof validateScanOperationSchema>,
): Response {
  const now = Math.floor(Date.now() / 1000);
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  const credentialMatches =
    row?.scanCredentialNonce === operation.scanNonce &&
    row.scanCredentialIssuedAt !== null &&
    row.scanCredentialExpiresAt !== null &&
    row.scanCredentialIssuedAt <= now &&
    row.scanCredentialExpiresAt > now;
  const purchase = row && credentialMatches ? purchaseResult(row) : null;
  const scannedEvent = purchase?.includedEvents.find(({ id }) => id === operation.eventId);
  const result =
    !row || !credentialMatches
      ? ticketScanResultSchema.parse({ reason: "not_found", valid: false })
      : row.status !== "paid"
        ? ticketScanResultSchema.parse({ reason: "not_paid", valid: false })
        : !scannedEvent
          ? ticketScanResultSchema.parse({ reason: "wrong_event", valid: false })
          : ticketScanResultSchema.parse({
              buyerName: row.buyerName,
              eventId: scannedEvent.id,
              eventStartsAt: scannedEvent.startsAt,
              eventTitle: scannedEvent.title,
              purchaseId: row.id,
              quantity: row.quantity,
              valid: true,
            });
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    const replayed =
      row !== undefined &&
      credentialMatches &&
      storage.sql
        .exec(
          "SELECT id FROM ticket_scan_events WHERE purchase_id = ? AND credential_nonce = ? LIMIT 1",
          operation.purchaseId,
          operation.scanNonce,
        )
        .toArray().length > 0;
    storage.sql.exec(
      `INSERT INTO ticket_scan_events
        (id, purchase_id, event_id, actor_user_id, result, request_id, occurred_at, credential_nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.purchaseId,
      operation.eventId,
      operation.actorUserId,
      result.valid ? "valid" : result.reason,
      operation.requestId,
      occurredAt,
      operation.scanNonce,
    );
    if (replayed) {
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'ticket.scan.replayed',
           'ticket_purchase', ?, ?, ?, ?)`,
        `ticket-scan-replay:${operation.requestId}`,
        operation.actorUserId,
        operation.purchaseId,
        operation.requestId,
        JSON.stringify({ eventId: operation.eventId, valid: result.valid }),
        occurredAt,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.scan.validated',
        'ticket_purchase', ?, ?, ?, ?)`,
      `ticket-scan:${operation.requestId}`,
      operation.actorUserId,
      operation.purchaseId,
      operation.requestId,
      JSON.stringify({
        eventId: operation.eventId,
        result: result.valid ? "valid" : result.reason,
      }),
      occurredAt,
    );
  });
  return Response.json(result);
}
