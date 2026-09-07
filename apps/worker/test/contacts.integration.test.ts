import {
  CONTACT_BULK_OPERATION_MAX,
  contactDeleteArchiveResponseSchema,
  contactDetailResponseSchema,
  contactListDeleteResponseSchema,
  contactListResponseSchema,
  contactListsResponseSchema,
  contactResponseSchema,
  contactsResponseSchema,
  problemDetailsSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";

const MANAGER_EMAIL = "contact.manager@example.test";
const BRAVO_ADMIN_EMAIL = "contact.bravo.admin@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const apiRequest = (hostname: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(hostname, path, cookie, init);

const jsonRequest = (
  hostname: string,
  path: string,
  cookie: string | undefined,
  body: unknown,
  method = "POST",
) =>
  exports.default.fetch(
    apiRequest(hostname, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    }),
  );

const signInManager = () =>
  signInWithOtp(exports.default, "alpha.localhost", MANAGER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

const signInBravoAdmin = () =>
  signInWithOtp(exports.default, "bravo.localhost", BRAVO_ADMIN_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

async function readProblem(response: Response) {
  return problemDetailsSchema.parse(await response.json());
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "contact-manager", MANAGER_EMAIL, "Contact Manager");
  await seedAuthUser(controlDatabase, "contact-bravo-admin", BRAVO_ADMIN_EMAIL, "Bravo Admin");
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-alpha",
    name: "Organization Alpha",
    role: "admin",
    slug: "alpha",
    userId: "contact-manager",
  });
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-bravo",
    name: "Organization Bravo",
    role: "member",
    slug: "bravo",
    userId: "contact-manager",
  });
  // A second administrator owns Organization Bravo so cross-tenant isolation
  // can be exercised with full privileges on the other tenant.
  await controlDatabase
    .prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind("member-bravo-admin", "organization-bravo", "contact-bravo-admin", "admin", Date.now())
    .run();
});

afterEach(async () => {
  await reset();
});

