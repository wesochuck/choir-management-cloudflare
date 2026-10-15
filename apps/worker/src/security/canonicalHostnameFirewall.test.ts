import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCanonicalHostnameWafExpression,
  DEFAULT_FIREWALL_RULE_DESCRIPTION,
  getFakeFirewallState,
  normalizeCanonicalHostname,
  readDesiredCanonicalHostnames,
  reconcileCanonicalHostnameFirewall,
  resetFakeFirewallState,
  type CanonicalHostnameDatabase,
  type CanonicalHostnameFirewallEnv,
} from "./canonicalHostnameFirewall";

function createMockD1(
  hostnames: readonly { readonly hostname: string }[],
): CanonicalHostnameDatabase {
  return {
    prepare: () => ({
      all: async <T = Record<string, unknown>>(): Promise<D1Result<T>> => {
        await Promise.resolve();
        return {
          meta: {
            changed_db: false,
            changes: 0,
            duration: 0,
            last_row_id: 0,
            rows_read: hostnames.length,
            rows_written: 0,
            size_after: 0,
          },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- D1 returns untyped rows; the caller-declared shape is the contract, exactly as in production D1 JSON.
          results: hostnames as unknown as T[],
          success: true,
        };
      },
    }),
  };
}

afterEach(() => {
  resetFakeFirewallState();
  vi.unstubAllGlobals();
});

