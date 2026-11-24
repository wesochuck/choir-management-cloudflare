import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { checkPublicCheckoutRateLimit } from "../organization/checkoutRateLimit";
import {
  createContactTestAdapter,
  DEFAULT_CONTACT_TEST_ORG_ID,
} from "../organization/contactTestkit";
import { organizationSchemaMigrations } from "../organization/schema/migrations";
import { preflightCheckoutRequest } from "../routes/helpers/checkoutPreflight";
import { verifyTurnstileToken } from "./turnstile";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createCheckoutTestEnv(overrides: {
  readonly APP_ENV: Env["APP_ENV"];
  readonly EXTERNAL_EFFECTS_MODE: Env["EXTERNAL_EFFECTS_MODE"];
  readonly TURNSTILE_SECRET_KEY?: string | undefined;
}): Env {
  const db = new DatabaseSync(":memory:");
  const adapter = createContactTestAdapter(db);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      adapter.storage.sql.exec(statement);
    }
  }
  adapter.storage.sql.exec(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, timezone, created_at, updated_at)
     VALUES (?, 'Test Choir', 'test-choir', 'America/New_York', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    DEFAULT_CONTACT_TEST_ORG_ID,
  );

  const stub = {
    async operationsRpc(call: {
      readonly body?: unknown;
      readonly method: string;
      readonly path: string;
    }) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only structural SQLite adapter
      const storage = adapter.storage as unknown as DurableObjectStorage;
      const response = checkPublicCheckoutRateLimit(storage, call.body);
      const parsedBody: unknown = await response.json().catch(() => null);
      const headers = Object.fromEntries(response.headers.entries());
      if (response.ok) {
        return { headers, ok: true as const, status: response.status, value: parsedBody };
      }
      return {
        error: { body: parsedBody, headers, status: response.status },
        ok: false as const,
      };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only mock environment
  return {
    APP_ENV: overrides.APP_ENV,
    EXTERNAL_EFFECTS_MODE: overrides.EXTERNAL_EFFECTS_MODE,
    ORGANIZATION_STORE: {
      getByName: () => stub,
    },
    PUBLIC_MUTATION_RATE_LIMITER: {
      limit: () => Promise.resolve({ success: true }),
    },
    TURNSTILE_SECRET_KEY: overrides.TURNSTILE_SECRET_KEY,
  } as unknown as Env;
}

