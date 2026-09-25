import { recordDatabaseCost } from "../observability/databaseCost";
import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import type { Env } from "../env";

import { buildEmailChangeConfirmationEmail, buildEmailChangeNoticeEmail } from "./emailTemplates";
import { sendPlatformEmail } from "./platformEmail";

const EMAIL_CHANGE_EXPIRY_MS = 30 * 60 * 1000;
const EMAIL_CHANGE_NOTIFICATION_LIMIT = 20;
const EMAIL_CHANGE_NOTIFICATION_STALE_MS = 5 * 60 * 1000;

type EmailChangeNotificationPhase =
  "confirmed_new" | "confirmed_old" | "requested_new" | "requested_old";

type EmailChangeErrorCode =
  "email_change_unavailable" | "email_in_use" | "email_unchanged" | "invalid_email_change";

type EmailChangeErrorStatus = 400 | 409 | 503;

export class EmailChangeError extends Error {
  readonly code: EmailChangeErrorCode;
  readonly status: EmailChangeErrorStatus;

  constructor(code: EmailChangeErrorCode, status: EmailChangeErrorStatus, message: string) {
    super(message);
    this.name = "EmailChangeError";
    this.code = code;
    this.status = status;
  }
}

export type EmailChangeEnvironment = Pick<
  Env,
  | "BETTER_AUTH_SECRET"
  | "CONTROL_DB"
  | "PLATFORM_EMAIL"
  | "PLATFORM_EMAIL_ALLOWED_RECIPIENTS"
  | "PLATFORM_EMAIL_FROM"
  | "PLATFORM_EMAIL_MODE"
> & {
  readonly APP_ENV?: string | undefined;
};

interface EmailChangeRequestRow {
  readonly confirmationOrigin: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly id: string;
  readonly newEmail: string;
  readonly oldEmail: string;
  readonly organizationId: string;
  readonly status: "confirmed" | "expired" | "pending" | "superseded";
  readonly tokenFingerprint: string;
  readonly userId: string;
}

interface EmailChangeNotificationRow extends EmailChangeRequestRow {
  readonly attempts: number;
  readonly notificationId: string;
  readonly phase: EmailChangeNotificationPhase;
  readonly recipient: string;
}

interface UserEmailRow {
  readonly email: string;
}

