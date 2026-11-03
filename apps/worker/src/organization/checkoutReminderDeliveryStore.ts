import type { CheckoutRecoveryChoices, CheckoutReminderSettings } from "@choir/contracts";
import { checkoutReminderTemplates } from "@choir/domain";
import { checkoutRecoveryChoicesSchema } from "@choir/contracts";
import {
  CHECKOUT_REMINDER_COOLDOWN_MS,
  CHECKOUT_REMINDER_RETENTION_MS,
  CHECKOUT_RECOVERY_LIFETIME_MS,
  CHECKOUT_REMINDER_WAIT_MS,
} from "@choir/domain";
import {
  readCheckoutReminderSettings,
  releaseCheckoutReminderClaim,
} from "./checkoutReminderStore";
import { readTicketEvent, ticketEventIsOpen } from "./ticketingStore/readModel";

export function scheduleCheckoutReminderJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
) {
  const settings = readCheckoutReminderSettings(storage, organizationId);
  const rows = storage.sql
    .exec<{ id: string; generation: number }>(
      "SELECT id,generation FROM checkout_reminders WHERE state = 'scheduled' AND due_at <= ? ORDER BY due_at,id LIMIT 100",
      now.toISOString(),
    )
    .toArray();
  storage.transactionSync(() => {
    for (const row of rows) {
      if (!settings.enabled || row.generation !== settings.generation) {
        finishReminder(storage, row.id, "skipped", "organization_disabled", now.toISOString());
        continue;
      }
      storage.sql.exec(
        "INSERT OR IGNORE INTO scheduled_job_outbox(job_id,kind,idempotency_key,due_at,created_at) VALUES(?,'checkout_reminder',?,?,?)",
        row.id,
        `checkout-reminder:${row.id}`,
        now.toISOString(),
        now.toISOString(),
      );
      storage.sql.exec(
        "UPDATE checkout_reminders SET state = 'queued' WHERE id = ? AND state = 'scheduled'",
        row.id,
      );
    }
  });
  return rows.length;
}

export function finishReminder(
  storage: DurableObjectStorage,
  id: string,
  state: "sent" | "skipped" | "failed",
  reason: string | null,
  now: string,
  providerMessageId: string | null = null,
) {
  storage.sql.exec(
    `UPDATE checkout_reminders SET state = ?,skip_reason = ?,terminal_at = ?,cleanup_at = ?,provider_message_id = ?,sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE id = ?`,
    state,
    reason,
    now,
    new Date(Date.parse(now) + CHECKOUT_REMINDER_RETENTION_MS).toISOString(),
    providerMessageId,
    state,
    now,
    id,
  );
}

function ticketUnavailable(
  storage: DurableObjectStorage,
  resourceId: string,
  eventIds: readonly string[],
  quantity: number,
  now: Date,
): boolean {
  if (eventIds.length === 0) return true;
  const purchase = storage.sql
    .exec<{ bundleId: string | null }>(
      "SELECT bundle_id AS bundleId FROM ticket_purchases WHERE id = ?",
      resourceId,
    )
    .toArray()[0];
  if (purchase?.bundleId) {
    const bundle = storage.sql
      .exec<{ isActive: number; saleEndAt: string; capacity: number | null }>(
        "SELECT is_active AS isActive,sale_end_at AS saleEndAt,capacity FROM ticket_bundles WHERE id = ?",
        purchase.bundleId,
      )
      .toArray()[0];
    if (!bundle?.isActive || Date.parse(bundle.saleEndAt) <= now.getTime()) return true;
    if (bundle.capacity !== null) {
      const reserved = storage.sql
        .exec<{ count: number }>(
          "SELECT COALESCE(SUM(quantity),0) AS count FROM ticket_purchases WHERE bundle_id = ? AND (status = 'paid' OR (status = 'pending' AND expires_at >= ?))",
          purchase.bundleId,
          now.toISOString(),
        )
        .one().count;
      if (reserved + quantity > bundle.capacity) return true;
    }
  }
  for (const id of eventIds) {
    const event = readTicketEvent(storage, id);
    if (
      !ticketEventIsOpen(event, now) ||
      Date.parse(event.startsAt) - now.getTime() < CHECKOUT_REMINDER_WAIT_MS
    )
      return true;
    if (event.ticketCapacity === null) continue;
    const reserved = storage.sql
      .exec<{ count: number }>(
        `SELECT
      (SELECT COALESCE(SUM(quantity),0) FROM ticket_purchases WHERE event_id = ? AND bundle_id IS NULL AND (status = 'paid' OR (status = 'pending' AND (expires_at IS NULL OR expires_at >= ?)))) +
      (SELECT COALESCE(SUM(a.quantity),0) FROM ticket_bundle_allocations a JOIN ticket_purchases p ON p.id = a.purchase_id WHERE a.event_id = ? AND (p.status = 'paid' OR (p.status = 'pending' AND (p.expires_at IS NULL OR p.expires_at >= ?)))) AS count`,
        id,
        now.toISOString(),
        id,
        now.toISOString(),
      )
      .one().count;
    if (reserved + quantity > event.ticketCapacity) return true;
  }
  return false;
}

