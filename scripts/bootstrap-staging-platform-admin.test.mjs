import { describe, expect, it } from "vitest";

import {
  buildBootstrapSql,
  normalizeBootstrapEmail,
  normalizeBootstrapName,
  parseBootstrapArguments,
} from "./bootstrap-staging-platform-admin.mjs";

describe("staging Platform Administrator bootstrap", () => {
  it("normalizes the operator-provided identity", () => {
    expect(normalizeBootstrapEmail("  Admin@Example.COM ")).toBe("admin@example.com");
    expect(normalizeBootstrapName("  Platform   Administrator ")).toBe("Platform Administrator");
    expect(() => normalizeBootstrapEmail("not-an-email")).toThrow(/valid/);
    expect(() => normalizeBootstrapName("\u0000hidden")).toThrow(/display name/);
  });

  it("requires explicit identity arguments and exposes no environment selector", () => {
    expect(parseBootstrapArguments(["--help"])).toEqual({ help: true });
    expect(() => parseBootstrapArguments(["--email", "admin@example.com"])).toThrow(/Both/);
    expect(() => parseBootstrapArguments(["--env", "production"])).toThrow(/Unknown option/);
  });

  it("builds an escaped, idempotent grant with conditional audit attribution", () => {
    const sql = buildBootstrapSql({
      email: "o'admin@example.com",
      name: "O'Admin",
      now: new Date("2026-07-20T20:00:00.000Z"),
    });

    expect(sql).toContain("o''admin@example.com");
    expect(sql).toContain("O''Admin");
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).toContain("INSERT OR IGNORE INTO platform_administrators");
    expect(sql).toContain("system:wrangler-bootstrap");
    expect(sql).toContain("platform.administrator.bootstrap_granted");
    expect(sql).toContain("AND changes() = 1");
    expect(sql).not.toContain("password");
  });
});
