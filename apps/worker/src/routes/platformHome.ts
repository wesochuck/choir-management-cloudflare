import {
  MAX_PLATFORM_HOME_TICKET_LISTINGS,
  platformHomeTicketListingsResponseSchema,
  platformInquiryRequestSchema,
  platformInquiryResponseSchema,
  publishedOrganizationProjectionSchema,
  type PlatformHomeTicketListing,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { sendPlatformEmail } from "../auth/platformEmail";
import { validateStartupConfig } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { evaluateEdgeRateLimit } from "../security/edgeRateLimit";
import { verifyTurnstileToken } from "../security/turnstile";
import type { WorkerHonoEnvironment } from "./helpers";

// Bounded directory scan: only the first 100 active organizations in
// (name, id) order are considered per feed generation, so organizations past
// this cutoff never appear. Each organization contributes at most one
// hostname, so multi-domain orgs cannot starve others. Raise the bound or
// paginate (e.g. keyset over (name, id) with merged partial caches) if the
// platform outgrows a single bounded scan.
const MAX_ORGANIZATIONS_TICKET_SCAN = 100;
const RPC_CONCURRENCY_LIMIT = 6;
// Complete feeds cache for the normal five minutes. Partial feeds (any tenant
// fetch failed) cache only briefly to bound per-request RPC fan-out during an
// outage without serving a stale incomplete feed for the full TTL.
const COMPLETE_TICKET_FEED_CACHE_TTL_SECONDS = 300;
const PARTIAL_TICKET_FEED_CACHE_TTL_SECONDS = 60;

interface OrganizationDomainRow {
  readonly domainKind: "canonical" | "custom_public";
  readonly hostname: string;
  readonly organizationId: string;
  readonly organizationName: string;
}

interface PlatformAdminRow {
  readonly email: string;
  readonly name: string;
}

interface PreferredOrganization {
  readonly hostname: string;
  readonly organizationId: string;
  readonly organizationName: string;
}

interface OrganizationFetchResult {
  readonly organizationId: string;
  readonly listings: PlatformHomeTicketListing[];
  readonly ok: boolean;
  readonly errorCategory?: string;
}

function isValidHostname(hostname: string): boolean {
  const trimmed = hostname.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) return false;
  if (
    trimmed.includes("/") ||
    trimmed.includes(":") ||
    trimmed.includes(" ") ||
    trimmed.includes("@") ||
    trimmed.includes("\\") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return false;
  }
  try {
    const url = new URL(`https://${trimmed}`);
    return url.hostname === trimmed;
  } catch {
    return false;
  }
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: (R | undefined)[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      const item = items[current];
      if (item !== undefined) {
        try {
          results[current] = await fn(item);
        } catch {
          // One item failure must never fail the whole batch. Callers that
          // need per-item error detail should return it in R (as
          // OrganizationFetchResult does via its ok flag) instead of throwing.
          results[current] = undefined;
        }
      }
    }
  }

  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results.filter((r): r is R => r !== undefined);
}

async function fetchOrganizationTicketListings(
  env: WorkerHonoEnvironment["Bindings"],
  org: PreferredOrganization,
  nowMs: number,
  requestId: string | undefined,
): Promise<OrganizationFetchResult> {
  try {
    const stub = organizationStoreStub(env, org.organizationId);
    const url = new URL("https://organization.internal/internal/website/commerce-projection");
    url.searchParams.set("organizationId", org.organizationId);
    const response = await invokeOrganizationRpc(stub, url);

    if (!response.ok) {
      console.error(
        JSON.stringify({
          errorCategory: "rpc_status_not_ok",
          event: "platform_tickets_org_fetch_failed",
          organizationId: org.organizationId,
          requestId,
          status: response.status,
        }),
      );
      return {
        errorCategory: "rpc_status_not_ok",
        listings: [],
        ok: false,
        organizationId: org.organizationId,
      };
    }

    const json: unknown = await response.json().catch(() => null);
    const parsed = publishedOrganizationProjectionSchema.safeParse(json);
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          errorCategory: "invalid_projection_schema",
          event: "platform_tickets_org_fetch_failed",
          organizationId: org.organizationId,
          requestId,
        }),
      );
      return {
        errorCategory: "invalid_projection_schema",
        listings: [],
        ok: false,
        organizationId: org.organizationId,
      };
    }

    if (parsed.data.organizationId !== org.organizationId) {
      console.error(
        JSON.stringify({
          errorCategory: "organization_id_mismatch",
          event: "platform_tickets_org_fetch_failed",
          expectedOrganizationId: org.organizationId,
          receivedOrganizationId: parsed.data.organizationId,
          requestId,
        }),
      );
      return {
        errorCategory: "organization_id_mismatch",
        listings: [],
        ok: false,
        organizationId: org.organizationId,
      };
    }

    const orgListings: PlatformHomeTicketListing[] = [];
    const timezone = parsed.data.payload.timezone || "America/New_York";
    const orgName = org.organizationName || parsed.data.payload.organizationName;

    // Eligibility-only directory: inclusion means a future ticketed Performance
    // exists, not that checkout is currently open. Inventory, ticket bundles,
    // and payment/Stripe readiness are evaluated on the ticket detail page;
    // this feed must never claim a performance is purchasable.
    for (const performance of parsed.data.payload.performances) {
      if (!performance.isTicketingEnabled) continue;
      const startsAtMs = new Date(performance.startsAt).getTime();
      if (Number.isNaN(startsAtMs) || startsAtMs <= nowMs) continue;

      orgListings.push({
        eventId: performance.id,
        organizationName: orgName,
        startsAt: performance.startsAt,
        ticketsUrl: `https://${org.hostname}/tickets/${performance.id}`,
        timezone,
        title: performance.title,
        venueName: performance.venueName || "",
      });
    }

    return {
      listings: orgListings,
      ok: true,
      organizationId: org.organizationId,
    };
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        errorCategory: "rpc_exception",
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "platform_tickets_org_fetch_failed",
        organizationId: org.organizationId,
        requestId,
      }),
    );
    return {
      errorCategory: "rpc_exception",
      listings: [],
      ok: false,
      organizationId: org.organizationId,
    };
  }
}