export function claimCheckoutReminder(
  storage: DurableObjectStorage,
  input: {
    organizationId: string;
    id: string;
    externallySuppressed: boolean;
    profileIds: readonly string[];
  },
) {
  const settings = readCheckoutReminderSettings(storage, input.organizationId);
  const now = new Date();
  return storage.transactionSync(() => {
    const row = storage.sql
      .exec<ReminderClaimRow>(
        `SELECT r.id,r.generation,r.state,r.choices_json AS choicesJson,r.recipient_id AS recipientId,r.attempt_id AS attemptId,
      p.newest_attempt_id AS newestAttemptId,p.opted_out AS optedOut,p.last_sent_at AS lastSentAt,p.claim_id AS claimId,
      r.nonce,r.started_at AS startedAt FROM checkout_reminders r JOIN checkout_reminder_recipients p ON p.id = r.recipient_id WHERE r.id = ?`,
        input.id,
      )
      .toArray()[0];
    if (row?.state !== "queued") return null;
    const choices = checkoutRecoveryChoicesSchema.parse(JSON.parse(row.choicesJson));
    if (input.profileIds.length > 500) throw new Error("Invalid reminder profile lookup.");
    const profileSuppressed =
      input.profileIds.length > 0 &&
      storage.sql
        .exec(
          `SELECT id FROM profiles WHERE id IN (${input.profileIds.map(() => "?").join(",")}) AND (do_not_email = 1 OR provider_email_suppressed = 1) LIMIT 1`,
          ...input.profileIds,
        )
        .toArray().length > 0;
    const reason = reminderSkipReason(
      storage,
      row,
      choices,
      settings,
      input.externallySuppressed || profileSuppressed,
      now,
    );
    if (reason) {
      finishReminder(storage, row.id, "skipped", reason, now.toISOString());
      return null;
    }
    let expiresAt = now.getTime() + CHECKOUT_RECOVERY_LIFETIME_MS;
    if (choices.kind === "ticket") {
      for (const eventId of choices.eventIds) {
        const event = readTicketEvent(storage, eventId);
        if (event) expiresAt = Math.min(expiresAt, Date.parse(event.startsAt));
      }
      if (choices.bundleId) {
        const bundle = storage.sql
          .exec<{ saleEndAt: string }>(
            "SELECT sale_end_at AS saleEndAt FROM ticket_bundles WHERE id = ?",
            choices.bundleId,
          )
          .toArray()[0];
        if (bundle) expiresAt = Math.min(expiresAt, Date.parse(bundle.saleEndAt));
      }
    }
    storage.sql.exec(
      "UPDATE checkout_reminder_recipients SET claim_id = ?,last_sent_at = ? WHERE id = ?",
      row.id,
      now.toISOString(),
      row.recipientId,
    );
    storage.sql.exec(
      "UPDATE checkout_reminders SET state = 'sending',link_issued_at = ?,link_expires_at = ? WHERE id = ?",
      now.toISOString(),
      new Date(expiresAt).toISOString(),
      row.id,
    );
    const fallback = checkoutReminderTemplates.find((template) => template.kind === choices.kind);
    if (!fallback) throw new Error("checkout_reminder_template_missing");
    const template =
      storage.sql
        .exec<{ subject: string; contentMarkdown: string }>(
          "SELECT subject,content_markdown AS contentMarkdown FROM communication_templates WHERE id = ? AND is_system = 1",
          fallback.id,
        )
        .toArray()[0] ?? fallback;
    const metadata = reminderMetadata(storage, choices);
    return {
      ...metadata,
      subject: template.subject,
      contentMarkdown: template.contentMarkdown,
      id: row.id,
      recipientId: row.recipientId,
      nonce: row.nonce,
      choices,
      issuedAt: Math.floor(now.getTime() / 1000),
      expiresAt: Math.floor(expiresAt / 1000),
    };
  });
}

