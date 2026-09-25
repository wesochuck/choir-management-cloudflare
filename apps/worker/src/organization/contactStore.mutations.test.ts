import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  ContactStoreError,
  createContactInStore,
  createContactListInStore,
  deleteContactInStore,
  getContactFromStore,
  updateContactInStore,
  addContactsToListInStore,
} from "./contactStore";
import {
  countFor,
  createContactTestAdapter,
  createFreshContactContext,
  dbAllUnknown,
  DEFAULT_CONTACT_TEST_ACTOR_ID as ACTOR_ID,
  DEFAULT_CONTACT_TEST_ORG_ID as ORG_ID,
  expectContactStoreError,
  isChangeSummaryRow,
  isNameRow,
  isVersionRow,
  runMigrations,
  seedOrganization,
  seedProfile,
  uuidFor,
} from "./contactTestkit";
import { currentOrganizationSchemaVersion } from "./schema/migrations";

describe("contact schema migrations with real SQLite", () => {
  it("migrates a fresh database to the current version with contact tables", () => {
    const db = new DatabaseSync(":memory:");
    createContactTestAdapter(db);
    runMigrations(db);

    expect(currentOrganizationSchemaVersion).toBe(93);
    const tables = new Set<string>();
    for (const row of dbAllUnknown(db, "SELECT name FROM sqlite_master WHERE type = 'table'")) {
      if (isNameRow(row)) tables.add(row.name);
    }
    for (const table of [
      "contacts",
      "contact_communication_preferences",
      "contact_lists",
      "contact_list_memberships",
      "contact_imports",
      "contact_import_rows",
    ]) {
      expect(tables.has(table), `expected table ${table}`).toBe(true);
    }
    const contactColumns = new Set<string>();
    for (const row of dbAllUnknown(db, "PRAGMA table_info(contacts)")) {
      if (isNameRow(row)) contactColumns.add(row.name);
    }
    for (const column of [
      "id",
      "first_name",
      "last_name",
      "display_name",
      "email",
      "normalized_email",
      "phone",
      "normalized_phone",
      "profile_id",
      "source",
      "created_at",
      "updated_at",
    ]) {
      expect(contactColumns.has(column), `expected contacts.${column}`).toBe(true);
    }
    const indexes = new Set<string>();
    for (const row of dbAllUnknown(db, "SELECT name FROM sqlite_master WHERE type = 'index'")) {
      if (isNameRow(row)) indexes.add(row.name);
    }
    for (const index of [
      "idx_contacts_normalized_email",
      "idx_contacts_normalized_phone",
      "idx_contacts_profile_id",
      "idx_contacts_display_name",
      "idx_contact_list_memberships_list",
      "idx_contact_lists_name",
      "idx_ticket_purchases_contact_id",
      "idx_donations_contact_id",
      "idx_communication_deliveries_profile",
    ]) {
      expect(indexes.has(index), `expected index ${index}`).toBe(true);
    }
    const versions: number[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT version FROM organization_schema_migrations ORDER BY version",
    )) {
      if (isVersionRow(row)) versions.push(row.version);
    }
    expect(versions.at(-1)).toBe(currentOrganizationSchemaVersion);
  });

  it("migrates from the pre-contacts schema while preserving existing rows", () => {
    const db = new DatabaseSync(":memory:");
    createContactTestAdapter(db);
    runMigrations(db, 77);
    seedOrganization(db, ORG_ID);
    seedProfile(db, uuidFor(9001), "Existing Singer");
    expect(countFor(db, "SELECT COUNT(*) AS count FROM profiles")).toBe(1);

    runMigrations(db);

    expect(countFor(db, "SELECT COUNT(*) AS count FROM profiles")).toBe(1);
    const contactTables: string[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'contact%'",
    )) {
      if (isNameRow(row)) contactTables.push(row.name);
    }
    expect(contactTables).toHaveLength(6);
  });

  it("is idempotent across repeated runs", () => {
    const { db, storage } = createFreshContactContext();
    const countBefore = countFor(
      db,
      "SELECT COUNT(*) AS count FROM organization_schema_migrations",
    );
    runMigrations(db);
    runMigrations(db);
    expect(countFor(db, "SELECT COUNT(*) AS count FROM organization_schema_migrations")).toBe(
      countBefore,
    );

    const contactId = uuidFor(9101);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Idempotent Check",
      organizationId: ORG_ID,
      requestId: uuidFor(9102),
    });
    runMigrations(db);
    expect(getContactFromStore(storage, ORG_ID, contactId).contact.displayName).toBe(
      "Idempotent Check",
    );
  });
});

