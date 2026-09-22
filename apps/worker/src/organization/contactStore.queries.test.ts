import { describe, expect, it } from "vitest";

import {
  addContactsToListInStore,
  createContactInStore,
  createContactListInStore,
  listContactsFromStore,
} from "./contactStore";
import {
  createFreshContactContext,
  dbAllUnknown,
  DEFAULT_CONTACT_TEST_ACTOR_ID as ACTOR_ID,
  DEFAULT_CONTACT_TEST_ORG_ID as ORG_ID,
  isPlanDetailRow,
  uuidFor,
} from "./contactTestkit";

describe("contact search, pagination, and bounded sizes", () => {
  it("paginates with opaque cursors and bounded limits", () => {
    const { storage } = createFreshContactContext();
    for (let index = 0; index < 5; index += 1) {
      const padded = String(index + 1).padStart(3, "0");
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: uuidFor(4001 + index),
        displayName: `Contact ${padded}`,
        organizationId: ORG_ID,
        requestId: uuidFor(4101 + index),
      });
    }
    const first = listContactsFromStore(storage, { limit: 2, organizationId: ORG_ID });
    expect(first.contacts).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = listContactsFromStore(storage, {
      cursor: first.nextCursor,
      limit: 2,
      organizationId: ORG_ID,
    });
    expect(second.contacts).toHaveLength(2);
    expect(second.hasMore).toBe(true);

    const third = listContactsFromStore(storage, {
      cursor: second.nextCursor,
      limit: 2,
      organizationId: ORG_ID,
    });
    expect(third.contacts).toHaveLength(1);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();

    const bounded = listContactsFromStore(storage, { limit: 10_000, organizationId: ORG_ID });
    expect(bounded.contacts.length).toBeLessThanOrEqual(500);
  });

  it("searches by name, email, and phone fragments", () => {
    const { storage } = createFreshContactContext();
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(4201),
      displayName: "Jane Smith",
      email: "jane.smith@example.com",
      organizationId: ORG_ID,
      requestId: uuidFor(4202),
    });
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: uuidFor(4203),
      displayName: "Bob Jones",
      email: "bob@example.com",
      organizationId: ORG_ID,
      phone: "+15550001111",
      requestId: uuidFor(4204),
    });
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "jane" }).contacts,
    ).toHaveLength(1);
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "bob@example" }).contacts,
    ).toHaveLength(1);
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "5550001111" }).contacts,
    ).toHaveLength(1);
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, query: "no-such-person" }).contacts,
    ).toHaveLength(0);
  });

  it("filters by source, list, and communication status", () => {
    const { storage } = createFreshContactContext();
    const subscribedId = uuidFor(4301);
    const unsubscribedId = uuidFor(4302);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: subscribedId,
      displayName: "Subscribed Import",
      email: "sub@example.com",
      emailStatus: "subscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(4303),
      source: "import",
    });
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId: unsubscribedId,
      displayName: "Unsubscribed Manual",
      email: "unsub@example.com",
      emailStatus: "unsubscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(4304),
      source: "manual",
    });
    expect(
      listContactsFromStore(storage, { organizationId: ORG_ID, source: "import" }).contacts.map(
        (contact) => contact.id,
      ),
    ).toEqual([subscribedId]);
    expect(
      listContactsFromStore(storage, {
        channel: "email",
        organizationId: ORG_ID,
        status: "subscribed",
      }).contacts.map((contact) => contact.id),
    ).toEqual([subscribedId]);

    const listId = uuidFor(4305);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Filtered",
      organizationId: ORG_ID,
      requestId: uuidFor(4306),
    });
    addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds: [subscribedId],
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(4307),
    });
    expect(
      listContactsFromStore(storage, { listId, organizationId: ORG_ID }).contacts.map(
        (contact) => contact.id,
      ),
    ).toEqual([subscribedId]);
  });
});

