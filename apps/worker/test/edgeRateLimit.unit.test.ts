import { describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import {
  buildEdgeRateLimitKey,
  classifyAuthOperation,
  evaluateEdgeRateLimit,
  hashClientIp,
  setEdgeRateLimitTestOverride,
} from "../src/security/edgeRateLimit";

function createMockEnv(overrides: Record<string, unknown>): Env {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only mock environment
  return overrides as unknown as Env;
}

describe("Edge rate limiting unit tests", () => {
  it("hashes client IP with SHA-256 and never includes raw IP in rate limit keys", async () => {
    const rawIp = "198.51.100.42";
    const hashed = await hashClientIp(rawIp);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain(rawIp);

    const keyOrg = await buildEdgeRateLimitKey("ticket_checkout", rawIp, "org_test_1");
    expect(keyOrg).toBe(`org:org_test_1:ticket_checkout:${hashed}`);
    expect(keyOrg).not.toContain(rawIp);

    const keyPlatform = await buildEdgeRateLimitKey("auth:sensitive", rawIp);
    expect(keyPlatform).toBe(`platform:auth:sensitive:${hashed}`);
    expect(keyPlatform).not.toContain(rawIp);
  });

  it("preserves tenant isolation across organization keys", async () => {
    const ip = "203.0.113.195";
    const keyOrgA = await buildEdgeRateLimitKey("ticket_quote", ip, "org_alpha");
    const keyOrgB = await buildEdgeRateLimitKey("ticket_quote", ip, "org_beta");
    expect(keyOrgA).not.toBe(keyOrgB);
    expect(keyOrgA.startsWith("org:org_alpha:")).toBe(true);
    expect(keyOrgB.startsWith("org:org_beta:")).toBe(true);
  });

  it("classifies auth operation routes into low-cardinality classes", () => {
    expect(classifyAuthOperation("/api/auth/sign-in/email")).toBe("auth:sensitive");
    expect(classifyAuthOperation("/api/auth/sign-in/email-otp")).toBe("auth:sensitive");
    expect(classifyAuthOperation("/api/auth/sign-up/email")).toBe("auth:sensitive");
    expect(classifyAuthOperation("/api/auth/email-otp/send-verification-otp")).toBe(
      "auth:sensitive",
    );
    expect(classifyAuthOperation("/api/auth/request-password-reset")).toBe("auth:sensitive");
    expect(classifyAuthOperation("/api/auth/reset-password")).toBe("auth:sensitive");
    expect(classifyAuthOperation("/api/auth/two-factor/verify-totp")).toBe("auth:sensitive");
    expect(classifyAuthOperation("/api/auth/passkey/generate-register-options")).toBe(
      "auth:sensitive",
    );
    expect(classifyAuthOperation("/api/auth/get-session")).toBe("auth:session");
    expect(classifyAuthOperation("/api/auth/organization/list")).toBe("auth:general");
  });

  it("fails fast in staging and production if a rate limit binding is missing", async () => {
    const fakeStagingEnv = createMockEnv({ APP_ENV: "staging" });

    await expect(
      evaluateEdgeRateLimit({
        clientIp: "127.0.0.1",
        env: fakeStagingEnv,
        limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
        operation: "ticket_checkout",
        organizationId: "org_1",
        requestId: "req_1",
      }),
    ).rejects.toThrow(
      "Missing required rate limit binding PUBLIC_MUTATION_RATE_LIMITER in staging",
    );
  });

  it("defaults to allowed in local environment when binding is absent", async () => {
    setEdgeRateLimitTestOverride(null);
    const fakeLocalEnv = createMockEnv({ APP_ENV: "local" });

    const res = await evaluateEdgeRateLimit({
      clientIp: "127.0.0.1",
      env: fakeLocalEnv,
      limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
      operation: "ticket_checkout",
      organizationId: "org_1",
      requestId: "req_1",
    });

    expect(res).toBeNull();
  });

  it("invokes binding limit method when present and handles rejection with structured telemetry", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const mockBinding = {
        limit: vi.fn().mockResolvedValue({ success: false }),
      };
      const envWithBinding = createMockEnv({
        APP_ENV: "local",
        PUBLIC_MUTATION_RATE_LIMITER: mockBinding,
      });

      const res = await evaluateEdgeRateLimit({
        clientIp: "198.51.100.99",
        env: envWithBinding,
        limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
        operation: "ticket_checkout",
        organizationId: "org_123",
        requestId: "req_xyz",
      });

      expect(mockBinding.limit).toHaveBeenCalledOnce();
      expect(res).not.toBeNull();
      expect(res?.status).toBe(429);
      expect(res?.headers.get("retry-after")).toBe("60");
      expect(res?.headers.get("content-type")).toBe("application/json");

      const body = await res?.json();
      expect(body).toEqual({
        code: "public_rate_limit_exceeded",
        message: "Too many checkout requests. Please try again later.",
        requestId: "req_xyz",
      });

      expect(warnSpy).toHaveBeenCalledOnce();
      const firstCallArg = warnSpy.mock.calls[0]?.[0];
      const rawLogged = typeof firstCallArg === "string" ? firstCallArg : "{}";
      expect(JSON.parse(rawLogged)).toEqual({
        environment: "local",
        event: "edge_rate_limit_exceeded",
        limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
        organizationId: "org_123",
        requestId: "req_xyz",
        routeKind: "ticket_checkout",
      });
      // Telemetry must never leak raw IP
      expect(rawLogged).not.toContain("198.51.100.99");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("supports deterministic test overrides for tests without mock bindings", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      setEdgeRateLimitTestOverride((options) => {
        if (options.operation === "auth:sensitive") {
          return { success: false };
        }
        return { success: true };
      });

      const fakeLocalEnv = createMockEnv({ APP_ENV: "local" });

      const resAllowed = await evaluateEdgeRateLimit({
        clientIp: "127.0.0.1",
        env: fakeLocalEnv,
        limiterName: "AUTH_RATE_LIMITER",
        operation: "auth:session",
        requestId: "req_allow",
      });
      expect(resAllowed).toBeNull();

      const resBlocked = await evaluateEdgeRateLimit({
        clientIp: "127.0.0.1",
        env: fakeLocalEnv,
        limiterName: "AUTH_RATE_LIMITER",
        operation: "auth:sensitive",
        requestId: "req_block",
      });
      expect(resBlocked).not.toBeNull();
      expect(resBlocked?.status).toBe(429);
      expect(resBlocked?.headers.get("retry-after")).toBe("60");

      const body = await resBlocked?.json();
      expect(body).toEqual({
        code: "rate_limit_exceeded",
        message: "Too many authentication requests. Please try again later.",
        requestId: "req_block",
      });
    } finally {
      setEdgeRateLimitTestOverride(null);
      warnSpy.mockRestore();
    }
  });
});
