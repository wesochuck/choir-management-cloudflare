import {
  organizationEmailDomainVerifyResponseSchema,
  organizationEmailSettingsSchema,
  organizationEmailSettingsUpdateRequestSchema,
  type OrganizationEmailSettings,
  type OrganizationEmailSettingsUpdateRequest,
  type ProblemDetails,
} from "@choir/contracts";
import type { D1Database } from "@cloudflare/workers-types";
import type { Context, Hono } from "hono";

import { resolveEmailDomainDnsRecords } from "../communications/emailDomainDns";
import { normalizeEmailDomain } from "../organization/emailDomainVerification";
import { syncOrganizationEmailDomainRegistry } from "../organization/emailDomainRegistry";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { authorizeCalendarRoute, type WorkerHonoEnvironment } from "./helpers";

type EmailSettingsStub = ReturnType<typeof organizationStoreStub>;
type AuthorizedRouteContext = Context<WorkerHonoEnvironment>;
type AuthorizedOrganization = Extract<
  Awaited<ReturnType<typeof authorizeCalendarRoute>>,
  { readonly ok: true }
>;

function parseSettingsPayload(raw: unknown): OrganizationEmailSettings {
  return organizationEmailSettingsSchema.parse(
    typeof raw === "object" && raw !== null && "settings" in raw
      ? (raw as { readonly settings: unknown }).settings
      : raw,
  );
}

async function readPriorEmailSettings(
  stub: EmailSettingsStub,
  organizationId: string,
): Promise<OrganizationEmailSettings | null> {
  try {
    const url = new URL("https://organization.internal/internal/email-settings");
    url.searchParams.set("organizationId", organizationId);
    const response = await invokeOrganizationRpc(stub, url);
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    return parseSettingsPayload(raw);
  } catch {
    return null;
  }
}

function requestedDomainOf(update: OrganizationEmailSettingsUpdateRequest): string | null {
  if (update.customDomain === undefined || update.customDomain === null) return null;
  const normalized = normalizeEmailDomain(update.customDomain);
  return normalized.length > 0 ? normalized : null;
}

function isNewDomainClaim(requested: string | null, prior: string | null): boolean {
  return requested !== null && requested !== prior;
}

async function isDomainOwnedByAnotherOrganization(
  db: D1Database,
  domain: string,
  organizationId: string,
): Promise<boolean> {
  const owner = await db
    .prepare("SELECT organization_id FROM organization_email_domains WHERE domain = ? LIMIT 1")
    .bind(domain)
    .first<{ readonly organization_id: string }>()
    .catch(() => null);
  return owner !== null && owner.organization_id !== organizationId;
}

function domainInUseResponse(requestId: string): Response {
  return Response.json(
    {
      code: "custom_domain_in_use",
      message: "This email domain is already assigned to another organization.",
      requestId,
    } satisfies ProblemDetails,
    { status: 409 },
  );
}

function registryUnavailableAfterSaveResponse(requestId: string): Response {
  return Response.json(
    {
      code: "service_unavailable",
      message: "Email settings were saved but the domain registry is unavailable. Retry shortly.",
      requestId,
    } satisfies ProblemDetails,
    { status: 503 },
  );
}

async function mutateEmailSettingsInStore(
  stub: EmailSettingsStub,
  organizationId: string,
  body: OrganizationEmailSettingsUpdateRequest,
): Promise<Response> {
  const url = new URL("https://organization.internal/internal/email-settings/manage");
  url.searchParams.set("organizationId", organizationId);
  return invokeOrganizationRpc(stub, url, {
    body: JSON.stringify(body),
    method: "POST",
  });
}

async function restorePriorEmailSettings(
  stub: EmailSettingsStub,
  organizationId: string,
  prior: OrganizationEmailSettings,
): Promise<void> {
  try {
    const response = await mutateEmailSettingsInStore(stub, organizationId, {
      customDomain: prior.customDomain,
      fromName: prior.fromName,
      replyToEmail: prior.replyToEmail,
    });
    if (!response.ok) {
      console.error(
        "email-domain registry conflict: DO restoration failed for organization",
        organizationId,
      );
    }
  } catch {
    console.error(
      "email-domain registry conflict: DO restoration threw for organization",
      organizationId,
    );
  }
}

function registryStatusOf(
  status: OrganizationEmailSettings["customDomainStatus"],
): "active" | "degraded" | "pending" {
  if (status === "active" || status === "degraded" || status === "pending") return status;
  return "pending";
}

async function reconcileRegistryAfterSettingsUpdate(
  context: AuthorizedRouteContext,
  authorization: AuthorizedOrganization,
  settings: OrganizationEmailSettings,
  prior: OrganizationEmailSettings | null,
  claimed: boolean,
): Promise<Response | null> {
  const sync = await syncOrganizationEmailDomainRegistry(context.env.CONTROL_DB, {
    customDomain: settings.customDomain,
    organizationId: authorization.organizationId,
    status: registryStatusOf(settings.customDomainStatus),
    verifiedAt: settings.verifiedAt,
  });
  if (!sync.ok && sync.code === "domain_in_use") {
    if (prior && claimed) {
      await restorePriorEmailSettings(
        stubFor(context, authorization),
        authorization.organizationId,
        prior,
      );
    }
    return domainInUseResponse(context.get("requestId"));
  }
  if (!sync.ok) {
    return registryUnavailableAfterSaveResponse(context.get("requestId"));
  }
  return null;
}

function stubFor(
  context: AuthorizedRouteContext,
  authorization: AuthorizedOrganization,
): EmailSettingsStub {
  return organizationStoreStub(context.env, authorization.organizationId);
}