export function checkoutReminderDestination(
  storage: DurableObjectStorage,
  input: { organizationId: string; id: string },
) {
  readCheckoutReminderSettings(storage, input.organizationId);
  return (
    storage.sql
      .exec<{ email: string }>(
        "SELECT p.email FROM checkout_reminders r JOIN checkout_reminder_recipients p ON p.id = r.recipient_id WHERE r.id = ?",
        input.id,
      )
      .toArray()[0]?.email ?? null
  );
}

export function recordCheckoutReminderResult(
  storage: DurableObjectStorage,
  input: {
    organizationId: string;
    id: string;
    state: "sent" | "skipped" | "failed";
    reason: string | null;
    providerMessageId: string | null;
  },
) {
  readCheckoutReminderSettings(storage, input.organizationId);
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    const current = storage.sql
      .exec<{ state: string }>("SELECT state FROM checkout_reminders WHERE id = ?", input.id)
      .toArray()[0];
    if (!current || current.state === "sent" || current.state === input.state) return;

    finishReminder(storage, input.id, input.state, input.reason, now, input.providerMessageId);
    releaseCheckoutReminderClaim(storage, input.id);
  });
}

interface ReminderClaimRow {
  readonly [column: string]: SqlStorageValue;
  id: string;
  generation: number;
  state: string;
  choicesJson: string;
  recipientId: string;
  attemptId: string;
  newestAttemptId: string | null;
  optedOut: number;
  lastSentAt: string | null;
  claimId: string | null;
  nonce: string;
  startedAt: string;
}

function reminderSkipReason(
  storage: DurableObjectStorage,
  row: ReminderClaimRow,
  choices: CheckoutRecoveryChoices,
  settings: CheckoutReminderSettings,
  externallySuppressed: boolean,
  now: Date,
): string | null {
  let reason: string | null = null;
  if (!settings.enabled || settings.generation !== row.generation) reason = "organization_disabled";
  else if (row.newestAttemptId !== row.attemptId) reason = "newer_checkout";
  else if (row.optedOut || externallySuppressed) reason = "recipient_suppressed";
  else if (
    row.claimId ||
    (row.lastSentAt && now.getTime() - Date.parse(row.lastSentAt) < CHECKOUT_REMINDER_COOLDOWN_MS)
  )
    reason = "frequency_limit";
  return reason ?? reminderResourceSkipReason(storage, choices, now);
}

function reminderResourceSkipReason(
  storage: DurableObjectStorage,
  choices: CheckoutRecoveryChoices,
  now: Date,
): string | null {
  const contactSuppressed =
    storage.sql
      .exec(
        `SELECT 1 FROM contacts c LEFT JOIN contact_communication_preferences p ON p.contact_id = c.id AND p.channel = 'email' WHERE c.normalized_email = ? AND p.status = 'unsubscribed' LIMIT 1`,
        choices.email,
      )
      .toArray().length > 0;
  if (contactSuppressed) return "general_email_unsubscribe";
  const table = choices.kind === "ticket" ? "ticket_purchases" : "donations";
  const payment = storage.sql
    .exec<{ status: string }>(`SELECT status FROM ${table} WHERE id = ?`, choices.resourceId)
    .toArray()[0];
  if (!payment || payment.status === "paid" || payment.status === "refunded")
    return "payment_completed";
  if (
    choices.kind === "ticket" &&
    ticketUnavailable(storage, choices.resourceId, choices.eventIds, choices.quantity ?? 1, now)
  )
    return "tickets_unavailable";
  return null;
}

