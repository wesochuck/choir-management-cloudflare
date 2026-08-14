import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteCustomHostname,
  ensureCustomHostname,
  type CustomDomainProviderEnv,
} from "./customDomainProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("custom-domain provider adapter", () => {
  it("activates a hostname through the local fake provider without network access", async () => {
    const environment = {
      CUSTOM_DOMAIN_PROVIDER_MODE: "fake",
    } satisfies CustomDomainProviderEnv;

    await expect(
      ensureCustomHostname(environment, {
        hostname: "tickets.example.test",
        providerHostnameId: null,
      }),
    ).resolves.toEqual({
      providerHostnameId: "fake-tickets-example-test",
      providerSslStatus: "active",
      providerStatus: "active",
      validationRecords: [],
    });
  });

  it("fails closed when provider onboarding is disabled or unconfigured", async () => {
    const disabledEnvironment = {
      CUSTOM_DOMAIN_PROVIDER_MODE: "disabled",
    } satisfies CustomDomainProviderEnv;
    const cloudflareEnvironment = {
      CUSTOM_DOMAIN_PROVIDER_MODE: "cloudflare",
    } satisfies CustomDomainProviderEnv;

    await expect(
      ensureCustomHostname(disabledEnvironment, {
        hostname: "tickets.example.test",
        providerHostnameId: null,
      }),
    ).rejects.toMatchObject({
      message: "Custom public-domain onboarding is disabled.",
      retryable: false,
    });
    await expect(
      ensureCustomHostname(cloudflareEnvironment, {
        hostname: "tickets.example.test",
        providerHostnameId: null,
      }),
    ).rejects.toMatchObject({
      message: "Cloudflare for SaaS custom-hostname credentials are not configured.",
      retryable: false,
    });
  });

  it("normalizes Cloudflare validation records and sends scoped authorization", async () => {
    const requests: { readonly init: RequestInit | undefined; readonly url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push({ init, url });
        return new Response(
          JSON.stringify({
            errors: [],
            result: url.includes("?hostname=")
              ? []
              : {
                  hostname: "tickets.example.test",
                  id: "cf-hostname-123",
                  ssl: {
                    status: "PENDING",
                    validation_records: [
                      {
                        txt_name: "_cf-custom-hostname.tickets.example.test",
                        txt_value: "validation-token",
                      },
                    ],
                  },
                  status: "pending",
                },
            success: true,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
    );
    const environment = {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_CUSTOM_HOSTNAMES_ZONE_ID: "zone-123",
      CUSTOM_DOMAIN_PROVIDER_MODE: "cloudflare",
    } satisfies CustomDomainProviderEnv;

    await expect(
      ensureCustomHostname(environment, {
        hostname: "tickets.example.test",
        providerHostnameId: null,
      }),
    ).resolves.toEqual({
      providerHostnameId: "cf-hostname-123",
      providerSslStatus: "PENDING",
      providerStatus: "pending",
      validationRecords: [
        {
          name: "_cf-custom-hostname.tickets.example.test",
          type: "txt",
          value: "validation-token",
        },
      ],
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames?hostname=tickets.example.test",
    );
    expect(requests[1]?.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames",
    );
    expect(requests[1]?.init?.method).toBe("POST");
    expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe("Bearer test-token");
  });

  it("treats an already-removed Cloudflare hostname as successfully deleted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response(null, { status: 404 })),
    );
    const environment = {
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_CUSTOM_HOSTNAMES_ZONE_ID: "zone-123",
      CUSTOM_DOMAIN_PROVIDER_MODE: "cloudflare",
    } satisfies CustomDomainProviderEnv;

    await expect(deleteCustomHostname(environment, "cf-hostname-123")).resolves.toBeUndefined();
  });
});
