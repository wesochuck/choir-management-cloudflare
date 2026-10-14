import {
  organizationExportStartResponseSchema,
  organizationExportStatusResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { processDeliveryBatch } from "../src/jobs/consumer";
import { organizationExportSnapshotSchema } from "../src/jobs/deliveries/shared";
import { organizationExportKey } from "../src/organization/exportStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_EMAIL = "calendar.manager@example.test";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireIntegrationBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

const api = organizationRequest;

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

const post = (host: string, path: string, cookie: string, body: unknown) =>
  writeJson(exports.default, host, path, cookie, body);

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Calendar Manager",
    email: USER_EMAIL,
    organizations: [
      { id: "organization-alpha", name: "Organization Alpha", slug: "alpha" },
      { id: "organization-bravo", name: "Organization Bravo", slug: "bravo" },
    ],
    userId: "calendar-manager",
  });
});

afterEach(async () => {
  await teardownOrganizationIntegration();
});

describe("Organization export integration", () => {
  it("queues, completes, downloads, and replays an asynchronous Organization export", async () => {
    const cookie = await signIn();
    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?")
      .bind("organization-alpha", "calendar-manager")
      .run();

    const started = await post("alpha.localhost", "/api/organization/export", cookie, {
      format: "json",
    });
    expect(started.status).toBe(202);
    const startedBody = await started.json();
    const exportId = organizationExportStartResponseSchema.parse(startedBody).exportId;

    const queued = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/export/${exportId}`, cookie),
    );
    expect(organizationExportStatusResponseSchema.parse(await queued.json()).status).toBe("queued");

    const message = {
      attempts: 1,
      body: {
        attempt: 1,
        idempotencyKey: `organization-export:${exportId}`,
        jobId: exportId,
        kind: "organization_export",
        organizationId: "organization-alpha",
        version: 1,
      },
      id: `export-${exportId}`,
      timestamp: new Date("2026-07-21T12:00:00.000Z"),
    } as const;
    const batch = createMessageBatch("choir-management-jobs-local", [message]);
    const executionContext = createExecutionContext();
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    await getQueueResult(batch, executionContext);

    const completed = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/export/${exportId}`, cookie),
    );
    const completedBody = organizationExportStatusResponseSchema.parse(await completed.json());
    expect(completedBody).toMatchObject({ status: "completed", exportId });
    const auditActorTypes = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly actorType: string }>(
            `SELECT actor_type AS actorType FROM audit_events
             WHERE target_id = ? AND action IN ('organization.export.requested', 'organization.export.completed')
             ORDER BY action`,
            exportId,
          )
          .toArray()
          .map(({ actorType }) => actorType),
    );
    expect(auditActorTypes).toEqual(["organization_member", "organization_member"]);
    const downloaded = await exports.default.fetch(
      api("alpha.localhost", completedBody.downloadUrl ?? "/missing", cookie),
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toMatch(
      /^attachment; filename="organization-export-[a-f0-9-]+_[0-9]{4}-[A-Z][a-z]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}-(AM|PM)-UTC\.json"$/,
    );
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("x-export-checksum-sha256")).toBe(completedBody.checksumSha256);
    const downloadedArchive: unknown = await downloaded.json();
    expect(downloadedArchive).toMatchObject({
      manifest: expect.objectContaining({
        byteCount: completedBody.byteCount,
        checksumSha256: completedBody.checksumSha256,
        exportVersion: 1,
        organizationId: "organization-alpha",
      }),
      payload: expect.objectContaining({
        exportVersion: 1,
        organizationId: "organization-alpha",
        records: expect.any(Object),
      }),
    });

    const replay = createMessageBatch("choir-management-jobs-local", [
      { ...message, id: `export-replay-${exportId}` },
    ]);
    await processDeliveryBatch(replay, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    await getQueueResult(replay, executionContext);
    expect(
      organizationExportStatusResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/export/${exportId}`, cookie),
          )
        ).json(),
      ).status,
    ).toBe("completed");
  });

  it("fails oversized exports with explicit safety counts before writing an archive", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.transactionSync(() => {
        for (let index = 0; index < 10_001; index += 1) {
          const suffix = String(index).padStart(5, "0");
          state.storage.sql.exec(
            `INSERT INTO audit_events
                (id, actor_type, actor_id, action, target_type, target_id,
                 request_id, change_summary, occurred_at)
               VALUES (?, 'system', 'export-test', 'export.test', 'export_test', ?, ?, '{}', ?)`,
            `export-overflow-${suffix}`,
            `export-overflow-${suffix}`,
            crypto.randomUUID(),
            now,
          );
        }
      });
      return undefined;
    });
    const createResponse = await stub.fetch(
      "https://organization.internal/internal/export/create",
      {
        body: JSON.stringify({
          actorType: "organization_member",
          actorUserId: "calendar-manager",
          format: "json",
          organizationId: "organization-alpha",
          requestId: "99999999-9999-4999-8999-999999999999",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const created = organizationExportStartResponseSchema
      .pick({ exportId: true })
      .parse(await createResponse.json());
    expect(createResponse.status).toBe(200);
    expect(created.exportId).toMatch(/^[0-9a-f-]{36}$/);

    const snapshotResponse = await stub.fetch(
      "https://organization.internal/internal/export/snapshot?organizationId=organization-alpha",
    );
    const snapshot = organizationExportSnapshotSchema.parse(await snapshotResponse.json());
    expect(snapshotResponse.status).toBe(200);
    expect(snapshot.safety.tooLarge).toBe(true);
    expect(snapshot.safety.tableCounts.audit_events).toBeGreaterThan(10_000);
    expect(snapshot.records.audit_events).toHaveLength(10_000);

    const message = {
      attempts: 1,
      body: {
        attempt: 1,
        idempotencyKey: `organization-export:${created.exportId}`,
        jobId: created.exportId,
        kind: "organization_export",
        organizationId: "organization-alpha",
        version: 1,
      },
      id: `oversized-export-${created.exportId}`,
      timestamp: new Date("2026-07-21T12:00:00.000Z"),
    } as const;
    const batch = createMessageBatch("choir-management-jobs-local", [message]);
    const executionContext = createExecutionContext();
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    const queueResult = await getQueueResult(batch, executionContext);
    expect(queueResult).toMatchObject({ retryMessages: expect.any(Array) });

    const statusResponse = await stub.fetch(
      `https://organization.internal/internal/export/job?organizationId=organization-alpha&exportId=${created.exportId}`,
    );
    expect(await statusResponse.json()).toMatchObject({
      errorCode: "export_too_large",
      status: "failed",
    });
    await expect(
      organizationFiles.head(organizationExportKey("organization-alpha", created.exportId)),
    ).resolves.toBeNull();
  });

  it("cleans up an archive when export completion is rejected after the write", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const createResponse = await stub.fetch(
      "https://organization.internal/internal/export/create",
      {
        body: JSON.stringify({
          actorType: "organization_member",
          actorUserId: "calendar-manager",
          format: "json",
          organizationId: "organization-alpha",
          requestId: "88888888-8888-4888-8888-888888888888",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const exportId = organizationExportStartResponseSchema
      .pick({ exportId: true })
      .parse(await createResponse.json()).exportId;
    const failingFiles: R2Bucket = {
      ...organizationFiles,
      put: async (...args: Parameters<R2Bucket["put"]>) => {
        const result = await organizationFiles.put(...args);
        await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
          state.storage.sql.exec("DELETE FROM organization_exports WHERE id = ?", exportId);
          return undefined;
        });
        return result;
      },
    };
    const message = {
      attempts: 1,
      body: {
        attempt: 1,
        idempotencyKey: `organization-export:${exportId}`,
        jobId: exportId,
        kind: "organization_export",
        organizationId: "organization-alpha",
        version: 1,
      },
      id: `completion-rejection-${exportId}`,
      timestamp: new Date("2026-07-21T12:00:00.000Z"),
    } as const;
    const batch = createMessageBatch("choir-management-jobs-local", [message]);
    const executionContext = createExecutionContext();
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: failingFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    const queueResult = await getQueueResult(batch, executionContext);
    expect(queueResult).toMatchObject({ retryMessages: expect.any(Array) });
    await expect(
      organizationFiles.head(organizationExportKey("organization-alpha", exportId)),
    ).resolves.toBeNull();
  });
});
