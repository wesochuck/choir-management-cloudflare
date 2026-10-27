import { canSetDonationThankYouStatus } from "@choir/domain";
import type { z } from "zod";

import { donationById, donationResult } from "./queries";
import type {
  attachDonationArtworkOperationSchema,
  refundOperationSchema,
  updateDonationThankYouOperationSchema,
} from "./types";

export function attachDonationArtwork(
  storage: DurableObjectStorage,
  operation: z.infer<typeof attachDonationArtworkOperationSchema>,
): Response {
  const donation = donationById(storage, operation.donationId);
  if (!donation) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (donation.includesProgramAd !== 1) {
    return Response.json({ code: "donation_not_eligible_for_ad" }, { status: 400 });
  }
  const fileRow = storage.sql
    .exec<{ readonly fileName: string; readonly id: string }>(
      "SELECT id, file_name AS fileName FROM private_files WHERE id = ? LIMIT 1",
      operation.fileId,
    )
    .toArray()
    .at(0);
  if (!fileRow) {
    return Response.json({ code: "file_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  const previousFileId = donation.artworkFileId;
  const isReplacement = Boolean(previousFileId);
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE donations SET artwork_file_id = ?, artwork_status = 'received', artwork_uploaded_at = ?, updated_at = ? WHERE id = ?",
      operation.fileId,
      now,
      now,
      operation.donationId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, ?, 'donation', ?, ?, ?, ?)`,
      `donation-artwork:${operation.requestId}`,
      operation.actorType,
      operation.actorUserId,
      isReplacement ? "donation.artwork_replaced" : "donation.artwork_uploaded",
      operation.donationId,
      operation.requestId,
      JSON.stringify({
        fileName: fileRow.fileName,
        newFileId: operation.fileId,
        previousFileId,
      }),
      now,
    );
  });
  const updated = donationById(storage, operation.donationId);
  return updated
    ? Response.json(donationResult(updated))
    : Response.json({ code: "donation_not_found" }, { status: 404 });
}

export function updateDonationThankYou(
  storage: DurableObjectStorage,
  operation: z.infer<typeof updateDonationThankYouOperationSchema>,
): Response {
  const donation = donationById(storage, operation.donationId);
  if (!donation) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (!canSetDonationThankYouStatus(donation.status, operation.thankYouSent))
    return Response.json({ code: "refunded_donation_thank_you_not_allowed" }, { status: 409 });
  const now = new Date().toISOString();
  const thankYouSentAt = operation.thankYouSent ? now : null;
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE donations SET thank_you_sent_at = ?, updated_at = ? WHERE id = ?",
      thankYouSentAt,
      now,
      operation.donationId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'donation.thank_you_updated', 'donation', ?, ?, ?, ?)`,
      `donation-thank-you:${operation.requestId}`,
      operation.actorUserId,
      operation.donationId,
      operation.requestId,
      JSON.stringify({ thankYouSent: operation.thankYouSent, thankYouSentAt }),
      now,
    );
  });
  const updated = donationById(storage, operation.donationId);
  return updated
    ? Response.json(donationResult(updated))
    : Response.json({ code: "donation_not_found" }, { status: 404 });
}

export function refundDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof refundOperationSchema>,
): Response {
  const row = donationById(storage, operation.donationId);
  if (!row) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (row.status === "refunded") return Response.json(donationResult(row));
  if (row.status !== "paid")
    return Response.json({ code: "donation_not_refundable" }, { status: 409 });
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE donations SET status = 'refunded', updated_at = ? WHERE id = ?",
      occurredAt,
      operation.donationId,
    );
    if (row.patronId) {
      storage.sql.exec(
        `UPDATE patrons SET total_donated_cents = MAX(0, total_donated_cents - ?), donation_count = MAX(0, donation_count - 1), updated_at = ? WHERE id = ?`,
        row.amountCents,
        occurredAt,
        row.patronId,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'donation.refunded', 'donation', ?, ?, ?, ?)`,
      `donation-refund:${operation.requestId}`,
      operation.actorUserId,
      operation.donationId,
      operation.requestId,
      JSON.stringify({ amountCents: row.amountCents }),
      occurredAt,
    );
  });
  return Response.json({ ...donationResult(row), status: "refunded", updatedAt: occurredAt });
}
