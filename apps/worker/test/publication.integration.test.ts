import type { PublicWebsiteProjectionPayload } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  publishOrganization,
  publishedProjectionKey,
} from "../src/publication/publishOrganization";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const routingCache = requireBinding(env.ROUTING_CACHE, "ROUTING_CACHE");
const publicationEnv = {
  ORGANIZATION_FILES: organizationFiles,
  ROUTING_CACHE: routingCache,
};

function publicWebsitePayload(heroHeadline: string): PublicWebsiteProjectionPayload {
  return {
    mediaFileIds: [],
    organizationName: "Organization Alpha",
    performances: [],
    settings: {
      aboutUsText: "",
      bodyFont: "system",
      contactEmail: "",
      enabledNavigation: [],
      headerFont: "system",
      heroFileId: null,
      heroHeadline,
      heroSubtitle: "Voices united in harmony.",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    timezone: "UTC",
  };
}

async function seedOrganizationRoutes(): Promise<void> {
  const now = "2026-07-21T12:00:00.000Z";
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, 1, ?, ?)`,
      )
      .bind("organization-alpha", "Organization Alpha", "alpha", "organization-alpha", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, 1, ?, ?)`,
      )
      .bind("organization-bravo", "Organization Bravo", "bravo", "organization-bravo", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind("domain-alpha", "organization-alpha", "alpha.localhost", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind("domain-bravo", "organization-bravo", "bravo.localhost", now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'custom_public', 'active', 1, ?, ?)`,
      )
      .bind("domain-alpha-public", "organization-alpha", "alpha.example.test", now, now),
  ]);
}

async function fetchProjection(hostname: string, headers?: HeadersInit): Promise<Response> {
  return exports.default.fetch(
    new Request(
      `http://${hostname}/api/public/projection`,
      headers === undefined ? undefined : { headers },
    ),
  );
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  await seedOrganizationRoutes();
});

afterEach(async () => {
  await reset();
});

describe("Published Organization projections", () => {
  it("serves immutable versioned projections on canonical and custom public hosts", async () => {
    const versionOneKey = await publishOrganization(publicationEnv, {
      generatedAt: "2026-07-21T12:00:00.000Z",
      organizationId: "organization-alpha",
      payload: publicWebsitePayload("Alpha version one"),
      version: 1,
    });
    await publishOrganization(publicationEnv, {
      generatedAt: "2026-07-21T12:01:00.000Z",
      organizationId: "organization-alpha",
      payload: publicWebsitePayload("Alpha version two"),
      version: 2,
    });

    const canonicalResponse = await fetchProjection("alpha.localhost");
    const canonicalBody: unknown = await canonicalResponse.json();
    expect(canonicalResponse.status).toBe(200);
    expect(canonicalResponse.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
    expect(canonicalBody).toMatchObject({
      organizationId: "organization-alpha",
      payload: { settings: { heroHeadline: "Alpha version two" } },
      version: 2,
    });
    await expect(organizationFiles.head(versionOneKey)).resolves.not.toBeNull();

    const customResponse = await fetchProjection("alpha.example.test");
    expect(customResponse.status).toBe(200);
    const etag = customResponse.headers.get("etag");
    expect(etag).toBeTruthy();
    const notModifiedResponse = await fetchProjection(
      "alpha.example.test",
      etag ? { "if-none-match": etag } : undefined,
    );
    expect(notModifiedResponse.status).toBe(304);
  });

  it("rejects KV and R2 substitutions instead of leaking another Organization's payload", async () => {
    await publishOrganization(publicationEnv, {
      generatedAt: "2026-07-21T12:00:00.000Z",
      organizationId: "organization-alpha",
      payload: publicWebsitePayload("alpha-only"),
      version: 1,
    });
    const bravoKey = await publishOrganization(publicationEnv, {
      generatedAt: "2026-07-21T12:00:00.000Z",
      organizationId: "organization-bravo",
      payload: {
        ...publicWebsitePayload("bravo-only"),
        organizationName: "Organization Bravo",
      },
      version: 1,
    });

    await routingCache.put(
      "published:organization-alpha",
      JSON.stringify({
        key: bravoKey,
        organizationId: "organization-alpha",
        version: 1,
      }),
    );
    const substitutedKeyResponse = await fetchProjection("alpha.localhost");
    const substitutedKeyBody: unknown = await substitutedKeyResponse.json();
    expect(substitutedKeyResponse.status).toBe(404);
    expect(JSON.stringify(substitutedKeyBody)).not.toContain("bravo-only");

    const alphaKey = publishedProjectionKey("organization-alpha", 1);
    await organizationFiles.put(
      alphaKey,
      JSON.stringify({
        generatedAt: "2026-07-21T12:00:00.000Z",
        organizationId: "organization-bravo",
        payload: publicWebsitePayload("bravo-under-alpha-key"),
        version: 1,
      }),
    );
    await routingCache.put(
      "published:organization-alpha",
      JSON.stringify({
        key: alphaKey,
        organizationId: "organization-alpha",
        version: 1,
      }),
    );
    const substitutedBodyResponse = await fetchProjection("alpha.localhost");
    const substitutedBody: unknown = await substitutedBodyResponse.json();
    expect(substitutedBodyResponse.status).toBe(404);
    expect(JSON.stringify(substitutedBody)).not.toContain("bravo-under-alpha-key");

    const bravoResponse = await fetchProjection("bravo.localhost");
    const bravoBody: unknown = await bravoResponse.json();
    expect(bravoResponse.status).toBe(200);
    expect(bravoBody).toMatchObject({
      payload: { settings: { heroHeadline: "bravo-only" } },
    });
  });
});
