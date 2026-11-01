import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { z } from "zod";

import { auditionSystemCommunicationTemplateIds } from "../schema";
import { insertNotificationReceipt } from "../notificationInboxStore";
import { renderAuditionSystemCommunication } from "./helpers";

export function queueAuditionNotification(
  storage: DurableObjectStorage,
  input: {
    readonly auditionId: string;
    readonly contentMarkdown: string;
    readonly dedupeKey: string;
    readonly destination: string;
    readonly kind:
      "inquiry_confirmation" | "scheduled_confirmation" | "audition_reminder" | "admin_alert";
    readonly profileId?: string | null;
    readonly recipientName: string;
    readonly subject: string;
    readonly scheduledFor: string;
  },
): void {
  if (!z.email().safeParse(input.destination).success) return;
  const existing = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM audition_notifications WHERE dedupe_key = ? LIMIT 1",
      input.dedupeKey,
    )
    .toArray()
    .at(0);
  if (existing) return;
  const notificationId = crypto.randomUUID();
  const now = new Date().toISOString();
  storage.sql.exec(
    `INSERT INTO audition_notifications
      (id, audition_id, dedupe_key, kind, destination, recipient_name, subject,
       content_markdown, status, scheduled_for, created_at, updated_at, profile_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    notificationId,
    input.auditionId,
    input.dedupeKey,
    input.kind,
    input.destination,
    input.recipientName,
    input.subject,
    input.contentMarkdown,
    input.scheduledFor,
    now,
    now,
    input.profileId ?? null,
  );
  storage.sql.exec(
    `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
     VALUES (?, 'audition_notification', ?, ?, ?)`,
    crypto.randomUUID(),
    `audition-notification:${notificationId}`,
    input.scheduledFor,
    now,
  );
}

export function queueCreateNotifications(
  storage: DurableObjectStorage,
  auditionId: string,
  name: string,
  email: string,
): void {
  const now = new Date().toISOString();
  const message = renderAuditionSystemCommunication(
    storage,
    auditionSystemCommunicationTemplateIds.submission,
    name,
  );
  queueAuditionNotification(storage, {
    auditionId,
    contentMarkdown: message.contentMarkdown,
    dedupeKey: `audition-confirmation:${auditionId}`,
    destination: email,
    kind: "inquiry_confirmation",
    recipientName: name,
    scheduledFor: now,
    subject: message.subject,
  });

  const recipients = storage.sql
    .exec<{
      readonly displayName: string;
      readonly email: string | null;
      readonly profileId: string;
    }>(
      `SELECT p.id AS profileId, p.display_name AS displayName,
              (SELECT c.email FROM contacts c WHERE c.profile_id = p.id ORDER BY c.created_at, c.id LIMIT 1) AS email
       FROM profiles p
       WHERE p.global_status = 'Active'
         AND p.do_not_email = 0
         AND p.provider_email_suppressed = 0
         AND p.receive_audition_notifications = 1`,
    )
    .toArray();

  for (const recipient of recipients) {
    if (!recipient.email || !z.email().safeParse(recipient.email).success) continue;
    const dedupeKey = `audition-admin-alert:${auditionId}:${recipient.profileId}`;
    queueAuditionNotification(storage, {
      auditionId,
      contentMarkdown: `## New audition inquiry\n\n**${name}** submitted an audition inquiry.\n\nReview the inquiry in Audition Manager.`,
      dedupeKey,
      destination: recipient.email,
      kind: "admin_alert",
      profileId: recipient.profileId,
      recipientName: recipient.displayName || "Organization administrator",
      scheduledFor: now,
      subject: `Audition inquiry: ${name}`,
    });
    insertNotificationReceipt(storage, {
      body: `${name} submitted an audition inquiry.`,
      destinationPath: "/admin/auditions",
      kind: "audition",
      now,
      originalOccurredAt: now,
      recipientProfileId: recipient.profileId,
      sourceKey: dedupeKey,
      title: `Audition inquiry: ${name}`,
    });
  }
}
