import {
  contactImportConfirmResponseSchema,
  contactImportErrorCsvResponseSchema,
  contactImportJobStatusResponseSchema,
  contactImportMappingResponseSchema,
  contactImportPreviewResponseSchema,
  contactImportUploadResponseSchema,
  contactListResponseSchema,
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

const MANAGER_EMAIL = "contact-import.manager@example.test";
const BRAVO_ADMIN_EMAIL = "contact-import.bravo.admin@example.test";

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

const csvRequest = (hostname: string, path: string, cookie: string | undefined, csv: string) =>
  exports.default.fetch(
    apiRequest(hostname, path, cookie, {
      body: csv,
      headers: { "content-type": "text/csv" },
      method: "POST",
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

async function createList(cookie: string, name: string): Promise<string> {
  const response = await jsonRequest("alpha.localhost", "/api/organization/contact-lists", cookie, {
    name,
  });
  expect(response.status).toBe(201);
  return contactListResponseSchema.parse(await response.json()).list.id;
}

async function processViaStub(importId: string): Promise<void> {
  const stub = organizationStore.getByName("organization-alpha");
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const result = await stub.processContactImportBatch({
      actorUserId: "contact-manager",
      batchSize: 200,
      importId,
      organizationId: "organization-alpha",
      requestId: crypto.randomUUID(),
    });
    if (result.completed) return;
  }
  throw new Error("The staged import did not complete in the test runtime.");
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "contact-import-manager", MANAGER_EMAIL, "Import Manager");
  await seedAuthUser(
    controlDatabase,
    "contact-import-bravo-admin",
    BRAVO_ADMIN_EMAIL,
    "Bravo Admin",
  );
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-alpha",
    name: "Organization Alpha",
    role: "admin",
    slug: "alpha",
    userId: "contact-import-manager",
  });
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-bravo",
    name: "Organization Bravo",
    role: "member",
    slug: "bravo",
    userId: "contact-import-manager",
  });
  await controlDatabase
    .prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      "member-import-bravo-admin",
      "organization-bravo",
      "contact-import-bravo-admin",
      "admin",
      Date.now(),
    )
    .run();
});

afterEach(async () => {
  await reset();
});

