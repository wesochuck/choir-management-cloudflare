import {
  MAX_PLATFORM_HOME_TICKET_LISTINGS,
  platformHomeTicketListingsResponseSchema,
  platformInquiryRequestSchema,
  platformInquiryResponseSchema,
  type PlatformHomeTicketListing,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { sendPlatformEmail } from "../auth/platformEmail";
import { validateStartupConfig } from "../env";
import { readPublishedOrganization } from "../publication/publishOrganization";
import { evaluateEdgeRateLimit } from "../security/edgeRateLimit";
import { verifyTurnstileToken } from "../security/turnstile";
import type { WorkerHonoEnvironment } from "./helpers";

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

async function loadPlatformTicketListings(
  env: WorkerHonoEnvironment["Bindings"],
  nowMs: number,
): Promise<PlatformHomeTicketListing[]> {
  const { results } = await env.CONTROL_DB.prepare(
    `SELECT
      o.id AS organizationId,
      o.name AS organizationName,
      d.hostname AS hostname,
      d.kind AS domainKind
     FROM organizations o
     JOIN organization_domains d ON d.organization_id = o.id
     WHERE o.lifecycle_state = 'active'
       AND d.status = 'active'
     ORDER BY o.name ASC
     LIMIT 100`,
  ).all<OrganizationDomainRow>();

  const orgDomainMap = new Map<
    string,
    { readonly hostname: string; readonly organizationName: string }
  >();

  for (const row of results) {
    const existing = orgDomainMap.get(row.organizationId);
    if (!existing || row.domainKind === "custom_public") {
      orgDomainMap.set(row.organizationId, {
        hostname: row.hostname,
        organizationName: row.organizationName,
      });
    }
  }

  const listings: PlatformHomeTicketListing[] = [];

  for (const [organizationId, orgInfo] of orgDomainMap) {
    const published = await readPublishedOrganization(env, organizationId);
    if (!published) continue;

    for (const performance of published.projection.payload.performances) {
      if (!performance.isTicketingEnabled) continue;
      const startsAtMs = new Date(performance.startsAt).getTime();
      if (Number.isNaN(startsAtMs) || startsAtMs <= nowMs) continue;

      listings.push({
        eventId: performance.id,
        organizationName: orgInfo.organizationName,
        startsAt: performance.startsAt,
        ticketsUrl: `https://${orgInfo.hostname}/tickets/${performance.id}`,
        timezone: published.projection.payload.timezone,
        title: performance.title,
        venueName: performance.venueName || "",
      });
    }
  }

  listings.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return listings.slice(0, MAX_PLATFORM_HOME_TICKET_LISTINGS);
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
      return context.json(parsedCached.data);
    }

    const sliced = await loadPlatformTicketListings(context.env, Date.now());

    await context.env.ROUTING_CACHE.put("platform:tickets:feed", JSON.stringify(sliced), {
      expirationTtl: 300,
    }).catch(() => undefined);

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
    const subject = `[MusicSite] Nonprofit Inquiry: ${parsed.data.organizationName}`;
    const textLines = [
      "A new nonprofit inquiry was submitted on musicsite.org:",
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
        fromName: "MusicSite Inquiries",
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