interface ExistingRequestRow {
  readonly id: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function safeErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function tokenFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function confirmationUrl(
  env: Pick<Env, "BETTER_AUTH_SECRET">,
  request: Pick<
    EmailChangeRequestRow,
    "confirmationOrigin" | "expiresAt" | "id" | "organizationId" | "userId"
  > & { readonly createdAt: number },
): Promise<string> {
  const token = await issueSignedLink(env.BETTER_AUTH_SECRET, {
    algorithm: "HS256",
    expiresAt: Math.floor(request.expiresAt / 1000),
    issuedAt: Math.floor(request.createdAt / 1000),
    organizationId: request.organizationId,
    purpose: "email_change",
    resourceId: request.id,
    revocation: "email-change-v1",
    subjectId: request.userId,
    version: 1,
  });
  const url = new URL("/confirm-email-change", request.confirmationOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function readEmailChangeRequest(
  database: D1Database,
  requestId: string,
  organizationId: string,
  userId: string,
  fingerprint: string,
): Promise<EmailChangeRequestRow | null> {
  return database
    .prepare(
      `SELECT confirmation_origin AS confirmationOrigin, created_at AS createdAt,
        expires_at AS expiresAt, id, new_email AS newEmail, old_email AS oldEmail,
        organization_id AS organizationId, status, token_fingerprint AS tokenFingerprint,
        user_id AS userId
       FROM email_change_requests
       WHERE id = ? AND organization_id = ? AND user_id = ? AND token_fingerprint = ?
       LIMIT 1`,
    )
    .bind(requestId, organizationId, userId, fingerprint)
    .first<EmailChangeRequestRow>();
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(15 * 60 * 1000, 30 * 1000 * 2 ** Math.min(attempt, 5));
  const jitter = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return base + (jitter % 5_000);
}

function notificationEmail(
  request: EmailChangeNotificationRow,
  confirmationLink: string | null,
): {
  readonly html?: string;
  readonly kind: "email-change-confirmation" | "email-change-notice";
  readonly subject: string;
  readonly text: string;
} {
  if (request.phase === "requested_new") {
    if (!confirmationLink) throw new Error("The email change confirmation link is missing.");
    const content = buildEmailChangeConfirmationEmail(confirmationLink, request.newEmail);
    return { ...content, kind: "email-change-confirmation" };
  }
  const content = buildEmailChangeNoticeEmail(
    request.newEmail,
    request.phase === "confirmed_old" || request.phase === "confirmed_new"
      ? "confirmed"
      : "requested",
  );
  return { ...content, kind: "email-change-notice" };
}

async function listPendingNotifications(
  database: D1Database,
  requestId: string | null,
  now: number,
): Promise<readonly EmailChangeNotificationRow[]> {
  const statement = database.prepare(
    `SELECT n.attempts, n.id AS notificationId, n.phase, n.recipient,
       r.confirmation_origin AS confirmationOrigin, r.created_at AS createdAt,
       r.expires_at AS expiresAt, r.id, r.new_email AS newEmail, r.old_email AS oldEmail,
       r.organization_id AS organizationId, r.status,
       r.token_fingerprint AS tokenFingerprint, r.user_id AS userId
     FROM email_change_notifications n
     JOIN email_change_requests r ON r.id = n.email_change_request_id
     WHERE ${requestId ? "n.email_change_request_id = ? AND" : ""}
       (
         n.state IN ('queued', 'failed')
         OR (n.state = 'sending' AND n.updated_at <= ?)
       )
       AND (
         n.phase IN ('requested_old', 'requested_new')
         AND r.status IN ('pending', 'confirmed')
         OR n.phase IN ('confirmed_old', 'confirmed_new')
         AND r.status = 'confirmed'
       )
       AND n.next_attempt_at <= ?
     ORDER BY n.created_at ASC, n.id ASC
     LIMIT ?`,
  );
  const bindings = requestId
    ? [requestId, now - EMAIL_CHANGE_NOTIFICATION_STALE_MS, now, EMAIL_CHANGE_NOTIFICATION_LIMIT]
    : [now - EMAIL_CHANGE_NOTIFICATION_STALE_MS, now, EMAIL_CHANGE_NOTIFICATION_LIMIT];
  return statement
    .bind(...bindings)
    .all<EmailChangeNotificationRow>()
    .then(({ results }) => results);
}

async function deliverNotification(
  env: EmailChangeEnvironment,
  notification: EmailChangeNotificationRow,
  now: number,
): Promise<void> {
  const claimed = await env.CONTROL_DB.prepare(
    `UPDATE email_change_notifications
     SET attempts = attempts + 1, state = 'sending', updated_at = ?
     WHERE id = ? AND (
       state IN ('queued', 'failed')
       OR (state = 'sending' AND updated_at <= ?)
     )`,
  )
    .bind(now, notification.notificationId, now - EMAIL_CHANGE_NOTIFICATION_STALE_MS)
    .run();
  if (claimed.meta.changes !== 1) return;

  try {
    const link =
      notification.phase === "requested_new" ? await confirmationUrl(env, notification) : null;
    const message = notificationEmail(notification, link);
    await sendPlatformEmail(env, {
      ...(message.html ? { html: message.html } : {}),
      kind: message.kind,
      organizationId: notification.organizationId,
      recipient: notification.recipient,
      sourceId: `email-change:${notification.notificationId}`,
      subject: message.subject,
      text: message.text,
    });
    await env.CONTROL_DB.prepare(
      `UPDATE email_change_notifications
       SET sent_at = ?, state = 'sent', updated_at = ?, last_error = ''
       WHERE id = ? AND state = 'sending'`,
    )
      .bind(now, now, notification.notificationId)
      .run();
  } catch (error: unknown) {
    const errorType = safeErrorType(error);
    const nextAttemptAt = now + retryDelayMs(notification.attempts + 1);
    await env.CONTROL_DB.prepare(
      `UPDATE email_change_notifications
       SET last_error = ?, next_attempt_at = ?, state = 'failed', updated_at = ?
       WHERE id = ? AND state = 'sending'`,
    )
      .bind(errorType, nextAttemptAt, now, notification.notificationId)
      .run();
    console.error(
      JSON.stringify({
        errorType,
        event: "email_change_notification_failed",
        notificationId: notification.notificationId,
        requestId: notification.id,
      }),
    );
  }
}

async function deliverEmailChangeNotifications(
  env: EmailChangeEnvironment,
  requestId: string | null = null,
): Promise<void> {
  const now = Date.now();
  const notifications = await listPendingNotifications(env.CONTROL_DB, requestId, now);
  if (notifications.length === 0) return;
  await Promise.allSettled(
    notifications.map((notification) => deliverNotification(env, notification, now)),
  );
}

export async function reconcileEmailChangeNotifications(
  env: EmailChangeEnvironment,
): Promise<void> {
  const now = Date.now();
  const results = await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `UPDATE email_change_notifications
       SET state = 'canceled', updated_at = ?
       WHERE state IN ('queued', 'failed')
         AND email_change_request_id IN (
           SELECT id
           FROM email_change_requests
           WHERE status = 'pending' AND expires_at <= ?
         )`,
    ).bind(now, now),
    env.CONTROL_DB.prepare(
      `UPDATE email_change_requests
       SET status = 'expired', updated_at = ?
       WHERE status = 'pending' AND expires_at <= ?`,
    ).bind(now, now),
  ]);
  const rowsRead = results.reduce((sum, r) => sum + r.meta.rows_read, 0);
  const rowsWritten = results.reduce((sum, r) => sum + r.meta.rows_written, 0);
  recordDatabaseCost({
    environment: env.APP_ENV,
    operation: "d1.email_change.reconcile",
    rowsRead,
    rowsWritten,
    store: "d1",
  });
  await deliverEmailChangeNotifications(env);
}

