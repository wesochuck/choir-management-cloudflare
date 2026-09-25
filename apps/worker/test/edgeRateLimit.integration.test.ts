import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { setEdgeRateLimitTestOverride } from "../src/security/edgeRateLimit";
import {
  api,
  setupTicketingIntegration,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(async () => {
  setEdgeRateLimitTestOverride(null);
  await setupTicketingIntegration();
});

afterEach(async () => {
  setEdgeRateLimitTestOverride(null);
  await teardownTicketingIntegration();
});

async function getDoRateLimitBucketCount(orgId: string): Promise<number> {
  const stub = stores.get(stores.idFromName(orgId));
  return runInDurableObject<OrganizationStore, number>(stub, (_instance, state) => {
    const rows = state.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM public_rate_limit_buckets")
      .toArray();
    return rows[0]?.count ?? 0;
  });
}

describe("Edge rate limiting integration tests", () => {
  it("rejects ticket quote at the edge before invoking Organization DO rate limit RPC or writing SQL buckets", async () => {
    // 1. First verify with edge limiter rejecting
    setEdgeRateLimitTestOverride((opts) => {
      if (opts.limiterName === "PUBLIC_READ_RATE_LIMITER" && opts.operation === "ticket_quote") {
        return { success: false };
      }
      return { success: true };
    });

    const quotePayload = {
      bundleId: null,
      eventId: crypto.randomUUID(),
      quantity: 2,
    };

    const rejectedRes = await exports.default.fetch(
      api("alpha.localhost", "/api/public/tickets/quote", undefined, {
        body: JSON.stringify(quotePayload),
        headers: {
          "cf-connecting-ip": "198.51.100.1",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(rejectedRes.status).toBe(429);
    expect(rejectedRes.headers.get("retry-after")).toBe("60");
    const rejectedBody = await rejectedRes.json();
    expect(rejectedBody).toMatchObject({
      code: "public_rate_limit_exceeded",
      message: "Too many ticket quote requests. Please try again later.",
    });

    // Verify 0 rows in public_rate_limit_buckets in DO storage!
    const bucketCount = await getDoRateLimitBucketCount("organization-alpha");
    expect(bucketCount).toBe(0);

    // 2. Now allow and verify normal traffic proceeds into DO
    setEdgeRateLimitTestOverride(null);

    const allowedRes = await exports.default.fetch(
      api("alpha.localhost", "/api/public/tickets/quote", undefined, {
        body: JSON.stringify(quotePayload),
        headers: {
          "cf-connecting-ip": "198.51.100.1",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    // It reached DO (ticket price calculation for unknown event gives 404 or 422, but crucially passed rate limit into DO)
    expect(allowedRes.status).not.toBe(429);
    // DO rate limit bucket was written!
    const bucketCountAfter = await getDoRateLimitBucketCount("organization-alpha");
    expect(bucketCountAfter).toBeGreaterThan(0);
  });

  it("rejects ticket checkout at the edge before DO reservation or counter writes", async () => {
    setEdgeRateLimitTestOverride((opts) => {
      if (
        opts.limiterName === "PUBLIC_MUTATION_RATE_LIMITER" &&
        opts.operation === "ticket_checkout"
      ) {
        return { success: false };
      }
      return { success: true };
    });

    const checkoutPayload = {
      buyerEmail: "buyer@example.com",
      buyerName: "Buyer Person",
      checkoutRequestId: crypto.randomUUID(),
      eventId: crypto.randomUUID(),
      quantity: 1,
    };

    const res = await exports.default.fetch(
      api("alpha.localhost", "/api/public/tickets/checkout", undefined, {
        body: JSON.stringify(checkoutPayload),
        headers: {
          "cf-connecting-ip": "198.51.100.2",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    const body = await res.json();
    expect(body).toMatchObject({
      code: "public_rate_limit_exceeded",
      message: "Too many checkout requests. Please try again later.",
    });

    // Zero rate limit buckets created in DO
    const bucketCount = await getDoRateLimitBucketCount("organization-alpha");
    expect(bucketCount).toBe(0);
  });

  it("rejects donation checkout at the edge before DO reservation or Stripe work", async () => {
    setEdgeRateLimitTestOverride((opts) => {
      if (
        opts.limiterName === "PUBLIC_MUTATION_RATE_LIMITER" &&
        opts.operation === "donation_checkout"
      ) {
        return { success: false };
      }
      return { success: true };
    });

    const donationPayload = {
      amountCents: 5000,
      buyerEmail: "donor@example.com",
      buyerName: "Generous Donor",
      checkoutRequestId: crypto.randomUUID(),
      frequency: "one_time",
    };

    const res = await exports.default.fetch(
      api("alpha.localhost", "/api/public/donations/checkout", undefined, {
        body: JSON.stringify(donationPayload),
        headers: {
          "cf-connecting-ip": "198.51.100.3",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    const body = await res.json();
    expect(body).toMatchObject({
      code: "public_rate_limit_exceeded",
      message: "Too many checkout requests. Please try again later.",
    });

    const bucketCount = await getDoRateLimitBucketCount("organization-alpha");
    expect(bucketCount).toBe(0);
  });

  it("rejects audition inquiries at the edge before D1 email check and DO rate limit RPC", async () => {
    setEdgeRateLimitTestOverride((opts) => {
      if (
        opts.limiterName === "PUBLIC_MUTATION_RATE_LIMITER" &&
        opts.operation === "audition_inquiry"
      ) {
        return { success: false };
      }
      return { success: true };
    });

    const auditionPayload = {
      availabilityNotes: "Evenings",
      email: "singer@example.com",
      experience: "Choir for 5 years",
      name: "Singer Person",
      phone: "555-0100",
      requestedSlots: ["2026-10-01T10:00:00Z"],
      voicePart: "Tenor",
    };

    const res = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-inquiry", undefined, {
        body: JSON.stringify(auditionPayload),
        headers: {
          "cf-connecting-ip": "198.51.100.4",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    const body = await res.json();
    expect(body).toMatchObject({
      code: "public_rate_limit_exceeded",
      message: "Too many audition inquiries. Please try again later.",
    });

    const bucketCount = await getDoRateLimitBucketCount("organization-alpha");
    expect(bucketCount).toBe(0);
  });

  it("rejects auth traffic at the edge before Better Auth touches D1", async () => {
    setEdgeRateLimitTestOverride((opts) => {
      if (opts.limiterName === "AUTH_RATE_LIMITER") {
        return { success: false };
      }
      return { success: true };
    });

    // 1. Sensitive auth endpoint: sign-in
    const signInRes = await exports.default.fetch(
      api("alpha.localhost", "/api/auth/sign-in/email", undefined, {
        body: JSON.stringify({ email: "test@example.com", password: "password123" }),
        headers: {
          "cf-connecting-ip": "198.51.100.5",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(signInRes.status).toBe(429);
    expect(signInRes.headers.get("retry-after")).toBe("60");
    const signInBody = await signInRes.json();
    expect(signInBody).toMatchObject({
      code: "rate_limit_exceeded",
      message: "Too many authentication requests. Please try again later.",
    });

    // 2. Session check endpoint
    const sessionRes = await exports.default.fetch(
      api("alpha.localhost", "/api/auth/get-session", undefined, {
        headers: {
          "cf-connecting-ip": "198.51.100.5",
        },
        method: "GET",
      }),
    );

    expect(sessionRes.status).toBe(429);
    expect(sessionRes.headers.get("retry-after")).toBe("60");
    const sessionBody = await sessionRes.json();
    expect(sessionBody).toMatchObject({
      code: "rate_limit_exceeded",
      message: "Too many authentication requests. Please try again later.",
    });
  });

  it("preserves tenant isolation so rejections for one organization do not block another", async () => {
    // Only reject organization-alpha
    setEdgeRateLimitTestOverride((opts) => {
      if (opts.organizationId === "organization-alpha") {
        return { success: false };
      }
      return { success: true };
    });

    const quotePayload = {
      bundleId: null,
      eventId: crypto.randomUUID(),
      quantity: 2,
    };

    // Organization alpha is rejected
    const alphaRes = await exports.default.fetch(
      api("alpha.localhost", "/api/public/tickets/quote", undefined, {
        body: JSON.stringify(quotePayload),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(alphaRes.status).toBe(429);

    // Organization bravo is NOT rejected by edge rate limiter
    const bravoRes = await exports.default.fetch(
      api("bravo.localhost", "/api/public/tickets/quote", undefined, {
        body: JSON.stringify(quotePayload),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(bravoRes.status).not.toBe(429);
  });
});
