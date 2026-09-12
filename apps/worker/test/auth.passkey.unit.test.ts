import { describe, expect, it } from "vitest";
import { resolveRpId } from "../src/auth/passkeyConfig";

describe("passkey RP ID resolution", () => {
  it("resolves localhost for localhost base domain and local subdomains", () => {
    expect(resolveRpId("localhost", new URL("http://localhost:5173/login"))).toBe("localhost");
    expect(resolveRpId("localhost", new URL("http://alpha.localhost:5173/login"))).toBe(
      "localhost",
    );
  });

  it("resolves product base domain for root and canonical subdomains", () => {
    expect(resolveRpId("choir.example", new URL("https://choir.example/login"))).toBe(
      "choir.example",
    );
    expect(resolveRpId("choir.example", new URL("https://alpha.choir.example/login"))).toBe(
      "choir.example",
    );
    expect(resolveRpId("choir.example", new URL("https://bravo.choir.example/login"))).toBe(
      "choir.example",
    );
  });

  it("resolves exact staging hostname on custom staging domain", () => {
    expect(
      resolveRpId("staging.choir.example", new URL("https://staging.choir.example/login")),
    ).toBe("staging.choir.example");
    expect(
      resolveRpId("staging.choir.example", new URL("https://alpha.staging.choir.example/login")),
    ).toBe("staging.choir.example");
  });

  it("resolves specific workers.dev host instead of eTLD workers.dev", () => {
    expect(
      resolveRpId(
        "choir-staging.workers.dev",
        new URL("https://choir-staging.workers.dev/api/auth"),
      ),
    ).toBe("choir-staging.workers.dev");
    expect(
      resolveRpId("choir-staging.workers.dev", new URL("https://choir-staging.workers.dev/login")),
    ).not.toBe("workers.dev");
  });

  it("rejects custom public domains for authenticated account operations", () => {
    expect(() => resolveRpId("choir.example", new URL("https://customchoir.org/login"))).toThrow(
      "Custom public domain customchoir.org cannot be used",
    );

    expect(() => resolveRpId("localhost", new URL("https://evil.com/login"))).toThrow(
      "Hostname evil.com is not a valid auth host for localhost base domain.",
    );

    expect(() =>
      resolveRpId("choir-staging.workers.dev", new URL("https://other.workers.dev/login")),
    ).toThrow("Hostname other.workers.dev is not a valid auth host on choir-staging.workers.dev.");
  });
});
