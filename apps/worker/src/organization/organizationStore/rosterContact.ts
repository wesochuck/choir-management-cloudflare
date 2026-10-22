import type { OrganizationProfileRequest } from "@choir/contracts";
import { createContactInStore, updateContactInStore } from "../contactStore/contacts";

// The oldest linked Contact is primary. ID breaks timestamp ties deterministically.
export const primaryRosterContactSql = `(SELECT c.id FROM contacts c WHERE c.profile_id = p.id ORDER BY c.created_at, c.id LIMIT 1)`;

export function rosterContactConflict(
  storage: DurableObjectStorage,
  profileId: string,
  email: string | undefined,
): boolean {
  if (!email) return false;
  const primary = storage.sql
    .exec<{ id: string }>(
      "SELECT id FROM contacts WHERE profile_id = ? ORDER BY created_at, id LIMIT 1",
      profileId,
    )
    .toArray()
    .at(0);
  return (
    storage.sql
      .exec(
        "SELECT id FROM contacts WHERE normalized_email = ? AND id <> ? LIMIT 1",
        email.trim().toLowerCase(),
        primary?.id ?? "",
      )
      .toArray().length > 0
  );
}

export function saveRosterContact(
  storage: DurableObjectStorage,
  input: {
    actorUserId: string;
    organizationId: string;
    requestId: string;
    profileId: string;
  },
  profile: OrganizationProfileRequest,
): void {
  // Omitted on older clients and unrelated mutations: preserve saved contact data.
  if (profile.email === undefined) return;
  const primary = storage.sql
    .exec<{ id: string }>(
      "SELECT id FROM contacts WHERE profile_id = ? ORDER BY created_at, id LIMIT 1",
      input.profileId,
    )
    .toArray()
    .at(0);
  if (primary) {
    updateContactInStore(storage, {
      ...input,
      contactId: primary.id,
      email: profile.email || null,
    });
  } else if (profile.email) {
    createContactInStore(storage, {
      ...input,
      contactId: crypto.randomUUID(),
      displayName: profile.displayName,
      email: profile.email,
      source: "roster",
      // Roster operational email does not confer marketing or SMS consent.
      emailStatus: "unknown",
      smsStatus: "unknown",
    });
  }
}
