import { areAuditionDatesPassed, POLL_ARCHIVE_DELAY_DAYS } from "@choir/domain";
import {
  organizationAuditionSettingsSchema,
  type OrganizationAuditionSettings,
} from "@choir/contracts";
import {
  scheduleCheckoutReminderJobs,
  expireUncertainCheckoutReminderClaims,
  invalidateCheckoutReminderGenerations,
} from "./checkoutReminderDeliveryStore";
import { cleanupCheckoutReminders } from "./checkoutReminderStore";

const POLL_ARCHIVE_BATCH_SIZE = 100;

interface PollArchiveCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly expiresAt: string;
  readonly id: string;
  readonly title: string;
}

export function archiveDuePolls(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const archiveBefore = new Date(
    now.getTime() - POLL_ARCHIVE_DELAY_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const candidates = storage.sql
    .exec<PollArchiveCandidateRow>(
      `SELECT id, title, expires_at AS expiresAt
       FROM polls
       WHERE archived_at = '' AND expires_at != '' AND expires_at <= ?
       ORDER BY expires_at, id
       LIMIT ?`,
      archiveBefore,
      POLL_ARCHIVE_BATCH_SIZE,
    )
    .toArray();
  if (candidates.length === 0) return;

  const archivedAt = now.toISOString();
  storage.transactionSync(() => {
    for (const candidate of candidates) {
      storage.sql.exec(
        `UPDATE polls SET archived_at = ?, updated_at = ?
         WHERE id = ? AND archived_at = ''`,
        archivedAt,
        archivedAt,
        candidate.id,
      );
      storage.sql.exec(
        `INSERT OR IGNORE INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_system', 'system:scheduler', 'poll.archived',
           'poll', ?, ?, ?, ?)`,
        `poll-auto-archived:${organizationId}:${candidate.id}`,
        candidate.id,
        `poll-auto-archived:${organizationId}:${candidate.id}`,
        JSON.stringify({ expiresAt: candidate.expiresAt, reason: "expiration" }),
        archivedAt,
      );
    }
  });
}

export function autoDisableExpiredAuditions(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const row = storage.sql
    .exec<{ readonly settings: string }>(
      "SELECT audition_settings_json AS settings FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (!row?.settings) return;
  try {
    const parsed = organizationAuditionSettingsSchema.safeParse(JSON.parse(row.settings));
    if (parsed.success && parsed.data.enabled && areAuditionDatesPassed(parsed.data, now)) {
      const disabled: OrganizationAuditionSettings = { ...parsed.data, enabled: false };
      const nowIso = now.toISOString();
      storage.transactionSync(() => {
        storage.sql.exec(
          "UPDATE organization_metadata SET audition_settings_json = ?, updated_at = ?",
          JSON.stringify(disabled),
          nowIso,
        );
        storage.sql.exec(
          `INSERT OR IGNORE INTO audit_events
            (id, actor_type, actor_id, action, target_type, target_id,
             request_id, change_summary, occurred_at)
           VALUES (?, 'organization_system', 'system:scheduler', 'audition.settings_auto_disabled',
             'audition_settings', ?, ?, ?, ?)`,
          `audition-auto-disabled:${organizationId}:${nowIso}`,
          organizationId,
          `audition-auto-disabled:${organizationId}:${nowIso}`,
          JSON.stringify({
            defaultPerformanceId: disabled.defaultPerformanceId,
            enabled: false,
            mode: disabled.mode,
            reason: "audition_dates_passed",
            slotCount: disabled.slots.length,
          }),
          nowIso,
        );
      });
    }
  } catch {
    // Ignore invalid audition settings in scheduler loop
  }
}

export function processCheckoutReminderWork(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): boolean {
  const invalidated = invalidateCheckoutReminderGenerations(storage, organizationId, now);
  const scheduled = scheduleCheckoutReminderJobs(storage, organizationId, now);
  const cleaned = cleanupCheckoutReminders(storage, now.toISOString());
  const uncertain = expireUncertainCheckoutReminderClaims(storage, now);
  return invalidated === 100 || scheduled === 100 || cleaned.hasMore || uncertain === 100;
}