describe("Organization contact import API", () => {
  it("runs upload, mapping, preview, confirm, and async processing end to end", async () => {
    const cookie = await signInManager();
    const listId = await createList(cookie, "Newsletter");

    const seedResponse = await jsonRequest(
      "alpha.localhost",
      "/api/organization/contacts",
      cookie,
      {
        displayName: "Existing Eve",
        email: "eve@example.test",
      },
    );
    expect(seedResponse.status).toBe(201);

    const csv = [
      "First Name,Email",
      "Jane,jane@example.test",
      "Eve,eve@example.test",
      "Jane Dup,  JANE@example.test ",
      "Bad,not-an-email",
    ].join("\n");
    const uploadResponse = await csvRequest(
      "alpha.localhost",
      "/api/organization/contact-imports?filename=members.csv",
      cookie,
      csv,
    );
    expect(uploadResponse.status).toBe(201);
    const uploaded = contactImportUploadResponseSchema.parse(await uploadResponse.json());
    expect(uploaded.headers).toEqual(["First Name", "Email"]);
    expect(uploaded.rowCount).toBe(4);
    expect(uploaded.status).toBe("staged");
    const importId = uploaded.importId;

    const mappingResponse = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/contact-imports/${importId}/mapping`,
        cookie,
        {
          body: JSON.stringify({ listIds: [listId], mapping: ["firstName", "email"] }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        },
      ),
    );
    expect(mappingResponse.status).toBe(200);
    expect(contactImportMappingResponseSchema.parse(await mappingResponse.json())).toMatchObject({
      importId,
      status: "staged",
    });

    const previewResponse = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/contact-imports/${importId}/preview`,
        cookie,
      ),
    );
    expect(previewResponse.status).toBe(200);
    const previewed = contactImportPreviewResponseSchema.parse(await previewResponse.json());
    expect(previewed).toMatchObject({
      existingMatches: 1,
      inFileDuplicates: 1,
      invalidRows: 1,
      newContacts: 1,
      rowsRead: 4,
    });

    const confirmResponse = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/contact-imports/${importId}/confirm`,
        cookie,
        {
          method: "POST",
        },
      ),
    );
    expect(confirmResponse.status).toBe(200);
    const confirmed = contactImportConfirmResponseSchema.parse(await confirmResponse.json());
    expect(confirmed.idempotencyKey).toBe(`contact-import:${importId}`);

    // The queue consumer drains the same bounded batches in production; the
    // test runtime drives the identical Durable Object RPC directly.
    await processViaStub(importId);

    const statusResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contact-imports/${importId}`, cookie),
    );
    expect(statusResponse.status).toBe(200);
    const status = contactImportJobStatusResponseSchema.parse(await statusResponse.json());
    expect(status).toMatchObject({
      contactsCreated: 1,
      contactsUpdated: 1,
      existingMatches: 1,
      importId,
      inFileDuplicates: 1,
      invalidRows: 1,
      membershipsAdded: 2,
      status: "completed",
    });

    const errorsResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contact-imports/${importId}/errors`, cookie),
    );
    expect(errorsResponse.status).toBe(200);
    const errors = contactImportErrorCsvResponseSchema.parse(await errorsResponse.json());
    expect(errors.rowCount).toBe(2);
    expect(errors.csv).toContain("not-an-email");

    const listResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contacts?query=jane", cookie),
    );
    const listed = contactsResponseSchema.parse(await listResponse.json());
    expect(listed.contacts.map((contact) => contact.normalizedEmail)).toEqual([
      "jane@example.test",
    ]);

    // Replaying the exact same confirmed job performs zero new mutations.
    const stub = organizationStore.getByName("organization-alpha");
    const replay = await stub.processContactImportBatch({
      actorUserId: "contact-manager",
      batchSize: 200,
      importId,
      organizationId: "organization-alpha",
      requestId: crypto.randomUUID(),
    });
    expect(replay.completed).toBe(true);
    expect(replay.processedThisBatch).toBe(0);
    const reread = contactImportJobStatusResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", `/api/organization/contact-imports/${importId}`, cookie),
        )
      ).json(),
    );
    expect(reread.contactsCreated).toBe(status.contactsCreated);
    expect(reread.membershipsAdded).toBe(status.membershipsAdded);

    const eveResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contacts?query=eve", cookie),
    );
    expect(
      contactsResponseSchema.parse(await eveResponse.json()).contacts.map((contact) => contact.id),
    ).toHaveLength(1);
  });

  it("rejects unauthenticated and member import requests", async () => {
    const uploadResponse = await csvRequest(
      "alpha.localhost",
      "/api/organization/contact-imports",
      undefined,
      "Email\na@example.test\n",
    );
    expect(uploadResponse.status).toBe(401);
    expect(await readProblem(uploadResponse)).toMatchObject({ code: "unauthorized" });

    const cookie = await signInManager();
    const memberUpload = await csvRequest(
      "bravo.localhost",
      "/api/organization/contact-imports",
      cookie,
      "Email\na@example.test\n",
    );
    expect(memberUpload.status).toBe(403);
    expect(await readProblem(memberUpload)).toMatchObject({ code: "forbidden" });
  });

  it("isolates staged imports across organizations", async () => {
    const managerCookie = await signInManager();
    const listId = await createList(managerCookie, "Newsletter");
    const uploadResponse = await csvRequest(
      "alpha.localhost",
      "/api/organization/contact-imports",
      managerCookie,
      "Email\na@example.test\n",
    );
    expect(uploadResponse.status).toBe(201);
    const importId = contactImportUploadResponseSchema.parse(await uploadResponse.json()).importId;

    const bravoCookie = await signInBravoAdmin();
    const crossRead = await exports.default.fetch(
      apiRequest("bravo.localhost", `/api/organization/contact-imports/${importId}`, bravoCookie),
    );
    expect(crossRead.status).toBe(404);
    expect(await readProblem(crossRead)).toMatchObject({ code: "contact_import_not_found" });

    // A foreign list ID can never be smuggled through mapping: existence is
    // checked inside the owning organization's Durable Object.
    const foreignMapping = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/contact-imports/${importId}/mapping`,
        managerCookie,
        {
          body: JSON.stringify({ listIds: [crypto.randomUUID()], mapping: ["email"] }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        },
      ),
    );
    expect(foreignMapping.status).toBe(404);
    expect(await readProblem(foreignMapping)).toMatchObject({ code: "contact_list_not_found" });
    expect(listId).toBeTruthy();
  });

  it("validates upload boundaries and the confirm/cancel lifecycle", async () => {
    const cookie = await signInManager();

    const wrongType = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contact-imports", cookie, {
        body: JSON.stringify({ email: "a@example.test" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(wrongType.status).toBe(400);

    const oversized = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contact-imports", cookie, {
        body: "Email\na@example.test\n",
        headers: { "content-length": String(6 * 1024 * 1024), "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(oversized.status).toBe(413);

    const empty = await csvRequest(
      "alpha.localhost",
      "/api/organization/contact-imports",
      cookie,
      "\n",
    );
    expect(empty.status).toBe(400);

    const malformedId = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contact-imports/not-a-uuid", cookie),
    );
    expect(malformedId.status).toBe(400);

    const uploadResponse = await csvRequest(
      "alpha.localhost",
      "/api/organization/contact-imports",
      cookie,
      "Email\na@example.test\n",
    );
    expect(uploadResponse.status).toBe(201);
    const importId = contactImportUploadResponseSchema.parse(await uploadResponse.json()).importId;

    const earlyConfirm = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/contact-imports/${importId}/confirm`,
        cookie,
        {
          method: "POST",
        },
      ),
    );
    expect(earlyConfirm.status).toBe(409);
    expect(await readProblem(earlyConfirm)).toMatchObject({ code: "contact_import_conflict" });

    const cancelResponse = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/contact-imports/${importId}/cancel`,
        cookie,
        {
          method: "POST",
        },
      ),
    );
    expect(cancelResponse.status).toBe(200);

    const afterCancel = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/contact-imports/${importId}`, cookie),
    );
    expect(afterCancel.status).toBe(404);

    const contactsResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/contacts", cookie),
    );
    expect(contactsResponseSchema.parse(await contactsResponse.json()).contacts).toEqual([]);
  });
});