describe("contact CRUD with real SQLite", () => {
  it("creates, reads, updates, and deletes a contact with audit evidence", () => {
    const { db, storage } = createFreshContactContext();
    const contactId = uuidFor(1001);

    const created = createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Jane Smith",
      email: "jane@example.com",
      organizationId: ORG_ID,
      phone: "+15551234567",
      requestId: uuidFor(1002),
      source: "manual",
    });
    expect(created.contact.id).toBe(contactId);
    expect(created.contact.normalizedEmail).toBe("jane@example.com");
    expect(created.contact.normalizedPhone).toBe("+15551234567");
    expect(created.preferences).toHaveLength(2);

    const fetched = getContactFromStore(storage, ORG_ID, contactId);
    expect(fetched.contact.email).toBe("jane@example.com");
    expect(fetched.listIds).toEqual([]);

    const updated = updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Jane A. Smith",
      organizationId: ORG_ID,
      requestId: uuidFor(1003),
    });
    expect(updated.contact.displayName).toBe("Jane A. Smith");
    expect(updated.contact.email).toBe("jane@example.com");

    const listId = uuidFor(1004);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(1005),
    });
    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [contactId],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(1006),
      }).added,
    ).toBe(1);

    expect(
      deleteContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        organizationId: ORG_ID,
        requestId: uuidFor(1007),
      }).deleted,
    ).toBe(true);
    expectContactStoreError(
      () => getContactFromStore(storage, ORG_ID, contactId),
      "contact_not_found",
    );

    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM contact_list_memberships WHERE contact_id = ?",
        contactId,
      ),
    ).toBe(0);
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM contact_communication_preferences WHERE contact_id = ?",
        contactId,
      ),
    ).toBe(0);
    expect(
      countFor(db, "SELECT COUNT(*) AS count FROM audit_events WHERE target_id = ?", contactId),
    ).toBeGreaterThanOrEqual(3);
  });

  it("rejects updates that would leave a contact without identity", () => {
    const { storage } = createFreshContactContext();
    const contactId = uuidFor(1101);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Solo Name",
      organizationId: ORG_ID,
      requestId: uuidFor(1102),
    });
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId,
          displayName: null,
          organizationId: ORG_ID,
          requestId: uuidFor(1103),
        }),
      "contact_missing_identity",
    );
    expect(getContactFromStore(storage, ORG_ID, contactId).contact.displayName).toBe("Solo Name");
  });

  it("returns typed not-found errors for missing contacts", () => {
    const { storage } = createFreshContactContext();
    expectContactStoreError(
      () => getContactFromStore(storage, ORG_ID, uuidFor(1201)),
      "contact_not_found",
    );
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(1201),
          displayName: "Ghost",
          organizationId: ORG_ID,
          requestId: uuidFor(1202),
        }),
      "contact_not_found",
    );
    expectContactStoreError(
      () =>
        deleteContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(1201),
          organizationId: ORG_ID,
          requestId: uuidFor(1203),
        }),
      "contact_not_found",
    );
  });
});

describe("contact identity, duplicates, and profiles", () => {
  it("detects normalized-email duplicates across case and space variants with typed errors", () => {
    const { storage } = createFreshContactContext();
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2001),
      email: "Jane@Example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(2002),
    });
    try {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: uuidFor(2003),
        email: "  jane@example.COM  ",
        organizationId: ORG_ID,
        requestId: uuidFor(2004),
      });
      throw new Error("Expected duplicate to throw.");
    } catch (error: unknown) {
      if (!(error instanceof ContactStoreError)) throw error;
      expect(error.code).toBe("contact_duplicate_email");
      expect(error.message).not.toMatch(/UNIQUE constraint failed/i);
    }
  });

  it("allows many contacts with nullable email", () => {
    const { storage } = createFreshContactContext();
    for (const index of [2101, 2102, 2103]) {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: uuidFor(index),
        displayName: `No Email ${String(index)}`,
        organizationId: ORG_ID,
        requestId: uuidFor(index + 50),
      });
    }
    expect(getContactFromStore(storage, ORG_ID, uuidFor(2101)).contact.displayName).toBe(
      "No Email 2101",
    );
  });

  it("rejects duplicate email on update without mutating the stored row", () => {
    const { storage } = createFreshContactContext();
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2201),
      email: "alpha@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(2202),
    });
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2203),
      email: "beta@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(2204),
    });
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(2203),
          email: " ALPHA@example.com ",
          organizationId: ORG_ID,
          requestId: uuidFor(2205),
        }),
      "contact_duplicate_email",
    );
    expect(getContactFromStore(storage, ORG_ID, uuidFor(2203)).contact.email).toBe(
      "beta@example.com",
    );
  });

  it("links profile_id when the profile exists and rejects unknown profiles", () => {
    const { db, storage } = createFreshContactContext();
    const profileId = uuidFor(2301);
    seedProfile(db, profileId, "Member Jane");

    const linked = createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(2302),
      organizationId: ORG_ID,
      profileId,
      requestId: uuidFor(2303),
    });
    expect(linked.contact.profileId).toBe(profileId);

    expectContactStoreError(
      () =>
        createContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(2304),
          email: "orphan@example.com",
          organizationId: ORG_ID,
          profileId: uuidFor(2305),
          requestId: uuidFor(2306),
        }),
      "contact_profile_not_found",
    );
    expectContactStoreError(
      () =>
        updateContactInStore(storage, {
          actorUserId: ACTOR_ID,
          contactId: uuidFor(2302),
          organizationId: ORG_ID,
          profileId: uuidFor(2307),
          requestId: uuidFor(2308),
        }),
      "contact_profile_not_found",
    );
  });
});

