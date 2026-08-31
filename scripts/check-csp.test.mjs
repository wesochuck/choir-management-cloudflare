import { describe, expect, it } from "vitest";

import { extractBaselineFromRouter, parseDirectives, validateStaticCsp } from "./check-csp.mjs";

const sampleRouter = `
export function buildContentSecurityPolicy(nonce?: string): string {
  const scriptDirective = nonce
    ? \`script-src 'self' 'nonce-\${nonce}' https://static.cloudflareinsights.com https://challenges.cloudflare.com\`
    : "script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    scriptDirective,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com",
    "frame-src 'self' https://challenges.cloudflare.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}
`;

const validHeaders = `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'
`;

describe("CSP verification check", () => {
  it("parses directives properly into a map", () => {
    const directives = parseDirectives("default-src 'self'; script-src 'self' https://example.com");
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual(["'self'", "https://example.com"]);
  });

  it("extracts baseline directives from router source", () => {
    const baseline = extractBaselineFromRouter(sampleRouter);
    expect(baseline).toContain("default-src 'self'");
    expect(baseline).toContain("frame-ancestors 'none'");
    expect(baseline).toContain(
      "script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
    );
  });

  it("passes when static _headers matches router baseline and strict policies", () => {
    const result = validateStaticCsp(validHeaders, sampleRouter);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when Content-Security-Policy header is missing", () => {
    const result = validateStaticCsp("/*\n  X-Frame-Options: DENY\n", sampleRouter);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Content-Security-Policy header is missing");
  });

  it("fails when frame-ancestors 'none' is violated", () => {
    const invalidHeaders = validHeaders.replace("frame-ancestors 'none'", "frame-ancestors *");
    const result = validateStaticCsp(invalidHeaders, sampleRouter);
    expect(result.ok).toBe(false);
    expect(result.errors.some((err) => err.includes("frame-ancestors 'none'"))).toBe(true);
  });

  it("fails when object-src 'none' is missing", () => {
    const invalidHeaders = validHeaders.replace("object-src 'none';", "");
    const result = validateStaticCsp(invalidHeaders, sampleRouter);
    expect(result.ok).toBe(false);
    expect(result.errors.some((err) => err.includes("object-src 'none'"))).toBe(true);
  });

  it("fails when Cloudflare Insights origins are omitted", () => {
    const invalidHeaders = validHeaders.replace("https://static.cloudflareinsights.com", "");
    const result = validateStaticCsp(invalidHeaders, sampleRouter);
    expect(result.ok).toBe(false);
    expect(result.errors.some((err) => err.includes("static.cloudflareinsights.com"))).toBe(true);
  });

  it("fails when Turnstile origins are omitted", () => {
    const invalidHeaders = validHeaders.replace(
      "frame-src 'self' https://challenges.cloudflare.com",
      "frame-src 'self'",
    );
    const result = validateStaticCsp(invalidHeaders, sampleRouter);
    expect(result.ok).toBe(false);
    expect(result.errors.some((err) => err.includes("challenges.cloudflare.com"))).toBe(true);
  });
});
