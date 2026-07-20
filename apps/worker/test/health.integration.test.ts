import { healthResponseSchema } from "@choir/contracts";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
  });

  it("returns typed API not-found responses without falling through to static assets", async () => {
    const response = await exports.default.fetch(
      new Request("https://choir-management.local/api/not-a-route"),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "not_found" });
  });
});
