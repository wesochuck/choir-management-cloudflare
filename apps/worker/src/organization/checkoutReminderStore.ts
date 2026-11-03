import type { ContactStoreStorage } from "./contactStore";
import {
  checkoutReminderCaptureSchema,
  checkoutReminderSettingsSchema,
  checkoutRecoveryChoicesSchema,
  type CheckoutReminderCapture,
} from "@choir/contracts";
import {
  CHECKOUT_REMINDER_WAIT_MS,
  CHECKOUT_REMINDER_RETENTION_MS,
  normalizeCheckoutReminderEmail,
} from "@choir/domain";

function assertIdentity(storage: ContactStoreStorage, organizationId: string): void {
  const row = storage.sql
    .exec<{ organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()[0];
  if (row?.organizationId !== organizationId) throw new Error("organization_identity_conflict");
}

export function readCheckoutReminderSettings(storage: ContactStoreStorage, organizationId: string) {
  assertIdentity(storage, organizationId);
  const row = storage.sql
    .exec<{ enabled: number; enabledSince: string; generation: number }>(
      "SELECT enabled, enabled_since AS enabledSince, generation FROM checkout_reminder_settings WHERE id = 1",
    )
    .toArray()[0];
  if (!row) throw new Error("checkout_reminder_settings_missing");
  return checkoutReminderSettingsSchema.parse({ ...row, enabled: row.enabled === 1 });
}

export function setCheckoutReminderSettings(
  storage: ContactStoreStorage,
  input: { organizationId: string; enabled: boolean; actorUserId: string; requestId: string },
) {
  const current = readCheckoutReminderSettings(storage, input.organizationId);
  if (current.enabled === input.enabled) return current;
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE checkout_reminder_settings SET enabled = ?, enabled_since = ?, generation = generation + 1 WHERE id = 1",
      input.enabled ? 1 : 0,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,request_id,change_summary,occurred_at)
       VALUES(?,'organization_member',?,'checkout_reminders.settings_changed','organization',?,?,?,?)`,
      crypto.randomUUID(),
      input.actorUserId,
      input.organizationId,
      input.requestId,
      JSON.stringify({ enabled: input.enabled }),
      now,
    );
  });
  return readCheckoutReminderSettings(storage, input.organizationId);
}

function skipReminder(storage: ContactStoreStorage, id: string, reason: string, now: string) {
  storage.sql.exec(
    `UPDATE checkout_reminders SET state = 'skipped', skip_reason = ?, terminal_at = ?, cleanup_at = ?
     WHERE id = ? AND state IN ('scheduled','queued','sending')`,
    reason,
    now,
    new Date(Date.parse(now) + CHECKOUT_REMINDER_RETENTION_MS).toISOString(),
    id,
  );
  releaseCheckoutReminderClaim(storage, id);
}

export function captureCheckoutReminder(
  storage: ContactStoreStorage,
  raw: CheckoutReminderCapture,
  creationOrder = 0,
) {
  const input = checkoutReminderCaptureSchema.parse(raw);
  const settings = readCheckoutReminderSettings(storage, input.organizationId);
  const existing = storage.sql
    .exec<{ id: string }>("SELECT id FROM checkout_reminders WHERE attempt_id = ?", input.attemptId)
    .toArray()[0];
  if (existing) return { id: existing.id, captured: false };
  if (!settings.enabled || input.startedAt < settings.enabledSince)
    return { id: null, captured: false };
  const email = normalizeCheckoutReminderEmail(input.choices.email);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return storage.transactionSync(() => {
    storage.sql.exec(
      "INSERT OR IGNORE INTO checkout_reminder_recipients(id,email) VALUES(?,?)",
      crypto.randomUUID(),
      email,
    );
    const recipient = storage.sql
      .exec<{
        id: string;
        optedOut: number;
        newestAttemptId: string | null;
        newestStartedAt: string | null;
        newestAttemptOrder: number;
      }>(
        `SELECT id,opted_out AS optedOut,newest_attempt_id AS newestAttemptId,
       newest_started_at AS newestStartedAt,newest_attempt_order AS newestAttemptOrder FROM checkout_reminder_recipients WHERE email = ?`,
        email,
      )
      .toArray()[0];
    if (!recipient) throw new Error("checkout_reminder_recipient_missing");
    // A slow provider response attaching an older session cannot replace a newer checkout.
    if (
      recipient.newestStartedAt !== null &&
      (input.startedAt < recipient.newestStartedAt ||
        (input.startedAt === recipient.newestStartedAt &&
          creationOrder <= recipient.newestAttemptOrder))
    ) {
      return { id: null, captured: false };
    }
    if (recipient.newestAttemptId) {
      const older = storage.sql
        .exec<{ id: string }>(
          "SELECT id FROM checkout_reminders WHERE attempt_id = ?",
          recipient.newestAttemptId,
        )
        .toArray()[0];
      if (older) skipReminder(storage, older.id, "newer_checkout", now);
    }
    storage.sql.exec(
      "UPDATE checkout_reminder_recipients SET newest_attempt_id = ?, newest_started_at = ?, newest_attempt_order = ? WHERE id = ?",
      input.attemptId,
      input.startedAt,
      creationOrder,
      recipient.id,
    );
    const skipped = recipient.optedOut === 1;
    storage.sql.exec(
      `INSERT INTO checkout_reminders(id,attempt_id,recipient_id,kind,resource_id,choices_json,
       started_at,due_at,generation,state,skip_reason,terminal_at,cleanup_at,nonce)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.attemptId,
      recipient.id,
      input.choices.kind,
      input.choices.resourceId,
      JSON.stringify({ ...input.choices, email }),
      input.startedAt,
      new Date(Date.parse(input.startedAt) + CHECKOUT_REMINDER_WAIT_MS).toISOString(),
      settings.generation,
      skipped ? "skipped" : "scheduled",
      skipped ? "recipient_opt_out" : null,
      skipped ? now : null,
      skipped ? new Date(Date.parse(now) + CHECKOUT_REMINDER_RETENTION_MS).toISOString() : null,
      crypto.randomUUID(),
    );
    for (const performanceId of new Set(input.choices.eventIds)) {
      storage.sql.exec(
        "INSERT INTO checkout_reminder_performances(reminder_id,performance_id) VALUES(?,?)",
        id,
        performanceId,
      );
    }
    return { id, captured: true };
  });
}

