import { organizationDashboardSummaryResponseSchema, setupStatusSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_EMAIL = "calendar.manager@example.test";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

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

describe("Organization setup and lifecycle integration", () => {
  it("keeps the dashboard summary bounded for a large Organization dataset", async () => {
    const cookie = await signIn();
    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?")
      .bind("organization-alpha", "calendar-manager")
      .run();

    const now = new Date("2030-01-01T00:00:00.000Z");
    const createdAt = new Date("2029-12-01T00:00:00.000Z").toISOString();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      for (let offset = 0; offset < 500; offset += 25) {
        const rows = Array.from({ length: 25 }, (_, index) => {
          const sequence = String(offset + index);
          const id = `scale-profile-${sequence}`;
          return [id, `Scale Profile ${sequence}`, createdAt, createdAt] as const;
        });
        const placeholders = rows.map(() => "(?, ?, ?, ?)").join(", ");
        state.storage.sql.exec(
          `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES ${placeholders}`,
          ...rows.flat(),
        );
      }
      for (let offset = 0; offset < 50; offset += 10) {
        const rows = Array.from({ length: 10 }, (_, index) => {
          const sequence = offset + index;
          const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
          return [
            id,
            `Scale Event ${String(sequence)}`,
            "Rehearsal",
            new Date(now.getTime() + (offset + index + 1) * 60_000).toISOString(),
            createdAt,
            createdAt,
          ] as const;
        });
        const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
        state.storage.sql.exec(
          `INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES ${placeholders}`,
          ...rows.flat(),
        );
      }
      return null;
    });

    const startedAt = performance.now();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/dashboard-summary", cookie),
    );
    const elapsedMs = performance.now() - startedAt;
    expect(response.status).toBe(200);
    const summary = organizationDashboardSummaryResponseSchema.parse(await response.json());
    expect(summary.activeProfileCount).toBe(500);
    expect(summary.upcomingEventCount).toBe(50);
    expect(summary.nextEvents).toHaveLength(5);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("preserves a Durable Object setup identity failure instead of masking it as 503", async () => {
    const cookie = await signIn();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE organization_metadata SET organization_id = ?",
          "organization-other",
        );
        return null;
      },
    );
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/setup/status", cookie),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "organization_not_found" });
  });

  it("tracks the optional data import setup step", async () => {
    const cookie = await signIn();
    const progress = await post("alpha.localhost", "/api/setup/progress", cookie, {
      step: "data_import",
    });
    expect(progress.status).toBe(200);

    const status = setupStatusSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/setup/status", cookie))
      ).json(),
    );
    expect(status).toMatchObject({
      completedSteps: ["data_import"],
      currentStep: "data_import",
    });
  });

  it("lets an active member read the low-sensitivity module catalog for navigation", async () => {
    const cookie = await signIn();
    await database
      .prepare("UPDATE member SET role = 'member' WHERE organizationId = ? AND userId = ?")
      .bind("organization-alpha", "calendar-manager")
      .run();

    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/module-state", cookie),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      modules: expect.arrayContaining([expect.objectContaining({ id: "events", enabled: true })]),
    });
  });

  it("claims setup, persists module progress, and completes the Organization lifecycle", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE organization_metadata SET lifecycle_state = 'provisioning' WHERE organization_id = ?",
        "organization-alpha",
      );
      return null;
    });

    const claim = await post("alpha.localhost", "/api/setup/claim", cookie, {});
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({
      claimed: true,
      organizationId: "organization-alpha",
    });

    const progress = await post("alpha.localhost", "/api/setup/progress", cookie, {
      data: { events: true, music_library: true, setlists: false },
      step: "modules",
    });
    expect(progress.status).toBe(200);
    expect(await progress.json()).toEqual({ saved: true });

    const modules = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/module-state", cookie),
    );
    expect(modules.status).toBe(200);
    expect(await modules.json()).toMatchObject({
      modules: expect.arrayContaining([
        expect.objectContaining({ enabled: true, id: "events" }),
        expect.objectContaining({ enabled: true, id: "music_library" }),
        expect.objectContaining({ enabled: false, id: "setlists" }),
      ]),
    });

    const complete = await post("alpha.localhost", "/api/setup/complete", cookie, {});
    expect(complete.status).toBe(200);
    expect(await complete.json()).toEqual({ completed: true });

    const status = setupStatusSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/setup/status", cookie))
      ).json(),
    );
    expect(status).toMatchObject({
      currentStep: null,
      launched: true,
      organizationId: "organization-alpha",
    });
    await expect(
      runInDurableObject<OrganizationStore, { readonly count: number }>(stub, (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE id = ?",
            "setup-completed:organization-alpha",
          )
          .one(),
      ),
    ).resolves.toEqual({ count: 1 });
  });
});