export async function beginEmailChange(
  env: EmailChangeEnvironment,
  input: {
    readonly confirmationOrigin: string;
    readonly httpRequestId: string;
    readonly newEmail: string;
    readonly organizationId: string;
    readonly userId: string;
  },
): Promise<{ readonly email: string; readonly requestId: string }> {
  const newEmail = normalizeEmail(input.newEmail);
  const current = await env.CONTROL_DB.prepare("SELECT email FROM user WHERE id = ? LIMIT 1")
    .bind(input.userId)
    .first<UserEmailRow>();
  if (!current) {
    throw new EmailChangeError(
      "email_change_unavailable",
      503,
      "The account email could not be loaded.",
    );
  }
  const oldEmail = current.email.trim();
  if (normalizeEmail(oldEmail) === newEmail) {
    throw new EmailChangeError(
      "email_unchanged",
      409,
      "Choose a different email address before requesting a change.",
    );
  }
  const existingUser = await env.CONTROL_DB.prepare(
    "SELECT id FROM user WHERE lower(email) = ? AND id <> ? LIMIT 1",
  )
    .bind(newEmail, input.userId)
    .first<{ readonly id: string }>();
  if (existingUser) {
    throw new EmailChangeError(
      "email_in_use",
      409,
      "That email address is already in use by another account.",
    );
  }

  const pending = await env.CONTROL_DB.prepare(
    "SELECT id FROM email_change_requests WHERE user_id = ? AND status = 'pending'",
  )
    .bind(input.userId)
    .all<ExistingRequestRow>();
  const now = Date.now();
  const requestId = crypto.randomUUID();
  const expiresAt = now + EMAIL_CHANGE_EXPIRY_MS;
  const token = await issueSignedLink(env.BETTER_AUTH_SECRET, {
    algorithm: "HS256",
    expiresAt: Math.floor(expiresAt / 1000),
    issuedAt: Math.floor(now / 1000),
    organizationId: input.organizationId,
    purpose: "email_change",
    resourceId: requestId,
    revocation: "email-change-v1",
    subjectId: input.userId,
    version: 1,
  });
  const fingerprint = await tokenFingerprint(token);
  const oldNotificationId = crypto.randomUUID();
  const newNotificationId = crypto.randomUUID();
  const auditId = `email-change-request:${requestId}`;
  const notificationBindings = [
    [oldNotificationId, "requested_old", oldEmail],
    [newNotificationId, "requested_new", newEmail],
  ] as const;

  try {
    await env.CONTROL_DB.batch([
      ...pending.results.flatMap(({ id }) => [
        env.CONTROL_DB.prepare(
          "UPDATE email_change_requests SET status = 'superseded', updated_at = ? WHERE id = ? AND status = 'pending'",
        ).bind(now, id),
        env.CONTROL_DB.prepare(
          "UPDATE email_change_notifications SET state = 'canceled', updated_at = ? WHERE email_change_request_id = ? AND state IN ('queued', 'failed')",
        ).bind(now, id),
      ]),
      env.CONTROL_DB.prepare(
        `INSERT INTO email_change_requests
          (id, organization_id, user_id, request_id, old_email, new_email,
           confirmation_origin, token_fingerprint, issued_at, expires_at, status,
           confirmed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      ).bind(
        requestId,
        input.organizationId,
        input.userId,
        input.httpRequestId,
        oldEmail,
        newEmail,
        input.confirmationOrigin,
        fingerprint,
        now,
        expiresAt,
        now,
        now,
      ),
      ...notificationBindings.map(([id, phase, recipient]) =>
        env.CONTROL_DB.prepare(
          `INSERT INTO email_change_notifications
            (id, email_change_request_id, phase, recipient, state, attempts,
             next_attempt_at, last_error, created_at, sent_at, updated_at)
           VALUES (?, ?, ?, ?, 'queued', 0, ?, '', ?, NULL, ?)`,
        ).bind(id, requestId, phase, recipient, now, now, now),
      ),
      env.CONTROL_DB.prepare(
        `INSERT OR IGNORE INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'member.email_change_requested', 'user', ?, ?, ?, ?)`,
      ).bind(
        auditId,
        input.userId,
        input.organizationId,
        input.userId,
        input.httpRequestId,
        '{"status":"pending"}',
        new Date(now).toISOString(),
      ),
    ]);
  } catch (error: unknown) {
    const errorType = safeErrorType(error);
    console.error(
      JSON.stringify({
        errorType,
        event: "email_change_request_persist_failed",
        organizationId: input.organizationId,
        requestId: input.httpRequestId,
      }),
    );
    throw new EmailChangeError(
      "email_change_unavailable",
      503,
      "The email change could not be started. Try again shortly.",
    );
  }

  await deliverEmailChangeNotifications(env, requestId);
  return { email: newEmail, requestId: input.httpRequestId };
}

// eslint-disable-next-line complexity -- confirmation coordinates token scope, identity update, audit, and notifications.
export async function confirmEmailChange(
  env: EmailChangeEnvironment,
  input: {
    readonly httpRequestId: string;
    readonly organizationId: string;
    readonly token: string;
  },
): Promise<{ readonly email: string; readonly requestId: string }> {
  const envelope = await verifySignedLinkScope(env.BETTER_AUTH_SECRET, input.token, {
    expectedOrganizationId: input.organizationId,
    expectedPurpose: "email_change",
  });
  const requestId = envelope?.resourceId;
  const userId = envelope?.subjectId;
  if (!envelope || !requestId || !userId) {
    throw new EmailChangeError(
      "invalid_email_change",
      400,
      "This email change link is invalid, expired, or has already been used.",
    );
  }

  const fingerprint = await tokenFingerprint(input.token);
  const request = await readEmailChangeRequest(
    env.CONTROL_DB,
    requestId,
    input.organizationId,
    userId,
    fingerprint,
  );
  const now = Date.now();
  if (
    request?.status !== "pending" ||
    request.expiresAt <= now ||
    Math.floor(request.createdAt / 1000) !== envelope.issuedAt ||
    Math.floor(request.expiresAt / 1000) !== envelope.expiresAt
  ) {
    if (request?.status === "pending" && request.expiresAt <= now) {
      await env.CONTROL_DB.prepare(
        "UPDATE email_change_requests SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'",
      )
        .bind(now, request.id)
        .run();
    }
    throw new EmailChangeError(
      "invalid_email_change",
      400,
      "This email change link is invalid, expired, or has already been used.",
    );
  }

  const membership = await env.CONTROL_DB.prepare(
    "SELECT 1 AS active FROM member WHERE organizationId = ? AND userId = ? LIMIT 1",
  )
    .bind(input.organizationId, request.userId)
    .first<{ readonly active: number }>();
  if (!membership) {
    throw new EmailChangeError(
      "invalid_email_change",
      400,
      "This email change link is invalid, expired, or has already been used.",
    );
  }

  const conflict = await env.CONTROL_DB.prepare(
    "SELECT id FROM user WHERE lower(email) = ? AND id <> ? LIMIT 1",
  )
    .bind(request.newEmail, request.userId)
    .first<{ readonly id: string }>();
  if (conflict) {
    throw new EmailChangeError(
      "email_in_use",
      409,
      "That email address is now in use by another account. Request a different address.",
    );
  }

  const confirmedAt = now;
  const auditId = `email-change-confirmed:${request.id}`;
  try {
    const results = await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `UPDATE user
         SET email = ?, emailVerified = 1, updatedAt = ?
         WHERE id = ? AND lower(email) = ?
           AND EXISTS (
             SELECT 1 FROM email_change_requests
             WHERE id = ? AND status = 'pending' AND token_fingerprint = ? AND expires_at > ?
           )`,
      ).bind(
        request.newEmail,
        now,
        request.userId,
        normalizeEmail(request.oldEmail),
        request.id,
        request.tokenFingerprint,
        now,
      ),
      env.CONTROL_DB.prepare(
        `UPDATE email_change_requests
         SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM user WHERE id = ? AND lower(email) = ?
           )`,
      ).bind(confirmedAt, now, request.id, now, request.userId, request.newEmail),
      env.CONTROL_DB.prepare(
        `UPDATE email_change_notifications
         SET state = 'canceled', updated_at = ?
         WHERE email_change_request_id = ? AND state IN ('queued', 'failed')
           AND phase IN ('requested_old', 'requested_new')`,
      ).bind(now, request.id),
      env.CONTROL_DB.prepare(
        `INSERT OR IGNORE INTO email_change_notifications
          (id, email_change_request_id, phase, recipient, state, attempts,
           next_attempt_at, last_error, created_at, sent_at, updated_at)
         SELECT ?, id, 'confirmed_old', old_email, 'queued', 0, ?, '', ?, NULL, ?
         FROM email_change_requests
         WHERE id = ? AND status = 'confirmed' AND confirmed_at = ?`,
      ).bind(crypto.randomUUID(), now, now, now, request.id, confirmedAt),
      env.CONTROL_DB.prepare(
        `INSERT OR IGNORE INTO email_change_notifications
          (id, email_change_request_id, phase, recipient, state, attempts,
           next_attempt_at, last_error, created_at, sent_at, updated_at)
         SELECT ?, id, 'confirmed_new', new_email, 'queued', 0, ?, '', ?, NULL, ?
         FROM email_change_requests
         WHERE id = ? AND status = 'confirmed' AND confirmed_at = ?`,
      ).bind(crypto.randomUUID(), now, now, now, request.id, confirmedAt),
      env.CONTROL_DB.prepare(
        `INSERT OR IGNORE INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         SELECT ?, user_id, organization_id, 'member.email_changed', 'user', user_id,
           ?, '{"status":"confirmed"}', ?
         FROM email_change_requests
         WHERE id = ? AND status = 'confirmed' AND confirmed_at = ?`,
      ).bind(auditId, input.httpRequestId, new Date(now).toISOString(), request.id, confirmedAt),
    ]);
    if (results[1]?.meta.changes !== 1) {
      throw new EmailChangeError(
        "invalid_email_change",
        400,
        "This email change link is invalid, expired, or has already been used.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof EmailChangeError) throw error;
    const currentConflict = await env.CONTROL_DB.prepare(
      "SELECT id FROM user WHERE lower(email) = ? AND id <> ? LIMIT 1",
    )
      .bind(request.newEmail, request.userId)
      .first<{ readonly id: string }>();
    if (currentConflict) {
      throw new EmailChangeError(
        "email_in_use",
        409,
        "That email address is now in use by another account. Request a different address.",
      );
    }
    const errorType = safeErrorType(error);
    console.error(
      JSON.stringify({
        errorType,
        event: "email_change_confirmation_persist_failed",
        organizationId: input.organizationId,
        requestId: input.httpRequestId,
      }),
    );
    throw new EmailChangeError(
      "email_change_unavailable",
      503,
      "The email change could not be confirmed. Request a new link if needed.",
    );
  }

  await deliverEmailChangeNotifications(env, request.id);
  return { email: request.newEmail, requestId: input.httpRequestId };
}