describe("unified contact detail with real SQLite", () => {
  function seedTicketPurchaseWithContact(
    db: DatabaseSync,
    purchaseIndex: number,
    contactId: string,
  ): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ticket_purchases
        (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
         buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
         provider_session_id, provider_payment_id, status, marketing_opt_in,
         created_at, updated_at, contact_id)
       VALUES (?, ?, ?, 'Spring Concert', ?, 'UTC', 'Buyer', 'buyer@example.com',
         1, 500, 0, 500, ?, '', 'paid', 1, ?, ?, ?)`,
    ).run(
      uuidFor(5_000 + purchaseIndex),
      uuidFor(6_000 + purchaseIndex),
      uuidFor(777),
      now,
      `detail_session_${String(purchaseIndex)}`,
      now,
      now,
      contactId,
    );
  }

  function seedDonationWithContact(
    db: DatabaseSync,
    donationIndex: number,
    contactId: string,
  ): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO donations
        (id, checkout_request_id, status, amount_cents, buyer_name, buyer_email,
         provider_session_id, provider_payment_id, created_at, updated_at, marketing_consent, contact_id)
       VALUES (?, ?, 'paid', 1000, 'Donor', 'donor@example.com', ?, '', ?, ?, 1, ?)`,
    ).run(
      uuidFor(7_000 + donationIndex),
      uuidFor(8_000 + donationIndex),
      `detail_dsession_${String(donationIndex)}`,
      now,
      now,
      contactId,
    );
  }

  function seedDelivery(
    db: DatabaseSync,
    deliveryIndex: number,
    contactId: string,
    channel: "email" | "sms",
    status: "failed" | "sent",
    createdAt: string,
  ): void {
    db.prepare(
      `INSERT INTO communication_deliveries
        (id, message_id, profile_id, recipient_name, channel, destination, status,
         created_at, updated_at)
       VALUES (?, ?, ?, 'Detail Recipient', ?, ?, ?, ?, ?)`,
    ).run(
      uuidFor(9_000 + deliveryIndex),
      uuidFor(9_500 + deliveryIndex),
      contactId,
      channel,
      `${channel === "email" ? "buyer" : "+1555"}@example.com`,
      status,
      createdAt,
      createdAt,
    );
  }

  it("projects lists, linked profile, commerce counts, and last sent email", () => {
    const { db, storage } = createFreshContactContext();
    const profileId = uuidFor(4_101);
    seedProfile(db, profileId, "Jane Singer");
    const contactId = uuidFor(4_102);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Jane Smith",
      email: "jane@example.com",
      organizationId: ORG_ID,
      profileId,
      requestId: uuidFor(4_103),
    });
    for (const [index, name] of ["Newsletter", "Concert Audience"].entries()) {
      const listId = uuidFor(4_110 + index);
      createContactListInStore(storage, {
        actorUserId: ACTOR_ID,
        listId,
        name,
        organizationId: ORG_ID,
        requestId: uuidFor(4_120 + index),
      });
      expect(
        addContactsToListInStore(storage, {
          actorUserId: ACTOR_ID,
          contactIds: [contactId],
          listId,
          organizationId: ORG_ID,
          requestId: uuidFor(4_130 + index),
        }).added,
      ).toBe(1);
    }
    seedTicketPurchaseWithContact(db, 1, contactId);
    seedTicketPurchaseWithContact(db, 2, contactId);
    seedDonationWithContact(db, 1, contactId);
    seedDelivery(db, 1, contactId, "email", "sent", "2026-08-10T10:00:00.000Z");
    seedDelivery(db, 2, contactId, "email", "sent", "2026-08-12T10:00:00.000Z");
    seedDelivery(db, 3, contactId, "email", "failed", "2026-08-14T10:00:00.000Z");
    seedDelivery(db, 4, contactId, "sms", "sent", "2026-08-15T10:00:00.000Z");

    const detail = getContactFromStore(storage, ORG_ID, contactId);
    expect(detail.lists).toEqual([
      { id: uuidFor(4_111), name: "Concert Audience" },
      { id: uuidFor(4_110), name: "Newsletter" },
    ]);
    expect(detail.listIds.toSorted()).toEqual([uuidFor(4_110), uuidFor(4_111)].toSorted());
    expect(detail.linkedProfile).toEqual({ displayName: "Jane Singer", id: profileId });
    expect(detail.activity).toEqual({ donationCount: 1, ticketPurchaseCount: 2 });
    expect(detail.lastEmailAt).toBe("2026-08-12T10:00:00.000Z");
  });

  it("returns empty relationships for a standalone contact", () => {
    const { storage } = createFreshContactContext();
    const contactId = uuidFor(4_201);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Solo Contact",
      organizationId: ORG_ID,
      requestId: uuidFor(4_202),
    });
    const detail = getContactFromStore(storage, ORG_ID, contactId);
    expect(detail.lists).toEqual([]);
    expect(detail.linkedProfile).toBeNull();
    expect(detail.activity).toEqual({ donationCount: 0, ticketPurchaseCount: 0 });
    expect(detail.lastEmailAt).toBeNull();
  });

  it("isolates detail activity to the requested contact and organization", () => {
    const { db, storage } = createFreshContactContext();
    const first = uuidFor(4_301);
    const second = uuidFor(4_302);
    for (const [index, contactId] of [first, second].entries()) {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: `Contact ${String(index)}`,
        organizationId: ORG_ID,
        requestId: uuidFor(4_310 + index),
      });
    }
    seedTicketPurchaseWithContact(db, 11, second);
    seedDelivery(db, 11, second, "email", "sent", "2026-08-11T10:00:00.000Z");
    const detail = getContactFromStore(storage, ORG_ID, first);
    expect(detail.activity).toEqual({ donationCount: 0, ticketPurchaseCount: 0 });
    expect(detail.lastEmailAt).toBeNull();
    expectContactStoreError(
      () => getContactFromStore(storage, "org-other", first),
      "organization_identity_conflict",
    );
  });

  it("reports no linked profile when the roster reference is dangling", () => {
    const { db, storage } = createFreshContactContext();
    const contactId = uuidFor(4_401);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Dangling Link",
      organizationId: ORG_ID,
      requestId: uuidFor(4_402),
    });
    db.prepare("UPDATE contacts SET profile_id = ? WHERE id = ?").run(uuidFor(4_403), contactId);
    expect(getContactFromStore(storage, ORG_ID, contactId).linkedProfile).toBeNull();
  });
});