describe("Organization Contacts API", () => {
  it("lets an organization admin create, read, update, and delete a contact", async () => {
    const cookie = await signInManager();

    const createResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts",
      cookie,
      {
        displayName: "Newsletter Nancy",
        email: "nancy@example.test",
        emailStatus: "subscribed",
        phone: "+15551234567",
        smsStatus: "unknown",
        source: "signup-form",
      },
    );
    expect(createResponse.status).toBe(201);
    const created = contactResponseSchema.parse(await createResponse.json());
    expect(created.contact.email).toBe("nancy@example.test");
    expect(created.contact.normalizedEmail).toBe("nancy@example.test");
    const contactId = created.contact.id;

    const getResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts/${contactId}`, cookie),
    );
    expect(getResponse.status).toBe(200);
    expect(contactResponseSchema.parse(await getResponse.json()).contact.id).toBe(contactId);

    const listResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contacts?query=nancy", cookie),
    );
    expect(listResponse.status).toBe(200);
    const listed = contactsResponseSchema.parse(await listResponse.json());
    expect(listed.hasMore).toBe(false);
    expect(listed.contacts.map((contact) => contact.id)).toEqual([contactId]);

    const updateResponse = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contacts/${contactId}`,
      cookie,
      { displayName: "Nancy Newsletter" },
      "PATCH",
    );
    expect(updateResponse.status).toBe(200);
    expect(contactResponseSchema.parse(await updateResponse.json()).contact.displayName).toBe(
      "Nancy Newsletter",
    );

    const deleteResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts/${contactId}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(contactDeleteArchiveResponseSchema.parse(await deleteResponse.json())).toMatchObject({
      contactId,
      status: "deleted",
    });

    const missingResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts/${contactId}`, cookie),
    );
    expect(missingResponse.status).toBe(404);
    expect(await readProblem(missingResponse)).toMatchObject({ code: "contact_not_found" });
  });

  it("projects the unified detail view with lists, activity, and isolation", async () => {
    const cookie = await signInManager();
    const created = contactResponseSchema.parse(
      await (
        await jsonRequest("alpha.localhost", "/api/organization/contacts", cookie, {
          displayName: "Detail Dana",
          email: "dana@example.test",
          emailStatus: "subscribed",
        })
      ).json(),
    ).contact;
    const list = contactListResponseSchema.parse(
      await (
        await jsonRequest("alpha.localhost", "/api/organization/contact-lists", cookie, {
          name: "Newsletter",
        })
      ).json(),
    ).list;
    expect(
      (
        await jsonRequest(
          "alpha.localhost",
          `/api/organization/contact-lists/${list.id}/members`,
          cookie,
          { contactIds: [created.id] },
        )
      ).status,
    ).toBe(200);

    const detailResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts/${created.id}`, cookie),
    );
    expect(detailResponse.status).toBe(200);
    // The unified view projects relationships without duplicating source
    // records: list names (not full lists), commerce counts (not snapshots),
    // a profile reference (not roster data), and the last sent email marker.
    expect(contactDetailResponseSchema.parse(await detailResponse.json())).toMatchObject({
      activity: { donationCount: 0, ticketPurchaseCount: 0 },
      lastEmailAt: null,
      linkedProfile: null,
      listIds: [list.id],
      lists: [{ id: list.id, name: "Newsletter" }],
    });

    // Cross-tenant: the same contact ID on another Organization's host never
    // exposes the detail, even to that Organization's administrator.
    const bravoCookie = await signInBravoAdmin();
    const crossTenant = await exports.default.fetch(
      apiRequest("bravo.localhost", `/api/organization/contacts/${created.id}`, bravoCookie),
    );
    expect(crossTenant.status).toBe(404);
  });

  it("rejects unauthenticated contact requests", async () => {
    const listResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contacts"),
    );
    expect(listResponse.status).toBe(401);
    expect(await readProblem(listResponse)).toMatchObject({ code: "unauthorized" });

    const createResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts",
      undefined,
      { displayName: "Anonymous" },
    );
    expect(createResponse.status).toBe(401);
    expect(await readProblem(createResponse)).toMatchObject({ code: "unauthorized" });

    const getResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts/${crypto.randomUUID()}`),
    );
    expect(getResponse.status).toBe(401);
  });

  it("denies organization members on every contact route", async () => {
    const cookie = await signInManager();

    const listResponse = await exports.default.fetch(
      apiRequest("bravo.localhost", "/api/organization/contacts", cookie),
    );
    expect(listResponse.status).toBe(403);
    expect(await readProblem(listResponse)).toMatchObject({ code: "forbidden" });

    const createResponse = await jsonRequest(
      "bravo.localhost",
      "/api/organization/contacts",
      cookie,
      { displayName: "Member Attempt" },
    );
    expect(createResponse.status).toBe(403);

    const listsResponse = await exports.default.fetch(
      apiRequest("bravo.localhost", "/api/organization/contact-lists", cookie),
    );
    expect(listsResponse.status).toBe(403);
  });

  it("isolates organizations when a contact ID is reused on another host", async () => {
    const managerCookie = await signInManager();
    const createResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts",
      managerCookie,
      { displayName: "Alpha Alice", email: "alpha.alice@example.test" },
    );
    expect(createResponse.status).toBe(201);
    const contactId = contactResponseSchema.parse(await createResponse.json()).contact.id;

    const bravoCookie = await signInBravoAdmin();
    for (const init of [undefined, { method: "PATCH" as const }, { method: "DELETE" as const }]) {
      const response = await exports.default.fetch(
        apiRequest(
          "bravo.localhost",
          `/api/organization/contacts/${contactId}`,
          bravoCookie,
          init === undefined
            ? undefined
            : { ...init, body: JSON.stringify({ displayName: "Bravo Intruder" }) },
        ),
      );
      expect(response.status).toBe(404);
      const problem = await readProblem(response);
      expect(problem.code).toBe("contact_not_found");
      const serialized = JSON.stringify(problem);
      expect(serialized).not.toContain("alpha.alice@example.test");
      expect(serialized).not.toContain("Alpha Alice");
    }

    const bravoList = contactsResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("bravo.localhost", "/api/organization/contacts", bravoCookie),
        )
      ).json(),
    );
    expect(bravoList.contacts).toEqual([]);
  });

  it("rejects malformed UUIDs without touching storage", async () => {
    const cookie = await signInManager();

    const badContactResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contacts/not-a-uuid", cookie),
    );
    expect(badContactResponse.status).toBe(400);
    expect(await readProblem(badContactResponse)).toMatchObject({ code: "validation_failed" });

    const badListPatch = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contact-lists/not-a-uuid",
      cookie,
      { name: "Nope" },
      "PATCH",
    );
    expect(badListPatch.status).toBe(400);
    expect(await readProblem(badListPatch)).toMatchObject({ code: "validation_failed" });

    const patchResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts/not-a-uuid",
      cookie,
      { displayName: "Nope" },
      "PATCH",
    );
    expect(patchResponse.status).toBe(400);

    const membersResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contact-lists/not-a-uuid/members",
      cookie,
      { contactIds: [crypto.randomUUID()] },
    );
    expect(membersResponse.status).toBe(400);

    const listResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contact-lists",
      cookie,
      { name: "Malformed UUID List" },
    );
    const listId = contactListResponseSchema.parse(await listResponse.json()).list.id;
    const badMemberResponse = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contact-lists/${listId}/members`,
      cookie,
      { contactIds: ["not-a-uuid"] },
    );
    expect(badMemberResponse.status).toBe(400);
    expect(await readProblem(badMemberResponse)).toMatchObject({ code: "validation_failed" });

    const badFilter = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contacts?listId=not-a-uuid", cookie),
    );
    expect(badFilter.status).toBe(400);
  });

  it("rejects malformed request bodies", async () => {
    const cookie = await signInManager();

    const emptyResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts",
      cookie,
      {},
    );
    expect(emptyResponse.status).toBe(400);
    expect(await readProblem(emptyResponse)).toMatchObject({ code: "validation_failed" });

    const emailResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts",
      cookie,
      { email: "not-an-email" },
    );
    expect(emailResponse.status).toBe(400);

    const longResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts",
      cookie,
      { displayName: "x".repeat(201) },
    );
    expect(longResponse.status).toBe(400);

    const created = contactResponseSchema.parse(
      await (
        await jsonRequest("alpha.localhost", "/api/organization/contacts", cookie, {
          displayName: "Patch Patient",
        })
      ).json(),
    ).contact;
    const emptyPatch = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contacts/${created.id}`,
      cookie,
      {},
      "PATCH",
    );
    expect(emptyPatch.status).toBe(400);

    const badStatusPatch = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contacts/${created.id}`,
      cookie,
      { email: "still-bad", emailStatus: "subscribed" },
      "PATCH",
    );
    expect(badStatusPatch.status).toBe(400);
  });

  it("rejects oversized bulk membership requests before mutating", async () => {
    const cookie = await signInManager();
    const listId = contactListResponseSchema.parse(
      await (
        await jsonRequest("alpha.localhost", "/api/organization/contact-lists", cookie, {
          name: "Bulk List",
        })
      ).json(),
    ).list.id;

    const oversized = Array.from({ length: CONTACT_BULK_OPERATION_MAX + 1 }, () =>
      crypto.randomUUID(),
    );
    const response = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contact-lists/${listId}/members`,
      cookie,
      { contactIds: oversized },
    );
    expect(response.status).toBe(400);
    const problem = await readProblem(response);
    expect(problem.code).toBe("validation_failed");
    expect(problem.message).toContain(String(CONTACT_BULK_OPERATION_MAX));

    const filtered = contactsResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", `/api/organization/contacts?listId=${listId}`, cookie),
        )
      ).json(),
    );
    expect(filtered.contacts).toEqual([]);
  });

  it("returns typed errors for missing contacts and lists", async () => {
    const cookie = await signInManager();
    const unknownContact = crypto.randomUUID();
    const unknownList = crypto.randomUUID();

    const getResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts/${unknownContact}`, cookie),
    );
    expect(getResponse.status).toBe(404);
    expect(await readProblem(getResponse)).toMatchObject({ code: "contact_not_found" });

    const filterResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts?listId=${unknownList}`, cookie),
    );
    expect(filterResponse.status).toBe(404);
    expect(await readProblem(filterResponse)).toMatchObject({ code: "contact_list_not_found" });

    const patchList = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contact-lists/${unknownList}`,
      cookie,
      { name: "Ghost" },
      "PATCH",
    );
    expect(patchList.status).toBe(404);

    const deleteList = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contact-lists/${unknownList}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleteList.status).toBe(404);

    const listResponse = contactListResponseSchema.parse(
      await (
        await jsonRequest("alpha.localhost", "/api/organization/contact-lists", cookie, {
          name: "Missing Member List",
        })
      ).json(),
    ).list;
    const missingMember = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contact-lists/${listResponse.id}/members`,
      cookie,
      { contactIds: [unknownContact] },
    );
    expect(missingMember.status).toBe(404);
    expect(await readProblem(missingMember)).toMatchObject({ code: "contact_not_found" });
  });

  it("rejects duplicate contact email with a typed conflict and no storage leak", async () => {
    const cookie = await signInManager();
    const first = await jsonRequest("alpha.localhost", "/api/organization/contacts", cookie, {
      displayName: "Original",
      email: "dupe@example.test",
    });
    expect(first.status).toBe(201);

    const second = await jsonRequest("alpha.localhost", "/api/organization/contacts", cookie, {
      displayName: "Duplicate",
      email: "  DUPE@example.test  ",
    });
    expect(second.status).toBe(409);
    const body: unknown = await second.json();
    expect(problemDetailsSchema.parse(body)).toMatchObject({ code: "contact_duplicate_email" });
    expect(body).toEqual({
      code: "contact_duplicate_email",
      message: expect.any(String),
      requestId: expect.any(String),
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/UNIQUE|SQLITE|constraint/i);
  });

  it("manages lists and memberships without deleting contacts", async () => {
    const cookie = await signInManager();
    const list = contactListResponseSchema.parse(
      await (
        await jsonRequest("alpha.localhost", "/api/organization/contact-lists", cookie, {
          description: "Monthly audience",
          name: "Newsletter",
        })
      ).json(),
    ).list;
    const contact = contactResponseSchema.parse(
      await (
        await jsonRequest("alpha.localhost", "/api/organization/contacts", cookie, {
          displayName: "List Liam",
          email: "liam@example.test",
        })
      ).json(),
    ).contact;

    const addResponse = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contact-lists/${list.id}/members`,
      cookie,
      { contactIds: [contact.id] },
    );
    expect(addResponse.status).toBe(200);
    expect(await addResponse.json()).toMatchObject({ added: 1, listId: list.id });

    const reAddResponse = await jsonRequest(
      "alpha.localhost",
      `/api/organization/contact-lists/${list.id}/members`,
      cookie,
      { contactIds: [contact.id] },
    );
    expect(await reAddResponse.json()).toMatchObject({ added: 0, listId: list.id });

    const filtered = contactsResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", `/api/organization/contacts?listId=${list.id}`, cookie),
        )
      ).json(),
    );
    expect(filtered.contacts.map((entry) => entry.id)).toEqual([contact.id]);

    const removeResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contact-lists/${list.id}/members`, cookie, {
        body: JSON.stringify({ contactIds: [contact.id] }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      }),
    );
    expect(removeResponse.status).toBe(200);
    expect(await removeResponse.json()).toMatchObject({ listId: list.id, removed: 1 });

    const deleteResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contact-lists/${list.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(contactListDeleteResponseSchema.parse(await deleteResponse.json())).toMatchObject({
      listId: list.id,
      status: "deleted",
    });

    // Deleting the list must not delete its former members.
    const surviving = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contacts/${contact.id}`, cookie),
    );
    expect(surviving.status).toBe(200);

    const remaining = contactListsResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/contact-lists", cookie),
        )
      ).json(),
    );
    expect(remaining.lists.map((entry) => entry.id)).not.toContain(list.id);
  });

  it("filters contacts by search query", async () => {
    const cookie = await signInManager();
    for (const displayName of ["Searchable Sam", "Unrelated Uma"]) {
      const response = await jsonRequest("alpha.localhost", "/api/organization/contacts", cookie, {
        displayName,
      });
      expect(response.status).toBe(201);
    }

    const filtered = contactsResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/contacts?query=sam", cookie),
        )
      ).json(),
    );
    expect(filtered.contacts.map((contact) => contact.displayName)).toEqual(["Searchable Sam"]);
  });

  it("rejects contact routes on an unknown hostname", async () => {
    const cookie = await signInManager();
    const response = await exports.default.fetch(
      apiRequest("unknown.localhost", "/api/organization/contacts", cookie),
    );
    expect(response.status).toBe(404);
  });
});
