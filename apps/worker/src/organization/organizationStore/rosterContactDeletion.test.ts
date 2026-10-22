import { afterEach, describe, expect, it } from "vitest";
import { createContactInStore } from "../contactStore/contacts";
import { createFreshContactContext, seedProfile, uuidFor } from "../contactTestkit";
import { rosterContactDeletionBlocker } from "./rosterContactDeletion";

const contexts: ReturnType<typeof createFreshContactContext>[] = [];
afterEach(() => {
  for (const context of contexts.splice(0)) context.db.close();
});
function fixture() {
  const context = createFreshContactContext("org-roster-delete");
  contexts.push(context);
  const profileId = uuidFor(1);
  const contactId = uuidFor(2);
  seedProfile(context.db, profileId, "Roster Person");
  createContactInStore(context.storage, {
    organizationId: "org-roster-delete",
    actorUserId: "manager",
    requestId: uuidFor(3),
    contactId,
    profileId,
    displayName: "Roster Person",
    email: "roster@example.test",
    source: "roster",
  });
  context.db.exec(
    "INSERT INTO contact_lists (id, name, created_at, updated_at) VALUES ('list', 'List', 'now', 'now')",
  );
  context.db.exec(
    "INSERT INTO contact_imports (id, status, idempotency_key, created_at, updated_at) VALUES ('import', 'completed', 'import', 'now', 'now')",
  );
  return { ...context, profileId, contactId };
}

describe("roster-email Contact deletion eligibility on migrated SQLite", () => {
  it("allows only unused roster Contacts, including cleared emails and secondary Contacts", () => {
    const { db, storage, profileId, contactId } = fixture();
    expect(rosterContactDeletionBlocker(storage, profileId)).toBeNull();
    db.prepare("UPDATE contacts SET email = NULL, normalized_email = NULL WHERE id = ?").run(
      contactId,
    );
    expect(rosterContactDeletionBlocker(storage, profileId)).toBeNull();
    db.prepare(
      "INSERT INTO contacts (id, profile_id, source, created_at, updated_at) VALUES (?, ?, 'manual', 'now', 'now')",
    ).run(uuidFor(4), profileId);
    expect(rosterContactDeletionBlocker(storage, profileId)).toContain("independently maintained");
  });
  it.each([
    ["UPDATE contacts SET source = NULL WHERE id = ?", "independently maintained"],
    ["UPDATE contacts SET source = 'import' WHERE id = ?", "independently maintained"],
    ["UPDATE contacts SET phone = '+12025550123' WHERE id = ?", "independently maintained"],
    ["UPDATE contacts SET first_name = 'Independent' WHERE id = ?", "independently maintained"],
    [
      "UPDATE contact_communication_preferences SET status = 'subscribed' WHERE contact_id = ?",
      "consent",
    ],
    [
      "UPDATE contact_communication_preferences SET status = 'unsubscribed' WHERE contact_id = ?",
      "consent",
    ],
    [
      "UPDATE contact_communication_preferences SET source = 'manual' WHERE contact_id = ?",
      "consent",
    ],
    [
      "INSERT INTO contact_list_memberships (contact_id, list_id, created_at) VALUES (?, 'list', 'now')",
      "contact list",
    ],
    [
      "INSERT INTO contact_import_rows (contact_id, import_id, row_index, row_number) VALUES (?, 'import', 0, 2)",
      "contact-import",
    ],
    [
      "INSERT INTO communication_deliveries (profile_id, id, message_id, recipient_name, channel, destination, status, created_at, updated_at) VALUES (?, 'delivery', 'message', 'Person', 'email', 'roster@example.test', 'queued', 'now', 'now')",
      "queued messages",
    ],
    [
      "INSERT INTO donations (contact_id, id, checkout_request_id, status, amount_cents, buyer_name, buyer_email, provider_session_id, created_at, updated_at) VALUES (?, 'donation', 'checkout', 'paid', 100, 'Person', 'person@example.test', 'session', 'now', 'now')",
      "donation",
    ],
    [
      "INSERT INTO ticket_purchases (contact_id, id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone, buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents, provider_session_id, status, created_at, updated_at) VALUES (?, 'ticket', 'checkout', 'event', 'Event', 'now', 'UTC', 'Person', 'person@example.test', 1, 100, 0, 100, 'session', 'paid', 'now', 'now')",
      "ticket purchase",
    ],
  ])("blocks protected Contact data: %s", (sql, reason) => {
    const { db, storage, profileId, contactId } = fixture();
    db.prepare(sql).run(contactId);
    expect(rosterContactDeletionBlocker(storage, profileId)).toContain(reason);
    // References on another Profile do not block an unused roster Contact.
    db.prepare("UPDATE contacts SET profile_id = ? WHERE id = ?").run(uuidFor(99), contactId);
    expect(rosterContactDeletionBlocker(storage, profileId)).toBeNull();
  });
});
