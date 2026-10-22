import type { ContactStoreStorage } from "../contactStore/contracts";

// Called inside the profile deletion transaction. The IN subqueries materialize the
// Organization-local contact IDs once, including secondary Contacts, without an
// application loop scanning growing history tables for every linked Contact.
const linkedContactIds = "SELECT id FROM contacts WHERE profile_id = ?";

export function rosterContactDeletionBlocker(
  storage: Pick<ContactStoreStorage, "sql">,
  profileId: string,
): string | null {
  const checks = [
    {
      sql: `SELECT 1 FROM contacts WHERE profile_id = ? AND
        (source IS NULL OR source <> 'roster' OR
         COALESCE(first_name, '') <> '' OR COALESCE(last_name, '') <> '' OR
         COALESCE(phone, '') <> '') LIMIT 1`,
      reason: "It is linked to an independently maintained Contact.",
    },
    {
      sql: `SELECT 1 FROM contact_communication_preferences
        WHERE contact_id IN (${linkedContactIds}) AND
          (status <> 'unknown' OR source IS NULL OR source <> 'roster') LIMIT 1`,
      reason: "A linked Contact has communication consent or unsubscribe preferences.",
    },
    {
      sql: `SELECT 1 FROM contact_list_memberships
        WHERE contact_id IN (${linkedContactIds}) LIMIT 1`,
      reason: "A linked Contact belongs to a contact list.",
    },
    {
      sql: `SELECT 1 FROM ticket_purchases WHERE contact_id IN (${linkedContactIds}) LIMIT 1`,
      reason: "A linked Contact has ticket purchase records.",
    },
    {
      sql: `SELECT 1 FROM donations WHERE contact_id IN (${linkedContactIds}) LIMIT 1`,
      reason: "A linked Contact has donation records.",
    },
    {
      sql: `SELECT 1 FROM communication_deliveries
        WHERE profile_id IN (${linkedContactIds}) LIMIT 1`,
      reason: "A linked Contact has queued messages or message delivery history.",
    },
    {
      sql: `SELECT 1 FROM contact_import_rows
        WHERE contact_id IN (${linkedContactIds}) LIMIT 1`,
      reason: "A linked Contact has contact-import history.",
    },
  ] as const;
  for (const check of checks) {
    if (storage.sql.exec(check.sql, profileId).toArray().length > 0) return check.reason;
  }
  return null;
}
