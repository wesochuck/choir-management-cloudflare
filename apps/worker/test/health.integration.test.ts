import { healthResponseSchema } from "@choir/contracts";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY } from "../src/router";
import { MAX_JSON_BODY_BYTES } from "../src/routes/helpers";

describe("Worker foundation", () => {
  it("serves a validated health response through the Worker runtime", async () => {
    const response = await exports.default.fetch(
      new Request("https://choir-management.local/api/health"),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(body)).toMatchObject({
      environment: "local",
      service: "choir-management-cloudflare",
      status: "ok",
    });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
  });

  it("returns typed API not-found responses without falling through to static assets", async () => {
    const response = await exports.default.fetch(
      new Request("https://choir-management.local/api/not-a-route"),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "not_found" });
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
    expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
  });
});
