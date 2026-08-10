import { z } from "zod";

import {
  MAX_BACKFILL_ORGANIZATIONS,
  providerRouteBackfillResponseSchema,
  type EmailProviderRouteInput,
  type EmailProviderRouteRow,
} from "./contracts";
import { normalizedEmail, routeMatchesInput } from "./parser";

async function readRoute(
  database: D1Database,
  input: EmailProviderRouteInput,
): Promise<EmailProviderRouteRow | null> {
  return database
    .prepare(
      `SELECT id, organization_id AS organizationId, source_kind AS sourceKind,
        source_id AS sourceId, destination, provider_message_id AS providerMessageId, state
       FROM email_provider_routes
       WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
       LIMIT 1`,
    )
    .bind(input.sourceKind, input.sourceId)
    .first<EmailProviderRouteRow>();
}

export async function prepareEmailProviderRoute(
  database: D1Database,
  input: EmailProviderRouteInput,
): Promise<{ readonly alreadyAccepted: boolean; readonly providerMessageId: string | null }> {
  const existing = await readRoute(database, input);
  if (existing) {
    if (!routeMatchesInput(existing, input)) {
      throw new Error("The email source route is already reserved for another recipient.");
    }
    if (existing.providerMessageId) {
      return { alreadyAccepted: true, providerMessageId: existing.providerMessageId };
    }
    throw new Error("The email send outcome is still unknown; refusing a duplicate send.");
  }
  const now = new Date().toISOString();
  try {
    await database
      .prepare(
        `INSERT INTO email_provider_routes
          (id, provider, source_kind, source_id, organization_id, destination, state, created_at, updated_at)
         VALUES (?, 'cloudflare_email', ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.sourceKind,
        input.sourceId,
        input.organizationId ?? null,
        normalizedEmail(input.destination),
        now,
        now,
      )
      .run();
  } catch {
    const raced = await readRoute(database, input);
    if (raced?.providerMessageId) {
      return { alreadyAccepted: true, providerMessageId: raced.providerMessageId };
    }
    throw new Error("The email send route could not be reserved.");
  }
  return { alreadyAccepted: false, providerMessageId: null };
}

export async function attachEmailProviderMessage(
  database: D1Database,
  input: EmailProviderRouteInput,
  providerMessageId: string,
): Promise<void> {
  const normalizedProviderMessageId = z
    .string()
    .trim()
    .min(1)
    .max(512)
    .safeParse(providerMessageId);
  if (!normalizedProviderMessageId.success) {
    throw new Error("The accepted email provider message ID was invalid.");
  }
  const existing = await readRoute(database, input);
  if (!existing) throw new Error("The email provider route was not reserved.");
  if (!routeMatchesInput(existing, input)) {
    throw new Error("The email source route belongs to another recipient.");
  }
  if (existing.providerMessageId) {
    if (existing.providerMessageId === normalizedProviderMessageId.data) return;
    throw new Error("The email provider route already has another provider message ID.");
  }
  const result = await database
    .prepare(
      `UPDATE email_provider_routes
       SET provider_message_id = ?, state = 'accepted', accepted_at = ?, updated_at = ?
       WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
         AND provider_message_id IS NULL`,
    )
    .bind(
      normalizedProviderMessageId.data,
      new Date().toISOString(),
      new Date().toISOString(),
      input.sourceKind,
      input.sourceId,
    )
    .run();
  if (result.meta.changes === 1) return;
  const current = await readRoute(database, input);
  if (current && !routeMatchesInput(current, input)) {
    throw new Error("The email source route belongs to another recipient.");
  }
  if (current?.providerMessageId === normalizedProviderMessageId.data) return;
  throw new Error("The accepted email provider message could not be attached to its route.");
}

export async function markEmailProviderRouteUnknown(
  database: D1Database,
  input: EmailProviderRouteInput,
): Promise<void> {
  const existing = await readRoute(database, input);
  if (!existing || !routeMatchesInput(existing, input)) return;
  await database
    .prepare(
      `UPDATE email_provider_routes SET state = 'unknown', updated_at = ?
       WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
         AND provider_message_id IS NULL`,
    )
    .bind(new Date().toISOString(), input.sourceKind, input.sourceId)
    .run();
}

export async function isEmailProviderSuppressed(
  database: D1Database,
  destination: string,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT active FROM email_recipient_suppressions
       WHERE email_normalized = ? LIMIT 1`,
    )
    .bind(normalizedEmail(destination))
    .first<{ readonly active: number }>();
  return row?.active === 1;
}

export const emailRecipientSuppressedCode = "email_recipient_suppressed" as const;
export const emailRecipientSuppressedMessage =
  "This email address is on the application-wide email suppression list. Contact a Platform Administrator to review the suppression.";

export class EmailRecipientSuppressedError extends Error {
  readonly code = emailRecipientSuppressedCode;
  readonly status = 409 as const;

  constructor() {
    super(emailRecipientSuppressedMessage);
    this.name = "EmailRecipientSuppressedError";
  }
}

export async function assertEmailProviderRecipientAvailable(
  database: D1Database,
  destination: string,
): Promise<void> {
  if (await isEmailProviderSuppressed(database, destination)) {
    throw new EmailRecipientSuppressedError();
  }
}

export async function assertEmailProviderRecipientsAvailable(
  database: D1Database,
  destinations: readonly string[],
): Promise<void> {
  const uniqueDestinations = new Set(destinations.map(normalizedEmail).filter(Boolean));
  for (const destination of uniqueDestinations) {
    await assertEmailProviderRecipientAvailable(database, destination);
  }
}

// eslint-disable-next-line complexity -- paginates the bounded Organization route backfill and preserves its cursor.
export async function backfillEmailProviderRoutes(
  database: D1Database,
  readOrganizationRoutes: (organizationId: string, offset: number) => Promise<Response>,
): Promise<void> {
  const backfill = await database
    .prepare(
      `SELECT completed_at AS completedAt, cursor_organization_id AS cursorOrganizationId
       FROM email_provider_route_backfill WHERE id = 1 LIMIT 1`,
    )
    .first<{
      readonly completedAt: string | null;
      readonly cursorOrganizationId: string | null;
    }>();
  if (backfill?.completedAt) return;

  const organizations = await database
    .prepare(
      `SELECT id AS organizationId FROM organizations
       WHERE lifecycle_state <> 'provisioning'
         AND (? IS NULL OR id > ?)
       ORDER BY id LIMIT ?`,
    )
    .bind(
      backfill?.cursorOrganizationId ?? null,
      backfill?.cursorOrganizationId ?? null,
      MAX_BACKFILL_ORGANIZATIONS,
    )
    .all<{ readonly organizationId: string }>();
  for (const organization of organizations.results) {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const response = await readOrganizationRoutes(organization.organizationId, offset);
      if (!response.ok) throw new Error("The organization provider route backfill was rejected.");
      const parsed = providerRouteBackfillResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success) throw new Error("The organization provider route backfill was invalid.");
      const now = new Date().toISOString();
      for (const route of parsed.data.routes) {
        const destination = normalizedEmail(route.destination);
        await database
          .prepare(
            `UPDATE email_provider_routes
             SET provider_message_id = ?, state = 'accepted', accepted_at = COALESCE(accepted_at, ?), updated_at = ?
             WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
               AND provider_message_id IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM email_provider_routes AS existing
                 WHERE existing.provider = 'cloudflare_email'
                   AND existing.provider_message_id = ?
               )`,
          )
          .bind(
            route.providerMessageId,
            now,
            now,
            route.sourceKind,
            route.sourceId,
            route.providerMessageId,
          )
          .run();
        await database
          .prepare(
            `INSERT OR IGNORE INTO email_provider_routes
              (id, provider, source_kind, source_id, organization_id, destination,
               provider_message_id, state, created_at, accepted_at, updated_at)
             VALUES (?, 'cloudflare_email', ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            route.sourceKind,
            route.sourceId,
            organization.organizationId,
            destination,
            route.providerMessageId,
            now,
            now,
            now,
          )
          .run();
      }
      hasMore = parsed.data.nextOffset !== null;
      if (parsed.data.nextOffset !== null) offset = parsed.data.nextOffset;
    }
  }
  const lastOrganizationId = organizations.results.at(-1)?.organizationId ?? null;
  if (organizations.results.length < MAX_BACKFILL_ORGANIZATIONS) {
    await database
      .prepare(
        `UPDATE email_provider_route_backfill
         SET cursor_organization_id = ?, completed_at = ? WHERE id = 1`,
      )
      .bind(lastOrganizationId, new Date().toISOString())
      .run();
  } else {
    await database
      .prepare(
        `UPDATE email_provider_route_backfill
         SET cursor_organization_id = ?, completed_at = NULL WHERE id = 1`,
      )
      .bind(lastOrganizationId)
      .run();
  }
}
