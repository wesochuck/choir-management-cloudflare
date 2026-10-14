import type { SqlStorageValue } from "@cloudflare/workers-types";

import { unsubscribeContactOperationSchema, unsubscribeOperationSchema } from "./contracts";
import { identityMatches } from "./shared";

export async function unsubscribeCommunicationProfileInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = unsubscribeOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_unsubscribe_request" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const profile = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM profiles WHERE id = ? LIMIT 1",
      operation.profileId,
    )
    .toArray()
    .at(0);
  if (!profile) return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE profiles SET do_not_email = 1, updated_at = ? WHERE id = ?",
      now,
      operation.profileId,
    );
    storage.sql.exec(
      `INSERT INTO communication_suppressions
        (id, profile_id, channel, reason, active, created_at, updated_at)
       VALUES (?, ?, 'email', 'user_unsubscribe', 1, ?, ?)
       ON CONFLICT(profile_id, channel) DO UPDATE SET
         reason = 'user_unsubscribe', active = 1, updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      operation.profileId,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
        request_id, change_summary, occurred_at)
       VALUES (?, 'public_link', ?, 'organization.communication.unsubscribed',
        'profile', ?, ?, ?, ?)`,
      `communication-unsubscribe:${operation.requestId}`,
      operation.profileId,
      operation.profileId,
      operation.requestId,
      JSON.stringify({ channel: "email" }),
      now,
    );
  });
  return Response.json({ success: true });
}

/**
 * Phase 7 contact-aware unsubscribe.
 *
 * Never touches `profiles` or `communication_suppressions` (those rows are
 * keyed by profile ID; writing a contact ID there would be the fake-ID
 * bolt-on the plan forbids). The contact's own email preference row is the
 * suppression record: `unsubscribed` blocks every future marketing email in
 * audience resolution and in the pre-delivery suppression recheck,
 * regardless of list membership. Lists, commerce history, and linked
 * profiles are left untouched.
 */
export async function unsubscribeCommunicationContactInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = unsubscribeContactOperationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ code: "invalid_unsubscribe_request" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const contact = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM contacts WHERE id = ? LIMIT 1",
      operation.contactId,
    )
    .toArray()
    .at(0);
  if (!contact) return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO contact_communication_preferences
        (contact_id, channel, status, source, observed_at, updated_at)
       VALUES (?, 'email', 'unsubscribed', 'user_unsubscribe', ?, ?)
       ON CONFLICT(contact_id, channel) DO UPDATE SET
         status = 'unsubscribed',
         source = CASE
           WHEN contact_communication_preferences.source IS NULL
             OR contact_communication_preferences.source = ''
           THEN 'user_unsubscribe'
           ELSE contact_communication_preferences.source
         END,
         observed_at = CASE WHEN contact_communication_preferences.status != 'unsubscribed'
           THEN excluded.observed_at ELSE contact_communication_preferences.observed_at END,
         updated_at = excluded.updated_at`,
      operation.contactId,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
        request_id, change_summary, occurred_at)
       VALUES (?, 'public_link', ?, 'organization.communication.contact.unsubscribed',
        'contact', ?, ?, ?, ?)`,
      `communication-contact-unsubscribe:${operation.requestId}`,
      operation.contactId,
      operation.contactId,
      operation.requestId,
      JSON.stringify({ channel: "email" }),
      now,
    );
  });
  return Response.json({ success: true });
}
