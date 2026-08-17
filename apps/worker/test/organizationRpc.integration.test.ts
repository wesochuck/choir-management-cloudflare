import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { invokeOrganizationRpc, organizationStoreStub } from "../src/organization/rpc/client";
import {
  organizationRpcOperationMap,
  parseOrganizationRpcCall,
} from "../src/organization/rpc/types";

const stores = env.ORGANIZATION_STORE;

if (!stores) throw new Error("The ORGANIZATION_STORE integration-test binding is missing.");

afterEach(async () => {
  await reset();
});

describe("Organization RPC boundary", () => {
  it("registers DTO schemas for every RPC domain and rejects non-serializable calls", () => {
    const domains = [
      "calendar",
      "commerce",
      "communication",
      "content",
      "engagement",
      "file",
      "job",
      "lifecycle",
      "operations",
      "profile",
    ] as const;
    for (const domain of domains) {
      const operations = organizationRpcOperationMap[domain];
      expect(Object.keys(operations).length).toBeGreaterThan(0);
      for (const operation of Object.keys(operations)) {
        const definition = operations[operation];
        if (!definition) throw new Error(`Missing RPC definition for ${domain}:${operation}`);
        expect(operation).toMatch(/^(GET|POST) \/internal\//);
        expect(definition.input.safeParse({}).success).toBe(true);
        expect(definition.output.safeParse({}).success).toBe(true);
      }
    }
    expect(
      parseOrganizationRpcCall({
        body: { invalid: Number.NaN },
        domain: "profile",
        method: "GET",
        operation: "GET /internal/profiles",
        path: "/internal/profiles",
      }),
    ).toBeNull();
  });

  it("provisions through structured lifecycle RPC and returns a serializable result", async () => {
    const organizationId = "organization-rpc-lifecycle";
    const result = await organizationStoreStub(env, organizationId).lifecycleRpc({
      body: {
        actorUserId: "rpc-test",
        canonicalHostname: "rpc.localhost",
        canonicalStatus: "active",
        name: "RPC Test Organization",
        organizationId,
        requestId: "11111111-1111-4111-8111-111111111111",
        slug: "rpc-test",
      },
      domain: "lifecycle",
      method: "POST",
      operation: "POST /internal/provision",
      path: "/internal/provision",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.value).toMatchObject({ organizationId });
    }
  });

  it("keeps the existing identity conflict behavior through RPC", async () => {
    const organizationId = "organization-rpc-identity";
    const stub = organizationStoreStub(env, organizationId);
    await stub.lifecycleRpc({
      body: {
        actorUserId: "rpc-test",
        canonicalHostname: "rpc-identity.localhost",
        canonicalStatus: "active",
        name: "RPC Identity Organization",
        organizationId,
        requestId: "22222222-2222-4222-8222-222222222222",
        slug: "rpc-identity",
      },
      domain: "lifecycle",
      method: "POST",
      operation: "POST /internal/provision",
      path: "/internal/provision",
    });

    const result = await stub.profileRpc({
      domain: "profile",
      method: "GET",
      operation: "GET /internal/profiles",
      path: "/internal/profiles",
      query: { organizationId: "organization-other" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(404);
      expect(result.error.body).toMatchObject({ code: "organization_not_found" });
    }
  });

  it("injects the trusted identity for dynamic profile reads", async () => {
    const organizationId = "organization-rpc-profile";
    const stub = organizationStoreStub(env, organizationId);
    await stub.lifecycleRpc({
      body: {
        actorUserId: "rpc-test",
        canonicalHostname: "rpc-profile.localhost",
        canonicalStatus: "active",
        name: "RPC Profile Organization",
        organizationId,
        requestId: "33333333-3333-4333-8333-333333333333",
        slug: "rpc-profile",
      },
      domain: "lifecycle",
      method: "POST",
      operation: "POST /internal/provision",
      path: "/internal/provision",
    });
    const response = await invokeOrganizationRpc(
      stub,
      "https://organization.internal/internal/profiles/44444444-4444-4444-8444-444444444444",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "profile_not_found" });
  });
});