async function handlePutEmailSettings(
  context: AuthorizedRouteContext,
  authorization: AuthorizedOrganization,
  update: OrganizationEmailSettingsUpdateRequest,
): Promise<Response> {
  const stub = stubFor(context, authorization);
  const prior = await readPriorEmailSettings(stub, authorization.organizationId);
  const requested = requestedDomainOf(update);
  const priorDomain = prior?.customDomain ? normalizeEmailDomain(prior.customDomain) : null;
  const claimed = isNewDomainClaim(requested, priorDomain);

  if (claimed && requested) {
    const ownedByOther = await isDomainOwnedByAnotherOrganization(
      context.env.CONTROL_DB,
      requested,
      authorization.organizationId,
    ).catch(() => false);
    if (ownedByOther) return domainInUseResponse(context.get("requestId"));
  }

  const response = await mutateEmailSettingsInStore(stub, authorization.organizationId, update);
  if (!response.ok) {
    return context.json(
      {
        code: "update_failed",
        message: "Failed to update organization email settings.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const settings = parseSettingsPayload(await response.json());

  if (update.customDomain !== undefined) {
    const conflict = await reconcileRegistryAfterSettingsUpdate(
      context,
      authorization,
      settings,
      prior,
      claimed,
    );
    if (conflict) return conflict;
  }

  return context.json({ requestId: context.get("requestId"), settings });
}

function noDomainToVerifyResponse(requestId: string): Response {
  return Response.json(
    {
      code: "verification_failed",
      message: "No custom email domain is configured to verify.",
      requestId,
    } satisfies ProblemDetails,
    { status: 400 },
  );
}

function identityConflictResponse(requestId: string): Response {
  return Response.json(
    {
      code: "organization_identity_conflict",
      message: "The email settings belong to a different organization.",
      requestId,
    } satisfies ProblemDetails,
    { status: 409 },
  );
}

function verificationUnavailableResponse(requestId: string): Response {
  return Response.json(
    {
      code: "service_unavailable",
      message: "Organization email verification is temporarily unavailable.",
      requestId,
    } satisfies ProblemDetails,
    { status: 503 },
  );
}

function staleVerificationResponse(requestId: string): Response {
  return Response.json(
    {
      code: "stale_email_domain_verification",
      message:
        "The email domain configuration changed during verification. Review the new settings and try again.",
      requestId,
    } satisfies ProblemDetails,
    { status: 409 },
  );
}

function invalidVerificationResultResponse(requestId: string): Response {
  return Response.json(
    {
      code: "verification_failed",
      message: "Email domain verification could not be completed.",
      requestId,
    } satisfies ProblemDetails,
    { status: 400 },
  );
}

function registryUnavailableAfterVerifyResponse(requestId: string): Response {
  return Response.json(
    {
      code: "service_unavailable",
      message:
        "Email domain verification completed but the domain registry is unavailable. Retry shortly.",
      requestId,
    } satisfies ProblemDetails,
    { status: 503 },
  );
}

async function handleVerifyEmailDomain(
  context: AuthorizedRouteContext,
  authorization: AuthorizedOrganization,
): Promise<Response> {
  const stub = stubFor(context, authorization);
  const prepared = await stub.prepareEmailDomainVerification({
    organizationId: authorization.organizationId,
  });
  if (!prepared.ok) {
    return prepared.code === "no_custom_domain_configured"
      ? noDomainToVerifyResponse(context.get("requestId"))
      : identityConflictResponse(context.get("requestId"));
  }

  const resolution = await resolveEmailDomainDnsRecords(prepared.dnsRecords);
  if (!resolution.conclusive) {
    return verificationUnavailableResponse(context.get("requestId"));
  }

  const committed = await stub.commitEmailDomainVerification({
    checkedAt: new Date().toISOString(),
    configurationId: prepared.configurationId,
    dnsRecords: [...resolution.records],
    organizationId: authorization.organizationId,
  });
  if (!committed.ok) {
    if (committed.code === "stale_email_domain_verification") {
      return staleVerificationResponse(context.get("requestId"));
    }
    if (committed.code === "organization_identity_conflict") {
      return identityConflictResponse(context.get("requestId"));
    }
    if (committed.code === "no_custom_domain_configured") {
      return noDomainToVerifyResponse(context.get("requestId"));
    }
    return invalidVerificationResultResponse(context.get("requestId"));
  }

  const sync = await syncOrganizationEmailDomainRegistry(context.env.CONTROL_DB, {
    customDomain: committed.customDomain,
    organizationId: authorization.organizationId,
    status: committed.status,
    verifiedAt: committed.verifiedAt,
  });
  if (!sync.ok) {
    return registryUnavailableAfterVerifyResponse(context.get("requestId"));
  }

  const parsed = organizationEmailDomainVerifyResponseSchema.omit({ requestId: true }).parse({
    allValid: committed.allValid,
    dnsRecords: [...committed.dnsRecords],
    status: committed.status,
  });

  return context.json({ ...parsed, requestId: context.get("requestId") });
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/email-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const url = new URL("https://organization.internal/internal/email-settings");
      url.searchParams.set("organizationId", authorization.organizationId);
      const response = await invokeOrganizationRpc(stub, url);
      const raw: unknown = await response.json();
      const settings = organizationEmailSettingsSchema.parse(
        typeof raw === "object" && raw !== null && "settings" in raw ? raw.settings : raw,
      );
      return context.json({
        requestId: context.get("requestId"),
        settings,
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization email settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/email-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const rawBody = await context.req.json<unknown>().catch(() => null);
    const parsed = organizationEmailSettingsUpdateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid email settings are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      return await handlePutEmailSettings(context, authorization, parsed.data);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization email settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/email-settings/verify", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      return await handleVerifyEmailDomain(context, authorization);
    } catch {
      return verificationUnavailableResponse(context.get("requestId"));
    }
  });
}
