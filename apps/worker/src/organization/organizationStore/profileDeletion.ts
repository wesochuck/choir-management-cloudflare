import { deleteContactInStore } from "../contactStore/contacts";
import { rosterContactDeletionBlocker } from "./rosterContactDeletion";
import { organizationIdentity, profileDeleteSchema } from "./storeShared";

class ProfileHistoryDeletionError extends Error {
  readonly code: string;

  constructor(
    message = "This profile can't be permanently deleted. It has music-folder history that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
    code = "profile_folder_history_requires_inactive",
  ) {
    super(message);
    this.name = "ProfileHistoryDeletionError";
    this.code = code;
  }
}

function hasFolderAuditHistory(storage: DurableObjectStorage, profileId: string): boolean {
  return storage.sql
    .exec<{
      readonly action: string;
      readonly changeSummary: string;
    }>(
      `SELECT action, change_summary AS changeSummary FROM audit_events
       WHERE target_type = 'event_roster'
         AND target_id LIKE ?
         AND action IN (
           'event.folder_number.updated', 'event.folder_number.cleared',
           'event.folder_return.marked_returned', 'event.folder_return.marked_outstanding'
         )`,
      `%:${profileId}`,
    )
    .toArray()
    .some((audit) => {
      if (audit.action.startsWith("event.folder_return.")) return true;
      try {
        const summary: unknown = JSON.parse(audit.changeSummary);
        return (
          typeof summary === "object" &&
          summary !== null &&
          (("hasFolderNumber" in summary && summary.hasFolderNumber === true) ||
            ("previousHasFolderNumber" in summary && summary.previousHasFolderNumber === true))
        );
      } catch {
        return false;
      }
    });
}

function assertNoProfileHistoryToPreserve(
  storage: DurableObjectStorage,
  profileId: string,
  contactsMode: "delete_unused" | "keep",
): void {
  const folderHistory = storage.sql
    .exec<{ readonly count: number }>(
      `SELECT COUNT(*) AS count FROM event_rosters
       WHERE profile_id = ? AND (folder_number <> '' OR folder_returned = 1)`,
      profileId,
    )
    .one().count;
  if (folderHistory > 0 || hasFolderAuditHistory(storage, profileId)) {
    throw new ProfileHistoryDeletionError(
      "This profile can't be permanently deleted. It has music-folder history that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      "profile_folder_history_requires_inactive",
    );
  }
  const eventRosterHistory = storage.sql
    .exec<{ readonly count: number }>(
      `SELECT (EXISTS (SELECT 1 FROM event_rosters WHERE profile_id = ?)
          OR EXISTS (SELECT 1 FROM event_rsvp_history WHERE profile_id = ?)) AS count`,
      profileId,
      profileId,
    )
    .one().count;
  if (eventRosterHistory > 0) {
    throw new ProfileHistoryDeletionError(
      "This profile can't be permanently deleted. It has attendance or RSVP history that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      "profile_event_history_requires_inactive",
    );
  }
  const duesHistory = storage.sql
    .exec<{ readonly count: number }>(
      "SELECT COUNT(*) AS count FROM dues WHERE profile_id = ? LIMIT 1",
      profileId,
    )
    .one().count;
  if (duesHistory > 0) {
    throw new ProfileHistoryDeletionError(
      "This profile can't be permanently deleted. It has dues or payment records that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      "profile_dues_history_requires_inactive",
    );
  }
  const pollHistory = storage.sql
    .exec<{ readonly count: number }>(
      "SELECT COUNT(*) AS count FROM poll_responses WHERE profile_id = ? LIMIT 1",
      profileId,
    )
    .one().count;
  if (pollHistory > 0) {
    throw new ProfileHistoryDeletionError(
      "This profile can't be permanently deleted. It has poll responses that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      "profile_poll_history_requires_inactive",
    );
  }
  const reconciliationHistory = storage.sql
    .exec<{ readonly count: number }>(
      "SELECT COUNT(*) AS count FROM profile_reconciliations WHERE source_profile_id = ? OR target_profile_id = ? LIMIT 1",
      profileId,
      profileId,
    )
    .one().count;
  if (reconciliationHistory > 0) {
    throw new ProfileHistoryDeletionError(
      "This profile can't be permanently deleted. It has merge history that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      "profile_reconciliation_history_requires_inactive",
    );
  }
  const deliveryHistory = storage.sql
    .exec<{ readonly count: number }>(
      "SELECT COUNT(*) AS count FROM communication_deliveries WHERE profile_id = ? LIMIT 1",
      profileId,
    )
    .one().count;
  if (deliveryHistory > 0) {
    throw new ProfileHistoryDeletionError(
      "This profile can't be permanently deleted. It has message delivery history that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      "profile_communications_history_requires_inactive",
    );
  }
  const suppressionHistory = storage.sql
    .exec(
      `SELECT 1 FROM communication_suppressions WHERE profile_id = ?
     UNION ALL SELECT 1 FROM profiles WHERE id = ? AND
       (do_not_email = 1 OR provider_email_suppressed = 1 OR
        provider_email_suppressed_at <> '' OR provider_email_suppressed_reason <> '')
     LIMIT 1`,
      profileId,
      profileId,
    )
    .toArray();
  if (suppressionHistory.length > 0) {
    throw new ProfileHistoryDeletionError(
      "This profile can't be permanently deleted. It has communication suppression or unsubscribe records that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      "profile_suppression_history_requires_inactive",
    );
  }
  const contactBlocker =
    contactsMode === "delete_unused" ? rosterContactDeletionBlocker(storage, profileId) : null;
  if (contactBlocker) {
    throw new ProfileHistoryDeletionError(
      `This profile can't be permanently deleted. ${contactBlocker} Choose Keep Contacts to delete only the roster profile, or Archive Profile to retain the profile and its history.`,
      "profile_contact_history_requires_inactive",
    );
  }
}