describe("verifyTurnstileToken (SEC-07)", () => {
  it("allows simulated verification only in local fake-effect mode when secret is missing or blank", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const secret of [undefined, "", "   "]) {
      const env = {
        APP_ENV: "local" as const,
        EXTERNAL_EFFECTS_MODE: "fake" as const,
        TURNSTILE_SECRET_KEY: secret,
      };
      expect(await verifyTurnstileToken(env, "valid-turnstile-token", "198.51.100.10")).toBe(true);
      expect(await verifyTurnstileToken(env, "invalid-token", "198.51.100.10")).toBe(false);
      expect(await verifyTurnstileToken(env, "fail-token", "198.51.100.10")).toBe(false);
      expect(
        await verifyTurnstileToken(env, "2x0000000000000000000000000000000AA", "198.51.100.10"),
      ).toBe(false);
      expect(await verifyTurnstileToken(env, "", "198.51.100.10")).toBe(false);
      expect(await verifyTurnstileToken(env, undefined, "198.51.100.10")).toBe(false);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when secret is missing or blank in staging, production, or non-fake local modes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const failClosedConfigs: readonly {
      readonly APP_ENV: Env["APP_ENV"];
      readonly EXTERNAL_EFFECTS_MODE: Env["EXTERNAL_EFFECTS_MODE"];
    }[] = [
      { APP_ENV: "staging", EXTERNAL_EFFECTS_MODE: "sandbox" },
      { APP_ENV: "staging", EXTERNAL_EFFECTS_MODE: "fake" },
      { APP_ENV: "staging", EXTERNAL_EFFECTS_MODE: "disabled" },
      { APP_ENV: "production", EXTERNAL_EFFECTS_MODE: "sandbox" },
      { APP_ENV: "production", EXTERNAL_EFFECTS_MODE: "fake" },
      { APP_ENV: "production", EXTERNAL_EFFECTS_MODE: "disabled" },
      { APP_ENV: "local", EXTERNAL_EFFECTS_MODE: "sandbox" },
      { APP_ENV: "local", EXTERNAL_EFFECTS_MODE: "disabled" },
    ];

    for (const config of failClosedConfigs) {
      for (const secret of [undefined, "", "   \t  "]) {
        const verified = await verifyTurnstileToken(
          { ...config, TURNSTILE_SECRET_KEY: secret },
          "valid-turnstile-token",
          "198.51.100.20",
        );
        expect(verified).toBe(false);
      }
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies tokens against the Turnstile siteverify provider when a secret is configured", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const stagingEnv = {
      APP_ENV: "staging" as const,
      EXTERNAL_EFFECTS_MODE: "sandbox" as const,
      TURNSTILE_SECRET_KEY: "  turnstile-secret-test  ",
    };

    expect(await verifyTurnstileToken(stagingEnv, "  client-token  ", "203.0.113.5")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    if (!(body instanceof URLSearchParams)) {
      throw new Error("Expected URLSearchParams request body");
    }
    expect(body.get("secret")).toBe("turnstile-secret-test");
    expect(body.get("response")).toBe("client-token");
    expect(body.get("remoteip")).toBe("203.0.113.5");

    fetchMock.mockResolvedValueOnce(Response.json({ success: false }, { status: 200 }));
    expect(await verifyTurnstileToken(stagingEnv, "bad-token", "203.0.113.5")).toBe(false);

    fetchMock.mockResolvedValueOnce(new Response("upstream error", { status: 500 }));
    expect(await verifyTurnstileToken(stagingEnv, "client-token", "203.0.113.5")).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error("network failure"));
    expect(await verifyTurnstileToken(stagingEnv, "client-token", "203.0.113.5")).toBe(false);
  });

  it("blocks challenge-required hosted checkout when Turnstile secret is missing or provider rejects", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    for (const appEnv of ["staging", "production"] as const) {
      for (const secret of [undefined, "   "]) {
        const testEnv = createCheckoutTestEnv({
          APP_ENV: appEnv,
          EXTERNAL_EFFECTS_MODE: "sandbox",
          TURNSTILE_SECRET_KEY: secret,
        });
        const clientIp = "198.51.100.77";

        // First 5 requests pass before hitting the challenge threshold.
        for (let i = 1; i <= 5; i += 1) {
          const blocked = await preflightCheckoutRequest(
            testEnv,
            DEFAULT_CONTACT_TEST_ORG_ID,
            "ticket_checkout",
            crypto.randomUUID(),
            `buyer${String(i)}@example.test`,
            clientIp,
            undefined,
            crypto.randomUUID(),
          );
          expect(blocked).toBeNull();
        }

        // 6th request requires challenge and must fail closed even with a supplied token.
        const blocked = await preflightCheckoutRequest(
          testEnv,
          DEFAULT_CONTACT_TEST_ORG_ID,
          "ticket_checkout",
          crypto.randomUUID(),
          "buyer6@example.test",
          clientIp,
          "valid-turnstile-token",
          crypto.randomUUID(),
        );
        expect(blocked).not.toBeNull();
        expect(blocked?.status).toBe(403);
        expect(await blocked?.json()).toMatchObject({ code: "invalid_challenge_token" });
      }
    }

    expect(fetchMock).not.toHaveBeenCalled();

    // With a configured secret in production, checkout proceeds only when provider verifies.
    const configuredEnv = createCheckoutTestEnv({
      APP_ENV: "production",
      EXTERNAL_EFFECTS_MODE: "sandbox",
      TURNSTILE_SECRET_KEY: "prod-secret",
    });
    const clientIp = "198.51.100.88";
    for (let i = 1; i <= 5; i += 1) {
      expect(
        await preflightCheckoutRequest(
          configuredEnv,
          DEFAULT_CONTACT_TEST_ORG_ID,
          "donation_checkout",
          crypto.randomUUID(),
          `donor${String(i)}@example.test`,
          clientIp,
          undefined,
          crypto.randomUUID(),
        ),
      ).toBeNull();
    }

    fetchMock.mockResolvedValueOnce(Response.json({ success: false }, { status: 200 }));
    const rejected = await preflightCheckoutRequest(
      configuredEnv,
      DEFAULT_CONTACT_TEST_ORG_ID,
      "donation_checkout",
      crypto.randomUUID(),
      "donor6@example.test",
      clientIp,
      "rejected-by-provider",
      crypto.randomUUID(),
    );
    expect(rejected?.status).toBe(403);
    expect(await rejected?.json()).toMatchObject({ code: "invalid_challenge_token" });

    fetchMock.mockResolvedValueOnce(Response.json({ success: true }, { status: 200 }));
    const allowed = await preflightCheckoutRequest(
      configuredEnv,
      DEFAULT_CONTACT_TEST_ORG_ID,
      "donation_checkout",
      crypto.randomUUID(),
      "donor6@example.test",
      clientIp,
      "verified-by-provider",
      crypto.randomUUID(),
    );
    expect(allowed).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