export function stopCheckoutReminders(
  storage: ContactStoreStorage,
  input: { organizationId: string; recipientId: string; requestId?: string },
) {
  assertIdentity(storage, input.organizationId);
  return storage.transactionSync(() => {
    const recipient = storage.sql
      .exec<{ newestAttemptId: string | null }>(
        "SELECT newest_attempt_id AS newestAttemptId FROM checkout_reminder_recipients WHERE id = ?",
        input.recipientId,
      )
      .toArray()[0];
    if (!recipient) return { stopped: false };
    storage.sql.exec(
      "UPDATE checkout_reminder_recipients SET opted_out = 1 WHERE id = ?",
      input.recipientId,
    );
    if (recipient.newestAttemptId) {
      const candidate = storage.sql
        .exec<{ id: string }>(
          "SELECT id FROM checkout_reminders WHERE attempt_id = ?",
          recipient.newestAttemptId,
        )
        .toArray()[0];
      if (candidate)
        skipReminder(storage, candidate.id, "recipient_opt_out", new Date().toISOString());
    }
    storage.sql.exec(
      `INSERT OR IGNORE INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,request_id,change_summary,occurred_at) VALUES(?,'public_link',?,'checkout_reminder.unsubscribed','checkout_reminder_recipient',?,?,?,?)`,
      `checkout-reminder-optout:${input.recipientId}`,
      input.recipientId,
      input.recipientId,
      input.requestId ?? crypto.randomUUID(),
      JSON.stringify({ remindersEnabled: false }),
      new Date().toISOString(),
    );
    return { stopped: true };
  });
}

export function cleanupCheckoutReminders(storage: ContactStoreStorage, now: string) {
  const rows = storage.sql
    .exec<{ id: string }>(
      "SELECT id FROM checkout_reminders WHERE cleanup_at IS NOT NULL AND cleanup_at <= ? ORDER BY cleanup_at,id LIMIT 100",
      now,
    )
    .toArray();
  storage.transactionSync(() => {
    for (const row of rows) {
      storage.sql.exec("DELETE FROM checkout_reminder_performances WHERE reminder_id = ?", row.id);
      storage.sql.exec("DELETE FROM checkout_reminders WHERE id = ?", row.id);
    }
  });
  return { removed: rows.length, hasMore: rows.length === 100 };
}

export function readCheckoutRecoveryChoices(
  storage: ContactStoreStorage,
  input: { organizationId: string; reminderId: string; nonce: string; now: string },
) {
  assertIdentity(storage, input.organizationId);
  const row = storage.sql
    .exec<{ choicesJson: string }>(
      `SELECT r.choices_json AS choicesJson FROM checkout_reminders r
     JOIN checkout_reminder_recipients p ON p.id = r.recipient_id
     WHERE r.id = ? AND r.nonce = ? AND r.state = 'sent' AND r.link_expires_at > ?
     AND p.newest_attempt_id = r.attempt_id LIMIT 1`,
      input.reminderId,
      input.nonce,
      input.now,
    )
    .toArray()[0];
  return row ? checkoutRecoveryChoicesSchema.parse(JSON.parse(row.choicesJson)) : null;
}

