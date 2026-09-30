import { privateFileResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { privateOrganizationFileKey } from "../src/storage/privateFiles";

const USER_EMAIL = "file.member@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

interface FileAuditRow {
  readonly [column: string]: SqlStorageValue;
  readonly action: string;
  readonly actorId: string;
  readonly targetId: string;
}

const apiRequest = organizationRequest;

async function seedIdentityAndOrganizations(): Promise<void> {
  const nowMs = Date.now();
  await seedAuthUser(controlDatabase, "user-file-member", USER_EMAIL, "File Member");
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-alpha",
    slug: "alpha",
    userId: "user-file-member",
    name: "Organization Alpha",
    role: "member",
  });
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-bravo",
    slug: "bravo",
    userId: "user-file-member",
    name: "Organization Bravo",
    role: "member",
  });
  const now = new Date(nowMs).toISOString();
  await controlDatabase
    .prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES ('domain-alpha-public', 'organization-alpha', 'files.example.test',
         'custom_public', 'active', 1, ?, ?)`,
    )
    .bind(now, now)
    .run();
}

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

async function uploadFile(
  hostname: string,
  cookie: string,
  fileId: string,
  contents: string,
): Promise<Response> {
  const bytes = new TextEncoder().encode(contents);
  return exports.default.fetch(
    apiRequest(hostname, `/api/organization/files/${fileId}`, cookie, {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "text/plain",
        "x-file-name": encodeURIComponent(`${hostname}-notes.txt`),
      },
      method: "PUT",
    }),
  );
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedIdentityAndOrganizations();
});

afterEach(async () => {
  await reset();
});

describe("Private Organization files", () => {
  it("uploads and downloads only through an authorized canonical Organization host", async () => {
    const cookie = await signIn();
    const fileId = "33333333-3333-4333-8333-333333333333";
    const uploadResponse = await uploadFile(
      "alpha.localhost",
      cookie,
      fileId,
      "alpha private contents",
    );
    expect(uploadResponse.status).toBe(201);
    expect(privateFileResponseSchema.parse(await uploadResponse.json())).toMatchObject({
      contentType: "text/plain",
      fileName: "alpha.localhost-notes.txt",
      id: fileId,
      sizeBytes: 22,
    });

    const downloadResponse = await exports.default.fetch(
      apiRequest(
        "alpha.localhost",
        `/api/organization/files/${fileId}?organizationId=organization-bravo`,
        cookie,
      ),
    );
    expect(downloadResponse.status).toBe(200);
    await expect(downloadResponse.text()).resolves.toBe("alpha private contents");
    expect(downloadResponse.headers.get("content-disposition")).toContain(
      "alpha.localhost-notes.txt",
    );
    expect(downloadResponse.headers.get("cache-control")).toBe("no-store");

    const anonymousResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`),
    );
    expect(anonymousResponse.status).toBe(401);
    const customPublicResponse = await exports.default.fetch(
      apiRequest("files.example.test", `/api/organization/files/${fileId}`, cookie),
    );
    expect(customPublicResponse.status).toBe(404);
    await expect(
      organizationFiles.head(privateOrganizationFileKey("organization-alpha", fileId)),
    ).resolves.not.toBeNull();
    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await expect(
      runInDurableObject<OrganizationStore, FileAuditRow | null>(
        organizationStore.get(alphaObjectId),
        (_instance, state) =>
          state.storage.sql
            .exec<FileAuditRow>(
              `SELECT action, actor_id AS actorId, target_id AS targetId
               FROM audit_events WHERE target_id = ? LIMIT 1`,
              fileId,
            )
            .toArray()
            .at(0) ?? null,
      ),
    ).resolves.toEqual({
      action: "organization.file.uploaded",
      actorId: "user-file-member",
      targetId: fileId,
    });
  });

  it("rejects cross-Organization file IDs and poisoned metadata keys", async () => {
    const cookie = await signIn();
    const alphaFileId = "44444444-4444-4444-8444-444444444444";
    const bravoFileId = "55555555-5555-4555-8555-555555555555";
    expect((await uploadFile("alpha.localhost", cookie, alphaFileId, "alpha-only")).status).toBe(
      201,
    );
    expect((await uploadFile("bravo.localhost", cookie, bravoFileId, "bravo-only")).status).toBe(
      201,
    );

    const substitutionResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${bravoFileId}`, cookie),
    );
    expect(substitutionResponse.status).toBe(404);
    expect(await substitutionResponse.text()).not.toContain("bravo-only");

    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(
      organizationStore.get(alphaObjectId),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE private_files SET storage_key = ? WHERE id = ?",
          privateOrganizationFileKey("organization-bravo", bravoFileId),
          alphaFileId,
        );
        return undefined;
      },
    );
    const poisonedMetadataResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${alphaFileId}`, cookie),
    );
    expect(poisonedMetadataResponse.status).toBe(503);
    expect(await poisonedMetadataResponse.text()).not.toContain("bravo-only");
  });

  it("streams multi-chunk uploads to R2 and completes reservation", async () => {
    const cookie = await signIn();
    const fileId = "66666666-6666-4666-8666-666666666666";
    const chunks = [
      new TextEncoder().encode("first chunk - "),
      new TextEncoder().encode("second chunk - "),
      new TextEncoder().encode("final chunk"),
    ];
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        body: stream,
        headers: {
          "content-length": String(totalLength),
          "content-type": "text/plain",
          "x-file-name": encodeURIComponent("streamed-file.txt"),
        },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(201);
    const downloaded = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`, cookie),
    );
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe("first chunk - second chunk - final chunk");
  });

  it("rejects streaming overflow and cleans up R2 and pending reservation", async () => {
    const cookie = await signIn();
    const fileId = "77777777-7777-4777-8777-777777777777";
    const chunks = [
      new TextEncoder().encode("0123456789"),
      new TextEncoder().encode("0123456789"),
      new TextEncoder().encode("extra-overflow-bytes"),
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        body: stream,
        headers: {
          "content-length": "20",
          "content-type": "text/plain",
          "x-file-name": encodeURIComponent("overflow.txt"),
        },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_failed" });

    // Verify R2 object does not exist
    await expect(
      organizationFiles.head(privateOrganizationFileKey("organization-alpha", fileId)),
    ).resolves.toBeNull();

    // Verify DO pending reservation was cleaned up
    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await expect(
      runInDurableObject<OrganizationStore, number>(
        organizationStore.get(alphaObjectId),
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM private_files WHERE id = ?",
              fileId,
            )
            .toArray()[0]?.count ?? 0,
      ),
    ).resolves.toBe(0);
  });

  it("rejects streaming truncation and cleans up R2 and pending reservation", async () => {
    const cookie = await signIn();
    const fileId = "88888888-8888-4888-8888-888888888888";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("short"));
        controller.close();
      },
    });

    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        body: stream,
        headers: {
          "content-length": "100",
          "content-type": "text/plain",
          "x-file-name": encodeURIComponent("truncated.txt"),
        },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_failed" });

    await expect(
      organizationFiles.head(privateOrganizationFileKey("organization-alpha", fileId)),
    ).resolves.toBeNull();

    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await expect(
      runInDurableObject<OrganizationStore, number>(
        organizationStore.get(alphaObjectId),
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM private_files WHERE id = ?",
              fileId,
            )
            .toArray()[0]?.count ?? 0,
      ),
    ).resolves.toBe(0);
  });

  it("cleans up R2 and reservation when client stream aborts with error", async () => {
    const cookie = await signIn();
    const fileId = "99999999-9999-4999-8999-999999999999";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial chunk"));
        controller.error(new Error("client connection dropped"));
      },
    });

    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        body: stream,
        headers: {
          "content-length": "100",
          "content-type": "text/plain",
          "x-file-name": encodeURIComponent("aborted.txt"),
        },
        method: "PUT",
      }),
    );

    expect([400, 503]).toContain(response.status);

    await expect(
      organizationFiles.head(privateOrganizationFileKey("organization-alpha", fileId)),
    ).resolves.toBeNull();

    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await expect(
      runInDurableObject<OrganizationStore, number>(
        organizationStore.get(alphaObjectId),
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM private_files WHERE id = ?",
              fileId,
            )
            .toArray()[0]?.count ?? 0,
      ),
    ).resolves.toBe(0);
  });

  it("rejects reservation conflict when file ID is already in use", async () => {
    const cookie = await signIn();
    const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = await uploadFile("alpha.localhost", cookie, fileId, "first upload");
    expect(first.status).toBe(201);

    const second = await uploadFile("alpha.localhost", cookie, fileId, "second upload");
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "conflict" });
  });

  it("rejects uploads exceeding maximum declared size before reservation", async () => {
    const cookie = await signIn();
    const fileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        body: new Uint8Array([1, 2, 3]),
        headers: {
          "content-length": String(20 * 1024 * 1024 + 1),
          "content-type": "text/plain",
          "x-file-name": encodeURIComponent("oversized.txt"),
        },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_failed" });

    const alphaObjectId = organizationStore.idFromName("organization-alpha");
    await expect(
      runInDurableObject<OrganizationStore, number>(
        organizationStore.get(alphaObjectId),
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM private_files WHERE id = ?",
              fileId,
            )
            .toArray()[0]?.count ?? 0,
      ),
    ).resolves.toBe(0);
  });

  it("supports exact maximum 20 MiB streaming upload with bounded memory", async () => {
    const cookie = await signIn();
    const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const oneMbChunk = new Uint8Array(1024 * 1024);
    let chunksSent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksSent < 20) {
          controller.enqueue(oneMbChunk);
          chunksSent += 1;
        } else {
          controller.close();
        }
      },
    });

    const response = await exports.default.fetch(
      apiRequest("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        body: stream,
        headers: {
          "content-length": String(20 * 1024 * 1024),
          "content-type": "application/octet-stream",
          "x-file-name": encodeURIComponent("max-file.bin"),
        },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(201);
    const parsed = privateFileResponseSchema.parse(await response.json());
    expect(parsed.sizeBytes).toBe(20 * 1024 * 1024);
    expect(parsed.id).toBe(fileId);

    const headResult = await organizationFiles.head(
      privateOrganizationFileKey("organization-alpha", fileId),
    );
    expect(headResult).not.toBeNull();
    expect(headResult?.size).toBe(20 * 1024 * 1024);
  });
});
