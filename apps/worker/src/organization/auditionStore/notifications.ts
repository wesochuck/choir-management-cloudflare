import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { z } from "zod";

import { auditionSystemCommunicationTemplateIds } from "../schema";
import { renderAuditionSystemCommunication, storedAuditionSettings } from "./helpers";

export function queueAuditionNotification(
  storage: DurableObjectStorage,
  input: {
    readonly auditionId: string;
    readonly contentMarkdown: string;
    readonly dedupeKey: string;
    readonly destination: string;
    readonly kind:
      "inquiry_confirmation" | "scheduled_confirmation" | "audition_reminder" | "admin_alert";
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
       content_markdown, status, scheduled_for, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
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
  const settings = storedAuditionSettings(storage);
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
  if (settings.adminNotifyEnabled) {
    for (const destination of settings.adminNotifyUsers) {
      queueAuditionNotification(storage, {
        auditionId,
        contentMarkdown: `## New audition inquiry\n\n**${name}** submitted an audition inquiry.\n\nReview the inquiry in Audition Manager.`,
        dedupeKey: `audition-admin-alert:${auditionId}:${destination}`,
        destination,
        kind: "admin_alert",
        recipientName: "Organization administrator",
        scheduledFor: now,
        subject: `Audition inquiry: ${name}`,
      });
    }
  }
}
