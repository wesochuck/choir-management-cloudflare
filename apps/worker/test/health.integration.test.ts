import { healthResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "../src/router";
import { MAX_JSON_BODY_BYTES } from "../src/routes/helpers";

describe("Worker foundation", () => {
  it("permits Google Ads only when the public content policy is selected", () => {
    expect(buildContentSecurityPolicy("test")).not.toContain("googletagmanager.com");
    const policy = buildContentSecurityPolicy("test", true);
    expect(policy).toContain("https://www.googletagmanager.com");
    expect(policy).toContain("https://www.googleadservices.com");
    expect(policy).toContain("https://googleads.g.doubleclick.net");
    expect(policy).not.toContain("'unsafe-inline'; script");
    expect(policy).not.toContain("'unsafe-eval'");
  });
  it("serves a validated health response through the Worker runtime with dynamic nonce CSP", async () => {
    const response1 = await exports.default.fetch(
      new Request("https://choir-management.local/api/health"),
    );
    const body: unknown = await response1.json();

    expect(response1.status).toBe(200);
    expect(healthResponseSchema.parse(body)).toMatchObject({
      environment: "local",
      service: "choir-management-cloudflare",
      status: "ok",
    });
    expect(response1.headers.get("x-content-type-options")).toBe("nosniff");
    const csp1 = response1.headers.get("content-security-policy") ?? "";
    expect(csp1).toMatch(
      /script-src 'self' 'wasm-unsafe-eval' 'nonce-[0-9a-f]{32}' https:\/\/static\.cloudflareinsights\.com https:\/\/challenges\.cloudflare\.com/,
    );
    expect(csp1).toContain("https://static.cloudflareinsights.com");
    expect(csp1).toContain("https://challenges.cloudflare.com");
    expect(csp1).toContain("https://cloudflareinsights.com");
    expect(csp1).not.toContain("script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'");

    const response2 = await exports.default.fetch(
      new Request("https://choir-management.local/api/health"),
    );
    const csp2 = response2.headers.get("content-security-policy") ?? "";
    expect(csp2).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'nonce-[0-9a-f]{32}'/);
    expect(csp1).not.toBe(csp2);
  });

  it("returns typed API not-found responses without falling through to static assets", async () => {
    const response = await exports.default.fetch(
      new Request("https://choir-management.local/api/not-a-route"),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "not_found" });
  });

  it("serves the SPA shell through the Worker security-header path with nonce-based CSP", async () => {
    const response = await exports.default.fetch(
      // Platform sign-in serves the shell without a tenant registry. Foreign hosts
      // intentionally require registry resolution for the custom-domain handoff.
      new Request(`https://${env.PRODUCT_BASE_DOMAIN}/login`, {
        headers: { "sec-fetch-mode": "navigate" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'nonce-[0-9a-f]{32}'/);
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("applies route-specific CSP and referrer headers across public, ticket, login, and checkout HTML routes", async () => {
    for (const path of ["/", "/performances", "/tickets", "/tickets/order/success"]) {
      const response = await exports.default.fetch(
        new Request(`https://${env.PRODUCT_BASE_DOMAIN}${path}`, {
          headers: { "sec-fetch-mode": "navigate" },
        }),
      );
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("no-cache");
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("https://www.googletagmanager.com");
      expect(csp, path).toContain("https://www.googleadservices.com");
      expect(csp, path).toContain("https://googleads.g.doubleclick.net");
    }

    const donateResponse = await exports.default.fetch(
      new Request(`https://${env.PRODUCT_BASE_DOMAIN}/donate`, {
        headers: { "sec-fetch-mode": "navigate" },
      }),
    );
    expect(donateResponse.status).toBe(200);
    expect(donateResponse.headers.get("content-security-policy") ?? "").not.toContain(
      "googletagmanager.com",
    );

    const checkoutResponse = await exports.default.fetch(
      new Request(`https://${env.PRODUCT_BASE_DOMAIN}/checkout/return`, {
        headers: { "sec-fetch-mode": "navigate" },
      }),
    );
    expect(checkoutResponse.status).toBe(200);
    expect(checkoutResponse.headers.get("cache-control")).toBe("no-cache");
    expect(checkoutResponse.headers.get("referrer-policy")).toBe("no-referrer");
    expect(checkoutResponse.headers.get("content-security-policy") ?? "").not.toContain(
      "googletagmanager.com",
    );
  });

  it("rejects oversized JSON request bodies before route parsing", async () => {
    const response = await exports.default.fetch(
      new Request("https://choir-management.local/api/not-a-route", {
        body: "x".repeat(MAX_JSON_BODY_BYTES + 1),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(413);
    expect(body).toMatchObject({ code: "request_body_too_large" });
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'nonce-[0-9a-f]{32}'/);
  });
});