export async function deleteProfile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profileDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_profile_delete" }, { status: 400 });
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  let deleted: boolean;
  try {
    deleted = storage.transactionSync(() => {
      const existing = storage.sql
        .exec("SELECT id FROM profiles WHERE id = ? LIMIT 1", parsed.data.profileId)
        .toArray();
      if (existing.length === 0) return false;
      assertNoProfileHistoryToPreserve(storage, parsed.data.profileId, parsed.data.contacts);
      const contacts = storage.sql
        .exec<{ id: string }>("SELECT id FROM contacts WHERE profile_id = ?", parsed.data.profileId)
        .toArray();
      if (parsed.data.contacts === "delete_unused") {
        for (const contact of contacts) {
          deleteContactInStore(storage, { ...parsed.data, contactId: contact.id });
        }
      } else {
        storage.sql.exec(
          "UPDATE contacts SET profile_id = NULL, updated_at = ? WHERE profile_id = ?",
          occurredAt,
          parsed.data.profileId,
        );
        for (const contact of contacts) {
          storage.sql.exec(
            `INSERT INTO audit_events
              (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
             VALUES (?, 'organization_member', ?, 'contact.profile_unlinked', 'contact', ?, ?, ?, ?)`,
            crypto.randomUUID(),
            parsed.data.actorUserId,
            contact.id,
            parsed.data.requestId,
            JSON.stringify({ profileId: parsed.data.profileId }),
            occurredAt,
          );
        }
      }
      storage.sql.exec(
        "DELETE FROM profile_status_history WHERE profile_id = ?",
        parsed.data.profileId,
      );
      storage.sql.exec(
        "DELETE FROM notification_receipts WHERE recipient_profile_id = ?",
        parsed.data.profileId,
      );
      storage.sql.exec("DELETE FROM profiles WHERE id = ?", parsed.data.profileId);
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'profile.deleted', 'profile', ?, ?, ?, ?)`,
        crypto.randomUUID(),
        parsed.data.actorUserId,
        parsed.data.profileId,
        parsed.data.requestId,
        JSON.stringify({ contacts: parsed.data.contacts, contactCount: contacts.length }),
        occurredAt,
      );
      return true;
    });
  } catch (error: unknown) {
    if (error instanceof ProfileHistoryDeletionError) {
      return Response.json(
        {
          code: error.code,
          message: error.message,
        },
        { status: 409 },
      );
    }
    throw error;
  }
  return deleted
    ? Response.json({ deleted: true, profileId: parsed.data.profileId })
    : Response.json({ code: "profile_not_found" }, { status: 404 });
}
