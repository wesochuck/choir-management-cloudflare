import {
  isPublicContentPath,
  normalizedPublicWebsitePages,
  reservedPublicWebsiteSlugs,
} from "@choir/contracts";
import { resolveOrganization } from "./tenancy/resolveOrganization";
import { readPublishedOrganization } from "./publication/publishOrganization";
import {
  processEmailProviderDeadLetterBatch,
  processEmailProviderQueue,
  reconcileEmailProviderEvents,
} from "./communications/emailFeedback";
import { reconcileEmailChangeNotifications } from "./auth/emailChange";
import { repairPendingProfileReconciliations } from "./control/profileReconciliationService";
import { processDeadLetterBatch, processDeliveryBatch } from "./jobs/consumer";
import { OrganizationStore } from "./organization/OrganizationStore";
import { router, setSecurityHeaders } from "./router";
import { reconcileCanonicalHostnameFirewall } from "./security/canonicalHostnameFirewall";
import { CustomDomainWorkflow } from "./workflows/CustomDomainWorkflow";
import { FleetSchemaWorkflow } from "./workflows/FleetSchemaWorkflow";
import { ProvisioningWorkflow } from "./workflows/ProvisioningWorkflow";
import type { Env } from "./env";
import { customDomainLoginRedirect } from "./tenancy/customDomainLogin";

export { CustomDomainWorkflow, FleetSchemaWorkflow, OrganizationStore, ProvisioningWorkflow };

function deniesAmbiguousContentPath(pathname: string): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/assets/")) return false;
  if (pathname.includes("%") || pathname.includes("\\")) return true;
  if (pathname === "/") return false;
  const first = pathname.split("/")[1] ?? "";
  if (reservedPublicWebsiteSlugs.has(first) || first.includes(".")) return false;
  return !isPublicContentPath(pathname);
}

function deniesPublicHostShell(url: URL, baseDomain: string): boolean {
  if (url.hostname === baseDomain || url.hostname.endsWith(`.${baseDomain}`)) return false;
  const pathname = url.pathname;
  if (pathname.startsWith("/api/") || pathname.startsWith("/assets/")) return false;
  const systemRoot = pathname.split("/")[1] ?? "";
  const publicRoots = new Set([
    "performances",
    "tickets",
    "donate",
    "auditions",
    "join",
    "rsvp",
    "poll",
    "unsubscribe",
    "player",
    "privacy",
    "terms",
    "documents",
  ]);
  return (
    (reservedPublicWebsiteSlugs.has(systemRoot) && !publicRoots.has(systemRoot)) ||
    pathname.includes("%")
  );
}

async function publicContentStatus(url: URL, env: Env): Promise<200 | 404 | undefined> {
  if (!isPublicContentPath(url.pathname)) return undefined;
  const organization = await resolveOrganization(url, env);
  if (!organization.ok) return 404;
  const published = await readPublishedOrganization(env, organization.value.organizationId);
  return published &&
    normalizedPublicWebsitePages(published.projection.payload.settings).some(
      (page) => `/${page.slug}` === url.pathname && page.body.trim(),
    )
    ? 200
    : 404;
}

const worker = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const loginRedirect = await customDomainLoginRedirect(request, env);
    if (loginRedirect) {
      setSecurityHeaders(loginRedirect.headers, "no-referrer");
      loginRedirect.headers.set("cache-control", "no-store");
      return loginRedirect;
    }
    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname;
    if (
      deniesAmbiguousContentPath(pathname) ||
      deniesPublicHostShell(requestUrl, env.PRODUCT_BASE_DOMAIN)
    ) {
      const denied = new Response("Page not found", { status: 404 });
      setSecurityHeaders(denied.headers);
      return denied;
    }
    const response = await router.fetch(request, env, executionContext);
    if (response.status !== 404 || pathname === "/api" || pathname.startsWith("/api/")) {
      return response;
    }

    const contentStatus = await publicContentStatus(requestUrl, env);
    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    setSecurityHeaders(
      headers,
      "strict-origin-when-cross-origin",
      undefined,
      pathname === "/" ||
        pathname === "/performances" ||
        pathname === "/tickets" ||
        pathname.startsWith("/tickets/") ||
        contentStatus === 200,
    );
    return new Response(assetResponse.body, {
      headers,
      status: contentStatus ?? assetResponse.status,
    });
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    if (batch.queue === env.EMAIL_EVENTS_QUEUE_NAME) {
      await processEmailProviderQueue(batch, env);
      return;
    }
    if (batch.queue === env.EMAIL_EVENTS_DLQ_NAME) {
      await processEmailProviderDeadLetterBatch(batch, env);
      return;
    }
    if (batch.queue === env.JOBS_QUEUE_NAME) {
      await processDeliveryBatch(batch, env);
      return;
    }
    if (batch.queue === env.JOBS_DLQ_NAME) {
      await processDeadLetterBatch(batch, env);
      return;
    }
    console.error(
      JSON.stringify({
        event: "unknown_queue_batch",
        messagesCount: batch.messages.length,
        queue: batch.queue,
      }),
    );
    throw new Error(`Unhandled queue: ${batch.queue}`);
  },
  scheduled(event: ScheduledController, env: Env, executionContext: ExecutionContext): void {
    executionContext.waitUntil(
      Promise.resolve().then(() => {
        return Promise.all([
          reconcileEmailChangeNotifications(env),
          reconcileEmailProviderEvents(env),
          repairPendingProfileReconciliations(env),
          reconcileCanonicalHostnameFirewall(env),
        ]).then(() => {
          console.info(
            JSON.stringify({
              environment: env.APP_ENV,
              event: "scheduled_safety_tick",
              scheduledTime: event.scheduledTime,
            }),
          );
        });
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
