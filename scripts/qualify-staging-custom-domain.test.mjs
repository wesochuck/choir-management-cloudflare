import { describe, expect, it } from "vitest";

import {
  customDomainHostnames,
  customDomainQualificationPlan,
  safeCustomDomainBoundaryResponsesSafe,
  safeCustomDomainQualificationSummary,
} from "./qualify-staging-custom-domain.mjs";

describe("staging custom-domain qualification helpers", () => {
  it("plans explicit activation, public-only, isolation, and rollback checks", () => {
    expect(customDomainQualificationPlan()).toEqual([
      "require explicitly supplied customer-owned subdomain, apex, and www hostnames",
      "register all three hostnames through the Organization public-domain API",
      "wait for Cloudflare custom-hostname activation and retain only bounded provider status",
      "verify each activated hostname serves the public projection",
      "verify auth and Organization administration routes remain unavailable on each public hostname",
      "verify the wrong Organization cannot read the controlled domain records",
      "disable every controlled hostname and verify provider rollback and routing removal",
      "retain only safe hostname, status, routing, and cleanup evidence; never print provider errors or signed values",
    ]);
  });

  it("normalizes and requires the three related customer hostnames", () => {
    expect(
      customDomainHostnames({
        STAGING_CUSTOM_DOMAIN_APEX: "ExampleCustomer.com.",
        STAGING_CUSTOM_DOMAIN_SUBDOMAIN: "choir.ExampleCustomer.com.",
        STAGING_CUSTOM_DOMAIN_WWW: "www.ExampleCustomer.com.",
      }),
    ).toEqual({
      apex: "examplecustomer.com",
      subdomain: "choir.examplecustomer.com",
      www: "www.examplecustomer.com",
    });
    expect(() =>
      customDomainHostnames({
        STAGING_CUSTOM_DOMAIN_APEX: "examplecustomer.com",
        STAGING_CUSTOM_DOMAIN_SUBDOMAIN: "choir.examplecustomer.com",
        STAGING_CUSTOM_DOMAIN_WWW: "public.examplecustomer.com",
      }),
    ).toThrow("STAGING_CUSTOM_DOMAIN_WWW");
  });

  it("rejects target data on a wrong Organization host while allowing safe empty responses", () => {
    const targetHostnames = ["choir.customer.example", "customer.example", "www.customer.example"];
    expect(
      safeCustomDomainBoundaryResponsesSafe(
        [{ status: 200, body: { domains: [{ hostname: "other.customer.example" }] } }],
        targetHostnames,
      ),
    ).toBe(true);
    expect(
      safeCustomDomainBoundaryResponsesSafe(
        [{ status: 200, body: { domains: [{ hostname: "customer.example" }] } }],
        targetHostnames,
      ),
    ).toBe(false);
    expect(
      safeCustomDomainBoundaryResponsesSafe([{ status: 404, body: null }], targetHostnames),
    ).toBe(true);
  });

  it("returns bounded qualification evidence without provider payloads", () => {
    const summary = safeCustomDomainQualificationSummary({
      activatedDomainCount: 3,
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      providerError: "secret-provider-payload",
      publicProjectionServed: true,
      publicRoutesProtected: true,
      rollbackCompleted: true,
      registeredDomainCount: 3,
      signedValue: "signed-token",
    });
    expect(summary).toEqual({
      activatedDomainCount: 3,
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      publicProjectionServed: true,
      publicRoutesProtected: true,
      rollbackCompleted: true,
      registeredDomainCount: 3,
    });
    expect(JSON.stringify(summary)).not.toContain("secret-provider-payload");
    expect(JSON.stringify(summary)).not.toContain("signed-token");
  });
});