/** Capture only an authoritative persisted payment with an attached usable session. */
export function capturePaymentResourceReminder(
  storage: ContactStoreStorage,
  input: { organizationId: string; kind: "ticket" | "donation"; resourceId: string },
) {
  assertIdentity(storage, input.organizationId);
  const table = input.kind === "ticket" ? "ticket_purchases" : "donations";
  const row = storage.sql
    .exec<{
      attemptId: string;
      startedAt: string;
      email: string;
      providerSessionId: string;
      status: string;
      creationOrder: number | null;
    }>(
      `SELECT checkout_request_id AS attemptId,created_at AS startedAt,buyer_email AS email,
      provider_session_id AS providerSessionId,status,(SELECT rowid FROM payment_attempts WHERE resource_id = ${table}.id ORDER BY rowid LIMIT 1) AS creationOrder FROM ${table} WHERE id = ?`,
      input.resourceId,
    )
    .toArray()[0];
  if (row?.status !== "pending" || !row.providerSessionId.startsWith("cs_"))
    return { id: null, captured: false };
  let bundleId: string | null = null;
  let eventIds: string[] = [];
  let quantity: number | null = null;
  let amountCents: number | null;
  let levelId: string | null = null;
  let discountCode: string | null = null;
  if (input.kind === "ticket") {
    const ticket = storage.sql
      .exec<{
        eventId: string;
        bundleId: string | null;
        quantity: number;
        discountCode: string;
        amountCents: number;
      }>(
        "SELECT event_id AS eventId,bundle_id AS bundleId,quantity,discount_code AS discountCode,amount_paid_cents AS amountCents FROM ticket_purchases WHERE id = ?",
        input.resourceId,
      )
      .toArray()[0];
    if (!ticket) return { id: null, captured: false };
    bundleId = ticket.bundleId;
    quantity = ticket.quantity;
    amountCents = ticket.amountCents;
    discountCode = ticket.discountCode || null;
    eventIds = ticket.bundleId
      ? storage.sql
          .exec<{ eventId: string }>(
            "SELECT event_id AS eventId FROM ticket_bundle_allocations WHERE purchase_id = ? ORDER BY event_id",
            input.resourceId,
          )
          .toArray()
          .map((allocation) => allocation.eventId)
      : [ticket.eventId];
  } else {
    const donation = storage.sql
      .exec<{ amountCents: number; levelId: string | null }>(
        "SELECT amount_cents AS amountCents,selected_level_id AS levelId FROM donations WHERE id = ?",
        input.resourceId,
      )
      .toArray()[0];
    if (!donation) return { id: null, captured: false };
    amountCents = donation.amountCents;
    levelId = donation.levelId;
  }
  return captureCheckoutReminder(
    storage,
    {
      organizationId: input.organizationId,
      attemptId: row.attemptId,
      startedAt: row.startedAt,
      choices: {
        bundleId,
        kind: input.kind,
        resourceId: input.resourceId,
        email: row.email,
        eventIds,
        quantity,
        amountCents,
        levelId,
        discountCode,
      },
    },
    row.creationOrder ?? 0,
  );
}

export function cancelCheckoutReminderAfterPayment(
  storage: ContactStoreStorage,
  input: {
    organizationId: string;
    kind: "ticket" | "donation";
    email: string;
    performanceIds: readonly string[];
    paidAt: string;
  },
) {
  assertIdentity(storage, input.organizationId);
  const candidate = storage.sql
    .exec<{
      id: string;
      kind: string;
      startedAt: string;
    }>(
      `SELECT r.id,r.kind,r.started_at AS startedAt FROM checkout_reminder_recipients p
      JOIN checkout_reminders r ON r.attempt_id = p.newest_attempt_id
      WHERE p.email = ? AND r.state IN ('scheduled','queued','sending','sent') LIMIT 1`,
      normalizeCheckoutReminderEmail(input.email),
    )
    .toArray()[0];
  if (candidate?.kind !== input.kind || candidate.startedAt > input.paidAt) return;
  if (input.kind === "ticket") {
    const performances = new Set(
      storage.sql
        .exec<{ performanceId: string }>(
          "SELECT performance_id AS performanceId FROM checkout_reminder_performances WHERE reminder_id = ?",
          candidate.id,
        )
        .toArray()
        .map((row) => row.performanceId),
    );
    if (!input.performanceIds.some((id) => performances.has(id))) return;
  }
  storage.transactionSync(() => {
    skipReminder(storage, candidate.id, "payment_completed", new Date().toISOString());
    // A receipt may arrive after sending; revoke recovery even when history correctly remains sent.
    storage.sql.exec(
      "UPDATE checkout_reminders SET nonce = ? WHERE id = ?",
      crypto.randomUUID(),
      candidate.id,
    );
  });
}

export function releaseCheckoutReminderClaim(storage: ContactStoreStorage, id: string) {
  storage.sql.exec(
    "UPDATE checkout_reminder_recipients SET claim_id = NULL WHERE id = (SELECT recipient_id FROM checkout_reminders WHERE id = ?) AND claim_id = ?",
    id,
    id,
  );
}
