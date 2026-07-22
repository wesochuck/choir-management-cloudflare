import { describe, expect, it } from "vitest";

import { crossSubdomainCookieOptions } from "./config";

describe("managed product-domain cookies", () => {
  it("shares sessions only across a managed non-local product namespace", () => {
    expect(crossSubdomainCookieOptions("staging", "staging.musicsite.org")).toEqual({
      domain: ".staging.musicsite.org",
      enabled: true,
    });
    expect(
      crossSubdomainCookieOptions(
        "staging",
        "choir-management-cloudflare-staging.example.workers.dev",
      ),
    ).toEqual({ enabled: false });
    expect(crossSubdomainCookieOptions("local", "localhost")).toEqual({ enabled: false });
  });
});