describe("contact persistence performance with real SQLite", () => {
  it("lists pages with a bounded query count and indexed email lookup", () => {
    const { db, queryCount, resetQueryCount, storage } = createFreshContactContext();
    const insertContact = db.prepare(
      `INSERT INTO contacts
        (id, first_name, last_name, display_name, email, normalized_email,
         phone, normalized_phone, profile_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPreference = db.prepare(
      `INSERT INTO contact_communication_preferences
        (contact_id, channel, status, source, observed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (let index = 0; index < 2500; index += 1) {
      const padded = String(index).padStart(5, "0");
      const id = uuidFor(100_000 + index);
      const email = `perf-${padded}@example.com`;
      insertContact.run(
        id,
        `First${padded}`,
        `Last${padded}`,
        `Perf Contact ${padded}`,
        email,
        email,
        null,
        null,
        null,
        "perf-seed",
        now,
        now,
      );
      insertPreference.run(id, "email", "unknown", "perf-seed", now, now);
      insertPreference.run(id, "sms", "unknown", "perf-seed", now, now);
    }

    resetQueryCount();
    const page = listContactsFromStore(storage, { limit: 100, organizationId: ORG_ID });
    expect(page.contacts).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    expect(queryCount()).toBeLessThanOrEqual(3);

    resetQueryCount();
    const found = listContactsFromStore(storage, {
      limit: 5,
      organizationId: ORG_ID,
      query: "perf-01234@example.com",
    });
    expect(found.contacts).toHaveLength(1);
    expect(queryCount()).toBeLessThanOrEqual(3);

    const planDetails: string[] = [];
    for (const row of dbAllUnknown(
      db,
      "EXPLAIN QUERY PLAN SELECT id FROM contacts WHERE normalized_email = ?",
      "perf-00001@example.com",
    )) {
      if (isPlanDetailRow(row)) planDetails.push(row.detail);
    }
    expect(planDetails.some((detail) => /USING .*INDEX/i.test(detail))).toBe(true);
    expect(planDetails.some((detail) => /idx_contacts_normalized_email/i.test(detail))).toBe(true);
  });

  it("adds hundreds of memberships with bulk indexed checks instead of O(N^2) scans", () => {
    const { queryCount, resetQueryCount, storage } = createFreshContactContext();
    const contactIds: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      const contactId = uuidFor(6000 + index);
      contactIds.push(contactId);
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: `Bulk Perf ${String(index).padStart(4, "0")}`,
        organizationId: ORG_ID,
        requestId: uuidFor(7000 + index),
      });
    }
    const listId = uuidFor(7999);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Perf List",
      organizationId: ORG_ID,
      requestId: uuidFor(7998),
    });

    resetQueryCount();
    const result = addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds,
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(7997),
    });
    expect(result.added).toBe(400);
    expect(queryCount()).toBeLessThanOrEqual(12);

    resetQueryCount();
    const retry = addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds,
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(7996),
    });
    expect(retry.added).toBe(0);
    expect(queryCount()).toBeLessThanOrEqual(6);
  });
});

describe("contact list enrichment for the management UI (Phase 4)", () => {
  it("returns empty enrichment by default and batched details when opted in", () => {
    const { storage } = createFreshContactContext();
    const contactId = uuidFor(9001);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "Enriched Contact",
      email: "enriched@example.com",
      emailStatus: "subscribed",
      organizationId: ORG_ID,
      requestId: uuidFor(9002),
    });
    const listId = uuidFor(9003);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(9004),
    });
    addContactsToListInStore(storage, {
      actorUserId: ACTOR_ID,
      contactIds: [contactId],
      listId,
      organizationId: ORG_ID,
      requestId: uuidFor(9005),
    });

    const plain = listContactsFromStore(storage, { organizationId: ORG_ID });
    expect(plain.contacts).toHaveLength(1);
    expect(plain.memberships).toEqual([]);
    expect(plain.preferences).toEqual([]);

    const enriched = listContactsFromStore(storage, {
      includeDetails: true,
      organizationId: ORG_ID,
    });
    expect(enriched.contacts).toHaveLength(1);
    expect(enriched.memberships).toHaveLength(1);
    expect(enriched.memberships[0]).toMatchObject({ contactId, listId });
    const emailPreference = enriched.preferences.find(
      (preference) => preference.contactId === contactId && preference.channel === "email",
    );
    expect(emailPreference?.status).toBe("subscribed");
  });
});
