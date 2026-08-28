import { describe, expect, it } from "vitest";

import {
  organizationStoreUrl,
  organizationStoreUrlForOrganization,
  storeErrorCode,
  storeErrorStatus,
} from "./repository";

describe("Organization store repository helpers", () => {
  it("extracts the provider error code with the module fallback", async () => {
    await expect(
      storeErrorCode(new Response('{"code":"voice_part_not_configured"}'), "fallback"),
    ).resolves.toBe("voice_part_not_configured");
    await expect(storeErrorCode(new Response("not json"), "fallback")).resolves.toBe("fallback");
    await expect(storeErrorCode(new Response('{"message":"no code"}'), "fallback")).resolves.toBe(
      "fallback",
    );
  });

  it("maps store failure statuses and fails closed otherwise", () => {
    for (const status of [400, 404, 409, 500]) {
      expect(storeErrorStatus(new Response(null, { status }))).toBe(status);
    }
    expect(storeErrorStatus(new Response(null, { status: 403 }))).toBe(503);
    expect(storeErrorStatus(new Response(null, { status: 429 }))).toBe(503);
  });

  it("builds internal store URLs with the supplied parameters", () => {
    const url = organizationStoreUrl("/internal/music/pieces", { page: "2" });
    expect(url.href).toBe("https://organization.internal/internal/music/pieces?page=2");
  });

  it("never lets caller parameters override the trusted Organization identity", () => {
    const url = organizationStoreUrlForOrganization(
      "organization-alpha",
      "/internal/music/pieces",
      { organizationId: "organization-evil", page: "1" },
    );
    expect(url.searchParams.get("organizationId")).toBe("organization-alpha");
    expect(url.searchParams.get("page")).toBe("1");
  });
});