describe("contact consent precedence and audit safety", () => {
  it("keeps unsubscribed status when a later subscribed write arrives", () => {
    const { storage } = createFreshContactContext();
    const contactId = uuidFor(5001);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      email: "carol@example.com",
      emailStatus: "unsubscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(5002),
    });
    const updated = updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      emailStatus: "subscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(5003),
    });
    expect(updated.preferences.find((preference) => preference.channel === "email")?.status).toBe(
      "unsubscribed",
    );

    const promoted = updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      organizationId: ORG_ID,
      requestId: uuidFor(5004),
      smsStatus: "unsubscribed",
    });
    expect(promoted.preferences.find((preference) => preference.channel === "sms")?.status).toBe(
      "unsubscribed",
    );
  });

  it("writes append-only audit rows without sensitive contact values", () => {
    const { db, storage } = createFreshContactContext();
    const email = "audit-sensitive-999@example.com";
    const phone = "+15557654321";
    const contactId = uuidFor(5101);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Audit Subject",
      email,
      organizationId: ORG_ID,
      phone,
      requestId: uuidFor(5102),
    });
    updateContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Audit Subject Updated",
      organizationId: ORG_ID,
      requestId: uuidFor(5103),
    });
    const summaries: string[] = [];
    for (const row of dbAllUnknown(
      db,
      "SELECT change_summary AS changeSummary FROM audit_events WHERE target_id = ?",
      contactId,
    )) {
      if (isChangeSummaryRow(row)) summaries.push(row.changeSummary);
    }
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    for (const summary of summaries) {
      expect(summary).not.toContain(email);
      expect(summary).not.toContain(phone);
      expect(summary).not.toContain("audit-sensitive-999");
    }
  });
});
