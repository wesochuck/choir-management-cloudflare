import { describe, expect, it } from "vitest";

import {
  addContactsToListInStore,
  createContactInStore,
  createContactListInStore,
  deleteContactListInStore,
  getContactFromStore,
  listContactListsFromStore,
  removeContactsFromListInStore,
  updateContactListInStore,
} from "./contactStore";
import {
  countFor,
  createFreshContactContext,
  DEFAULT_CONTACT_TEST_ACTOR_ID as ACTOR_ID,
  DEFAULT_CONTACT_TEST_ORG_ID as ORG_ID,
  expectContactStoreError,
  uuidFor,
} from "./contactTestkit";

describe("contact lists and memberships", () => {
  it("creates, renames, and deletes lists without deleting contacts", () => {
    const { storage } = createFreshContactContext();
    const contactId = uuidFor(3001);
    createContactInStore(storage, {
      actorUserId: ACTOR_ID,
      contactId,
      displayName: "List Member",
      organizationId: ORG_ID,
      requestId: uuidFor(3002),
    });
    const listId = uuidFor(3003);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      description: "Monthly news",
      listId,
      name: "Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(3004),
    });
    expect(listContactListsFromStore(storage, ORG_ID).lists.map((list) => list.name)).toEqual([
      "Newsletter",
    ]);

    const renamed = updateContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Weekly Newsletter",
      organizationId: ORG_ID,
      requestId: uuidFor(3005),
    });
    expect(renamed.list.name).toBe("Weekly Newsletter");

    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [contactId],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3006),
      }).added,
    ).toBe(1);
    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [contactId],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3007),
      }).added,
    ).toBe(0);

    expect(
      deleteContactListInStore(storage, {
        actorUserId: ACTOR_ID,
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3008),
      }).deleted,
    ).toBe(true);
    expect(listContactListsFromStore(storage, ORG_ID).lists).toHaveLength(0);
    expect(getContactFromStore(storage, ORG_ID, contactId).contact.displayName).toBe("List Member");
    expect(getContactFromStore(storage, ORG_ID, contactId).listIds).toEqual([]);
  });

  it("removes members and validates list operations", () => {
    const { storage } = createFreshContactContext();
    const first = uuidFor(3101);
    const second = uuidFor(3102);
    const seeds: readonly {
      readonly contactId: string;
      readonly name: string;
      readonly requestId: string;
    }[] = [
      { contactId: first, name: "First", requestId: uuidFor(3111) },
      { contactId: second, name: "Second", requestId: uuidFor(3112) },
    ];
    for (const seed of seeds) {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId: seed.contactId,
        displayName: seed.name,
        organizationId: ORG_ID,
        requestId: seed.requestId,
      });
    }
    const listId = uuidFor(3103);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Audience",
      organizationId: ORG_ID,
      requestId: uuidFor(3104),
    });
    expect(
      addContactsToListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [first, second],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3105),
      }).added,
    ).toBe(2);
    expect(
      removeContactsFromListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [first],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3106),
      }).removed,
    ).toBe(1);
    expect(
      removeContactsFromListInStore(storage, {
        actorUserId: ACTOR_ID,
        contactIds: [first],
        listId,
        organizationId: ORG_ID,
        requestId: uuidFor(3107),
      }).removed,
    ).toBe(0);
    expect(getContactFromStore(storage, ORG_ID, second).listIds).toEqual([listId]);

    expectContactStoreError(
      () =>
        createContactListInStore(storage, {
          actorUserId: ACTOR_ID,
          listId: uuidFor(3108),
          name: "   ",
          organizationId: ORG_ID,
          requestId: uuidFor(3109),
        }),
      "validation_failed",
    );
    expectContactStoreError(
      () => getContactFromStore(storage, ORG_ID, uuidFor(3110)),
      "contact_not_found",
    );
  });

  it("rolls back bulk membership writes when any contact is missing", () => {
    const { db, storage } = createFreshContactContext();
    const first = uuidFor(3301);
    const second = uuidFor(3302);
    for (const contactId of [first, second]) {
      createContactInStore(storage, {
        actorUserId: ACTOR_ID,
        contactId,
        displayName: `Bulk ${contactId.slice(-4)}`,
        organizationId: ORG_ID,
        requestId: crypto.randomUUID(),
      });
    }
    const listId = uuidFor(3303);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Bulk List",
      organizationId: ORG_ID,
      requestId: crypto.randomUUID(),
    });
    expectContactStoreError(
      () =>
        addContactsToListInStore(storage, {
          actorUserId: ACTOR_ID,
          contactIds: [first, uuidFor(3304), second],
          listId,
          organizationId: ORG_ID,
          requestId: crypto.randomUUID(),
        }),
      "contact_not_found",
    );
    expect(
      countFor(
        db,
        "SELECT COUNT(*) AS count FROM contact_list_memberships WHERE list_id = ?",
        listId,
      ),
    ).toBe(0);
  });

  it("enforces bounded bulk sizes", () => {
    const { storage } = createFreshContactContext();
    const listId = uuidFor(3401);
    createContactListInStore(storage, {
      actorUserId: ACTOR_ID,
      listId,
      name: "Bounded",
      organizationId: ORG_ID,
      requestId: uuidFor(3402),
    });
    const tooMany = Array.from({ length: 501 }, (_, index) => uuidFor(5000 + index));
    expectContactStoreError(
      () =>
        addContactsToListInStore(storage, {
          actorUserId: ACTOR_ID,
          contactIds: tooMany,
          listId,
          organizationId: ORG_ID,
          requestId: uuidFor(3403),
        }),
      "validation_failed",
    );
    expectContactStoreError(
      () =>
        removeContactsFromListInStore(storage, {
          actorUserId: ACTOR_ID,
          contactIds: [],
          listId,
          organizationId: ORG_ID,
          requestId: uuidFor(3404),
        }),
      "validation_failed",
    );
  });
});