export function expireUncertainCheckoutReminderClaims(storage: DurableObjectStorage, now: Date) {
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const rows = storage.sql
    .exec<{ id: string }>(
      "SELECT id FROM checkout_reminders WHERE state = 'sending' AND link_issued_at <= ? ORDER BY link_issued_at,id LIMIT 100",
      cutoff,
    )
    .toArray();
  storage.transactionSync(() => {
    for (const row of rows) {
      finishReminder(storage, row.id, "failed", "delivery_outcome_unknown", now.toISOString());
      releaseCheckoutReminderClaim(storage, row.id);
    }
  });
  return rows.length;
}

export function invalidateCheckoutReminderGenerations(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
) {
  const settings = readCheckoutReminderSettings(storage, organizationId);
  const rows = storage.sql
    .exec<{ id: string }>(
      "SELECT id FROM checkout_reminders WHERE state IN ('scheduled','queued') AND generation < ? ORDER BY generation,id LIMIT 100",
      settings.generation,
    )
    .toArray();
  storage.transactionSync(() => {
    for (const row of rows)
      finishReminder(storage, row.id, "skipped", "organization_disabled", now.toISOString());
  });
  return rows.length;
}

function reminderMetadata(storage: DurableObjectStorage, choices: CheckoutRecoveryChoices) {
  const table = choices.kind === "ticket" ? "ticket_purchases" : "donations";
  const buyer = storage.sql
    .exec<{ name: string }>(
      `SELECT buyer_name AS name FROM ${table} WHERE id = ?`,
      choices.resourceId,
    )
    .toArray()[0];
  const events = choices.eventIds
    .map((eventId) => readTicketEvent(storage, eventId))
    .filter((event) => event !== undefined);
  const timezone = storage.sql
    .exec<{ timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  const level =
    choices.kind === "donation"
      ? storage.sql
          .exec<{ label: string | null }>(
            "SELECT selected_level_name AS label FROM donations WHERE id = ?",
            choices.resourceId,
          )
          .toArray()[0]?.label
      : null;
  return {
    recipientName: buyer?.name.trim() ?? "there",
    eventTitles: events.map((event) => event.title),
    eventStartsAt: events.map((event) => event.startsAt),
    timezone,
    donationLevel: level ?? "",
  };
}

export function confirmCheckoutReminderSend(
  storage: DurableObjectStorage,
  input: {
    organizationId: string;
    id: string;
    externallySuppressed: boolean;
    profileIds: readonly string[];
  },
): boolean {
  const settings = readCheckoutReminderSettings(storage, input.organizationId);
  if (input.profileIds.length > 500) throw new Error("Invalid reminder profile lookup.");
  const now = new Date();
  return storage.transactionSync(() => {
    const row = storage.sql
      .exec<ReminderClaimRow>(
        `SELECT r.id,r.generation,r.state,r.choices_json AS choicesJson,r.recipient_id AS recipientId,r.attempt_id AS attemptId,p.newest_attempt_id AS newestAttemptId,p.opted_out AS optedOut,p.last_sent_at AS lastSentAt,p.claim_id AS claimId,r.nonce,r.started_at AS startedAt FROM checkout_reminders r JOIN checkout_reminder_recipients p ON p.id=r.recipient_id WHERE r.id=?`,
        input.id,
      )
      .toArray()[0];
    if (row?.state !== "sending" || row.claimId !== row.id) return false;
    const choices = checkoutRecoveryChoicesSchema.parse(JSON.parse(row.choicesJson));
    const profileSuppressed =
      input.profileIds.length > 0 &&
      storage.sql
        .exec(
          `SELECT id FROM profiles WHERE id IN (${input.profileIds.map(() => "?").join(",")}) AND (do_not_email = 1 OR provider_email_suppressed = 1) LIMIT 1`,
          ...input.profileIds,
        )
        .toArray().length > 0;
    const reason = reminderSkipReason(
      storage,
      { ...row, claimId: null, lastSentAt: null },
      choices,
      settings,
      input.externallySuppressed || profileSuppressed,
      now,
    );
    if (!reason) return true;
    finishReminder(storage, row.id, "skipped", reason, now.toISOString());
    releaseCheckoutReminderClaim(storage, row.id);
    return false;
  });
}