async function loadPlatformTicketListings(
  env: WorkerHonoEnvironment["Bindings"],
  nowMs: number,
  requestId?: string,
): Promise<{
  readonly hasFetchErrors: boolean;
  readonly listings: PlatformHomeTicketListing[];
}> {
  const { results } = await env.CONTROL_DB.prepare(
    `SELECT
      o.id AS organizationId,
      o.name AS organizationName,
      d.hostname AS hostname,
      d.kind AS domainKind
     FROM (
       SELECT id, name
       FROM organizations
       WHERE lifecycle_state = 'active'
       ORDER BY name ASC, id ASC
       LIMIT ?
     ) o
     JOIN organization_domains d ON d.organization_id = o.id
     WHERE d.status = 'active'
       AND d.kind IN ('custom_public', 'canonical')
     ORDER BY
       o.name ASC,
       o.id ASC,
       CASE d.kind WHEN 'custom_public' THEN 0 WHEN 'canonical' THEN 1 ELSE 2 END,
       d.created_at ASC,
       d.id ASC`,
  )
    .bind(MAX_ORGANIZATIONS_TICKET_SCAN)
    .all<OrganizationDomainRow>();

  const preferredOrgs = new Map<string, PreferredOrganization>();

  for (const row of results) {
    if (preferredOrgs.has(row.organizationId)) continue;
    const normalized = row.hostname.trim().toLowerCase();
    if (!isValidHostname(normalized)) {
      console.warn(
        JSON.stringify({
          event: "platform_tickets_invalid_hostname",
          hostname: row.hostname,
          organizationId: row.organizationId,
          requestId,
        }),
      );
      continue;
    }
    preferredOrgs.set(row.organizationId, {
      hostname: normalized,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
    });
  }

  const orgList = Array.from(preferredOrgs.values());
  const fetchResults = await mapConcurrent(orgList, RPC_CONCURRENCY_LIMIT, (org) =>
    fetchOrganizationTicketListings(env, org, nowMs, requestId),
  );

  type TaggedListing = PlatformHomeTicketListing & { readonly organizationId: string };
  let hasFetchErrors = false;
  const allListings: TaggedListing[] = [];

  for (const res of fetchResults) {
    if (!res.ok) {
      hasFetchErrors = true;
    } else {
      for (const listing of res.listings) {
        allListings.push({
          ...listing,
          organizationId: res.organizationId,
        });
      }
    }
  }

  // Deduplicate by (organizationId, eventId)
  const seenKeys = new Set<string>();
  const deduplicated: TaggedListing[] = [];
  for (const item of allListings) {
    const key = `${item.organizationId}:${item.eventId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduplicated.push(item);
  }

  // Deterministic sort: startsAt asc, tie-break by organizationName asc, then eventId asc
  deduplicated.sort((a, b) => {
    const timeDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    const orgDiff = a.organizationName.localeCompare(b.organizationName);
    if (orgDiff !== 0) return orgDiff;
    return a.eventId.localeCompare(b.eventId);
  });

  const sliced: PlatformHomeTicketListing[] = deduplicated
    .slice(0, MAX_PLATFORM_HOME_TICKET_LISTINGS)
    .map((item) => ({
      eventId: item.eventId,
      organizationName: item.organizationName,
      startsAt: item.startsAt,
      ticketsUrl: item.ticketsUrl,
      timezone: item.timezone,
      title: item.title,
      venueName: item.venueName,
    }));

  return {
    hasFetchErrors,
    listings: sliced,
  };
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/public/platform/tickets", async (context) => {
    validateStartupConfig(context.env);
    const requestId = context.get("requestId");
    const clientIp = context.req.header("cf-connecting-ip")?.trim() ?? "unknown";

    const rateLimitProblem = await evaluateEdgeRateLimit({
      clientIp,
      env: context.env,
      limiterName: "PUBLIC_READ_RATE_LIMITER",
      operation: "platform_tickets",
      requestId,
    });
    if (rateLimitProblem) return rateLimitProblem;

    const cached = await context.env.ROUTING_CACHE.get("platform:tickets:feed", "json").catch(
      () => null,
    );
    const parsedCached = platformHomeTicketListingsResponseSchema.safeParse({
      listings: cached,
      requestId,
    });
    if (parsedCached.success) {
      const nowMs = Date.now();
      const activeListings = parsedCached.data.listings.filter((listing) => {
        const startsAtMs = new Date(listing.startsAt).getTime();
        return !Number.isNaN(startsAtMs) && startsAtMs > nowMs;
      });
      return context.json({
        listings: activeListings,
        requestId,
      });
    }

    const nowMs = Date.now();
    const { listings: sliced, hasFetchErrors } = await loadPlatformTicketListings(
      context.env,
      nowMs,
      requestId,
    );

    if (!hasFetchErrors) {
      await context.env.ROUTING_CACHE.put("platform:tickets:feed", JSON.stringify(sliced), {
        expirationTtl: COMPLETE_TICKET_FEED_CACHE_TTL_SECONDS,
      }).catch(() => undefined);
    } else {
      // Partial feed: cache only briefly so a tenant outage does not cause a
      // per-request RPC fan-out on every homepage hit, while never serving a
      // stale incomplete feed for the normal five-minute TTL.
      await context.env.ROUTING_CACHE.put("platform:tickets:feed", JSON.stringify(sliced), {
        expirationTtl: PARTIAL_TICKET_FEED_CACHE_TTL_SECONDS,
      }).catch(() => undefined);
    }

    const response = platformHomeTicketListingsResponseSchema.parse({
      listings: sliced,
      requestId,
    });
    return context.json(response);
  });

  router.post("/api/public/platform/inquire", async (context) => {
    validateStartupConfig(context.env);
    const requestId = context.get("requestId");
    const clientIp = context.req.header("cf-connecting-ip")?.trim() ?? "unknown";

    const body = await context.req.json<unknown>().catch(() => null);
    const parsed = platformInquiryRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Please fill out the required inquiry fields with valid information.",
          requestId,
        } satisfies ProblemDetails,
        400,
      );
    }

    const rateLimitProblem = await evaluateEdgeRateLimit({
      clientIp,
      env: context.env,
      limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
      operation: "platform_inquiry",
      requestId,
    });
    if (rateLimitProblem) return rateLimitProblem;

    // Honeypot check: bots fill hidden fields; humans do not.
    if (parsed.data.website.trim().length > 0) {
      const response = platformInquiryResponseSchema.parse({
        accepted: true,
        requestId,
      });
      return context.json(response);
    }

    // Turnstile check when configured or provided.
    const hasTurnstileToken = Boolean(parsed.data.turnstileToken?.trim());
    if (context.env.TURNSTILE_SECRET_KEY?.trim() || hasTurnstileToken) {
      const turnstileVerified = await verifyTurnstileToken(
        context.env,
        parsed.data.turnstileToken,
        clientIp,
      );
      if (!turnstileVerified) {
        return context.json(
          {
            code: "turnstile_verification_failed",
            message: "Anti-bot verification challenge failed. Please try again.",
            requestId,
          } satisfies ProblemDetails,
          400,
        );
      }
    }

    const { results: activeAdmins } = await context.env.CONTROL_DB.prepare(
      `SELECT
        u.email AS email,
        u.name AS name
       FROM platform_administrators pa
       JOIN user u ON u.id = pa.user_id
       WHERE pa.revoked_at IS NULL`,
    ).all<PlatformAdminRow>();
    const subject = `[Choir Management] Nonprofit Inquiry: ${parsed.data.organizationName}`;
    const textLines = [
      "A new nonprofit inquiry was submitted on the Choir Management platform:",
      "",
      `Organization: ${parsed.data.organizationName}`,
      `Contact Name: ${parsed.data.contactName}`,
      `Contact Email: ${parsed.data.email}`,
      `Location: ${parsed.data.location || "Fairfield County, Ohio area"}`,
      "",
      "Message:",
      parsed.data.message || "(No message provided)",
      "",
      `Reply to this email directly to respond to ${parsed.data.contactName} (${parsed.data.email}).`,
    ];
    const text = textLines.join("\n");

    for (const admin of activeAdmins) {
      await sendPlatformEmail(context.env, {
        fromName: "Choir Management Inquiries",
        kind: "platform-inquiry",
        recipient: admin.email,
        replyTo: parsed.data.email,
        subject,
        text,
      }).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            errorType: error instanceof Error ? error.name : "UnknownError",
            event: "platform_inquiry_email_failed",
            recipient: admin.email,
            requestId,
          }),
        );
      });
    }

    const response = platformInquiryResponseSchema.parse({
      accepted: true,
      requestId,
    });
    return context.json(response);
  });
}