describe("normalizeCanonicalHostname", () => {
  it("trims whitespace, converts to lowercase, and removes trailing dots", () => {
    expect(normalizeCanonicalHostname("  ExampleChoir.musicsite.org.  ")).toBe(
      "examplechoir.musicsite.org",
    );
    expect(normalizeCanonicalHostname("CHOIR.STAGING.MUSICSITE.ORG")).toBe(
      "choir.staging.musicsite.org",
    );
  });

  it("rejects empty or overlong hostnames (>253 characters)", () => {
    expect(() => normalizeCanonicalHostname("")).toThrow("exceeds allowable length limits");
    expect(() => normalizeCanonicalHostname("   ")).toThrow("exceeds allowable length limits");
    const overlong = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(20)}.org`;
    expect(() => normalizeCanonicalHostname(overlong)).toThrow("exceeds allowable length limits");
  });

  it("rejects overlong labels (>63 characters)", () => {
    const longLabel = `${"a".repeat(64)}.musicsite.org`;
    expect(() => normalizeCanonicalHostname(longLabel)).toThrow("exceeds allowable length");
  });

  it("rejects invalid hostname characters and invalid hyphen positions", () => {
    expect(() => normalizeCanonicalHostname("choir_test.musicsite.org")).toThrow(
      "invalid characters",
    );
    expect(() => normalizeCanonicalHostname("-choir.musicsite.org")).toThrow("invalid characters");
    expect(() => normalizeCanonicalHostname("choir-.musicsite.org")).toThrow("invalid characters");
    expect(() => normalizeCanonicalHostname("choir..musicsite.org")).toThrow(
      "exceeds allowable length",
    );
  });
});

describe("readDesiredCanonicalHostnames", () => {
  it("includes canonical active and pending, excludes disabled and custom_public", async () => {
    const mockDb = createMockD1([
      { hostname: "active1.musicsite.org" },
      { hostname: "pending1.musicsite.org" },
      { hostname: "active2.staging.musicsite.org" },
      { hostname: "tickets.customchoir.org" },
    ]);

    const prodHosts = await readDesiredCanonicalHostnames(mockDb, "musicsite.org", "production");
    expect(prodHosts).toEqual(["active1.musicsite.org", "pending1.musicsite.org"]);

    const stagingHosts = await readDesiredCanonicalHostnames(mockDb, "musicsite.org", "staging");
    expect(stagingHosts).toEqual(["active2.staging.musicsite.org"]);
  });

  it("excludes apex domains from canonical allowlist", async () => {
    const mockDb = createMockD1([
      { hostname: "musicsite.org" },
      { hostname: "staging.musicsite.org" },
      { hostname: "choir.musicsite.org" },
    ]);

    const prodHosts = await readDesiredCanonicalHostnames(mockDb, "musicsite.org", "production");
    expect(prodHosts).toEqual(["choir.musicsite.org"]);

    const stagingHosts = await readDesiredCanonicalHostnames(mockDb, "musicsite.org", "staging");
    expect(stagingHosts).toEqual([]);
  });
});

describe("buildCanonicalHostnameWafExpression", () => {
  it("builds production WAF expression targeting *.base and excluding staging", () => {
    const emptyExpr = buildCanonicalHostnameWafExpression({
      appEnv: "production",
      hostnames: [],
      productBaseDomain: "musicsite.org",
    });
    expect(emptyExpr).toBe(
      '(http.host wildcard "*.musicsite.org" and not (http.host eq "staging.musicsite.org" or http.host wildcard "*.staging.musicsite.org"))',
    );

    const expr = buildCanonicalHostnameWafExpression({
      appEnv: "production",
      hostnames: ["alpha.musicsite.org", "bravo.musicsite.org"],
      productBaseDomain: "musicsite.org",
    });
    expect(expr).toBe(
      '(http.host wildcard "*.musicsite.org" and not (http.host eq "staging.musicsite.org" or http.host wildcard "*.staging.musicsite.org") and not lower(http.host) in {"alpha.musicsite.org" "bravo.musicsite.org"})',
    );
  });

  it("builds staging WAF expression targeting *.staging.base", () => {
    const emptyExpr = buildCanonicalHostnameWafExpression({
      appEnv: "staging",
      hostnames: [],
      productBaseDomain: "musicsite.org",
    });
    expect(emptyExpr).toBe('(http.host wildcard "*.staging.musicsite.org")');

    const expr = buildCanonicalHostnameWafExpression({
      appEnv: "staging",
      hostnames: ["alpha.staging.musicsite.org"],
      productBaseDomain: "musicsite.org",
    });
    expect(expr).toBe(
      '(http.host wildcard "*.staging.musicsite.org" and not lower(http.host) in {"alpha.staging.musicsite.org"})',
    );
  });

  it("throws safety error if expression exceeds maximum allowed length without publishing partial set", () => {
    const manyHostnames = Array.from(
      { length: 250 },
      (_, i) => `tenant-${i.toString().padStart(4, "0")}.musicsite.org`,
    );
    expect(() =>
      buildCanonicalHostnameWafExpression({
        appEnv: "production",
        hostnames: manyHostnames,
        productBaseDomain: "musicsite.org",
      }),
    ).toThrow("exceeds safety limit of 4000 characters");
  });
});

describe("reconcileCanonicalHostnameFirewall in fake and disabled modes", () => {
  it("does not mutate state when mode is disabled", async () => {
    const mockDb = createMockD1([]);
    const env: CanonicalHostnameFirewallEnv = {
      APP_ENV: "staging",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "disabled",
      CONTROL_DB: mockDb,
      PRODUCT_BASE_DOMAIN: "staging.musicsite.org",
    };

    const result = await reconcileCanonicalHostnameFirewall(env);
    expect(result.mode).toBe("disabled");
    expect(result.changed).toBe(false);
    expect(getFakeFirewallState()).toBeNull();
  });

  it("updates fake state idempotently and defaults action to log in staging", async () => {
    const mockDb = createMockD1([{ hostname: "choir.staging.musicsite.org" }]);

    const env: CanonicalHostnameFirewallEnv = {
      APP_ENV: "staging",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "fake",
      CONTROL_DB: mockDb,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };

    const firstRun = await reconcileCanonicalHostnameFirewall(env);
    expect(firstRun.changed).toBe(true);
    expect(firstRun.action).toBe("log");
    expect(firstRun.desiredHostnameCount).toBe(1);

    const fakeState = getFakeFirewallState();
    expect(fakeState?.description).toBe(DEFAULT_FIREWALL_RULE_DESCRIPTION);
    expect(fakeState?.action).toBe("log");
    expect(fakeState?.expression).toContain("choir.staging.musicsite.org");

    const secondRun = await reconcileCanonicalHostnameFirewall(env);
    expect(secondRun.changed).toBe(false);
  });

  it("defaults action to block in production", async () => {
    const mockDb = createMockD1([{ hostname: "choir.musicsite.org" }]);

    const env: CanonicalHostnameFirewallEnv = {
      APP_ENV: "production",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "fake",
      CONTROL_DB: mockDb,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };

    const result = await reconcileCanonicalHostnameFirewall(env);
    expect(result.action).toBe("block");
    expect(getFakeFirewallState()?.action).toBe("block");
  });
});

describe("reconcileCanonicalHostnameFirewall with Cloudflare API", () => {
  it("fails closed when credentials are missing in cloudflare-inline mode", async () => {
    const mockDb = createMockD1([]);
    const env: CanonicalHostnameFirewallEnv = {
      APP_ENV: "production",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "cloudflare-inline",
      CONTROL_DB: mockDb,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };

    await expect(reconcileCanonicalHostnameFirewall(env)).rejects.toThrow(
      "Cloudflare WAF credentials (CLOUDFLARE_WAF_API_TOKEN, CLOUDFLARE_WAF_ZONE_ID) are missing.",
    );
  });

  it("updates existing rule via PATCH when expression changes", async () => {
    const mockDb = createMockD1([{ hostname: "tenant1.musicsite.org" }]);

    const requests: {
      readonly body: string | undefined;
      readonly method: string;
      readonly url: string;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const requestBody = typeof init?.body === "string" ? init.body : undefined;
        requests.push({ body: requestBody, method: init?.method ?? "GET", url });

        if (init?.method === "PATCH") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                errors: [],
                messages: [],
                result: {
                  action: "block",
                  description: DEFAULT_FIREWALL_RULE_DESCRIPTION,
                  enabled: true,
                  expression: "updated-expr",
                  id: "rule-abc",
                },
                success: true,
              }),
              { headers: { "content-type": "application/json" }, status: 200 },
            ),
          );
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [],
              messages: [],
              result: {
                action: "block",
                description: DEFAULT_FIREWALL_RULE_DESCRIPTION,
                enabled: true,
                expression: "old-expr",
                id: "rule-abc",
              },
              success: true,
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
        );
      }),
    );

    const env: CanonicalHostnameFirewallEnv = {
      APP_ENV: "production",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "cloudflare-inline",
      CLOUDFLARE_WAF_API_TOKEN: "secret-token",
      CLOUDFLARE_WAF_RULE_ID: "rule-abc",
      CLOUDFLARE_WAF_RULESET_ID: "ruleset-123",
      CLOUDFLARE_WAF_ZONE_ID: "zone-xyz",
      CONTROL_DB: mockDb,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };

    const result = await reconcileCanonicalHostnameFirewall(env);
    expect(result.changed).toBe(true);
    expect(result.ruleId).toBe("rule-abc");
    expect(requests).toHaveLength(2);
    const [req0, req1] = requests;
    expect(req0?.method).toBe("GET");
    expect(req1?.method).toBe("PATCH");
    expect(req1?.url).toContain("/zones/zone-xyz/rulesets/ruleset-123/rules/rule-abc");
  });

  it("handles Cloudflare 429 rate limit error gracefully and marks as retryable", async () => {
    const mockDb = createMockD1([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [{ message: "Rate limit exceeded" }],
              messages: [],
              success: false,
            }),
            { headers: { "content-type": "application/json" }, status: 429 },
          ),
        ),
      ),
    );

    const env: CanonicalHostnameFirewallEnv = {
      APP_ENV: "production",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "cloudflare-inline",
      CLOUDFLARE_WAF_API_TOKEN: "secret-token",
      CLOUDFLARE_WAF_RULE_ID: "rule-abc",
      CLOUDFLARE_WAF_RULESET_ID: "ruleset-123",
      CLOUDFLARE_WAF_ZONE_ID: "zone-xyz",
      CONTROL_DB: mockDb,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };

    await expect(reconcileCanonicalHostnameFirewall(env)).rejects.toMatchObject({
      message: "Rate limit exceeded",
      retryable: true,
      status: 429,
    });
  });

  it("handles malformed JSON envelopes safely", async () => {
    const mockDb = createMockD1([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("Invalid non-json response", {
            headers: { "content-type": "text/html" },
            status: 502,
          }),
        ),
      ),
    );

    const env: CanonicalHostnameFirewallEnv = {
      APP_ENV: "production",
      CANONICAL_HOSTNAME_FIREWALL_MODE: "cloudflare-inline",
      CLOUDFLARE_WAF_API_TOKEN: "secret-token",
      CLOUDFLARE_WAF_RULE_ID: "rule-abc",
      CLOUDFLARE_WAF_RULESET_ID: "ruleset-123",
      CLOUDFLARE_WAF_ZONE_ID: "zone-xyz",
      CONTROL_DB: mockDb,
      PRODUCT_BASE_DOMAIN: "musicsite.org",
    };

    await expect(reconcileCanonicalHostnameFirewall(env)).rejects.toMatchObject({
      message: expect.stringContaining(
        "Cloudflare WAF returned an invalid JSON response structure",
      ),
      retryable: true,
      status: 502,
    });
  });
});
