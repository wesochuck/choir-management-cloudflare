import {
  organizationProvisionRequestSchema,
  publicDomainRegistrationRequestSchema,
  type OrganizationProvisionResponse,
  type PlatformOrganizationContextResponse,
  type PlatformOrganizationPublicDomainsResponse,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { createAuth, isProductBaseHost } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import { getPlatformOrganizationContext } from "../../auth/platformElevation";
import {
  beginOrganizationProvisioning,
  OrganizationProvisioningError,
} from "../../control/provisionOrganization";
import { validateStartupConfig } from "../../env";
import {
  disablePublicDomain,
  listPublicDomains,
  registerPublicDomain,
  removePublicDomain,
} from "../../tenancy/registerPublicDomain";
import type { WorkerHonoEnvironment } from "../helpers";
import { resolveCanonicalOrganizationId } from "../helpers";
import { authorizePlatformAdministration } from "../platformAdministration/shared";
import { authorizePlatformRead } from "./shared";

export function registerPlatformOrganizationRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/platform/organizations", async (context) => {
    const authorization = await authorizePlatformAdministration(
      context,
      new URL(context.req.url),
      "Organization provisioning is available only on the product base hostname.",
    );
    if (authorization instanceof Response) return authorization;

    const parsedBody = organizationProvisionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Organization name and unique hostname slug are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const started = await beginOrganizationProvisioning(context.env, {
        ...parsedBody.data,
        actorUserId: authorization.userId,
        requestId: context.get("requestId"),
      });
      const response: OrganizationProvisionResponse = {
        ...started,
        lifecycleState: "provisioning",
        requestId: context.get("requestId"),
      };
      return context.json(response, 202);
    } catch (error: unknown) {
      const workflowDispatchFailed =
        error instanceof OrganizationProvisioningError && error.phase === "workflow";
      return context.json(
        {
          code: workflowDispatchFailed ? "service_unavailable" : "conflict",
          message: workflowDispatchFailed
            ? "The Organization registry was created, but provisioning could not be dispatched."
            : "The Organization name or hostname slug is already in use.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        workflowDispatchFailed ? 503 : 409,
      );
    }
  });

  router.get("/api/platform/organizations/:organizationId/public-domains", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message:
            "Platform public domain management is available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const organizationId = z.uuid().safeParse(context.req.param("organizationId"));
    if (!organizationId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const organization = await context.env.CONTROL_DB.prepare(
      "SELECT id FROM organizations WHERE id = ? LIMIT 1",
    )
      .bind(organizationId.data)
      .first<{ readonly id: string }>();
    if (!organization) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const response: PlatformOrganizationPublicDomainsResponse = {
      domains: [...(await listPublicDomains(context.env.CONTROL_DB, organizationId.data))],
      requestId: context.get("requestId"),
    };
    return context.json(response);
  });

  router.post("/api/platform/organizations/:organizationId/public-domains", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message:
            "Platform public domain management is available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const organizationId = z.uuid().safeParse(context.req.param("organizationId"));
    const parsedBody = publicDomainRegistrationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!organizationId.success || !parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Organization and custom hostname are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const organization = await context.env.CONTROL_DB.prepare(
      "SELECT id FROM organizations WHERE id = ? LIMIT 1",
    )
      .bind(organizationId.data)
      .first<{ readonly id: string }>();
    if (!organization) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const registration = await registerPublicDomain(context.env, {
      actorUserId: authorization.userId,
      hostname: parsedBody.data.hostname,
      organizationId: organizationId.data,
      requestId: context.get("requestId"),
    });
    if (!registration.ok) {
      return context.json(
        {
          code: registration.error.code,
          message: registration.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        registration.error.code === "validation_failed" ? 400 : 409,
      );
    }
    return context.json({ ...registration.value, requestId: context.get("requestId") }, 201);
  });

  router.delete(
    "/api/platform/organizations/:organizationId/public-domains/:domainId",
    async (context) => {
      const config = validateStartupConfig(context.env);
      const requestUrl = new URL(context.req.url);
      if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
        return context.json(
          {
            code: "not_found",
            message:
              "Platform public domain management is available only on the product base hostname.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const organizationId = z.uuid().safeParse(context.req.param("organizationId"));
      const domainId = z.uuid().safeParse(context.req.param("domainId"));
      if (!organizationId.success || !domainId.success) {
        return context.json(
          {
            code: "not_found",
            message: "The custom hostname was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const authorization = await authorizePlatformRead(context, requestUrl);
      if (authorization instanceof Response) return authorization;
      const action = context.req.query("action");
      if (action === "disable") {
        try {
          const disabled = await disablePublicDomain(context.env, {
            actorUserId: authorization.userId,
            domainId: domainId.data,
            organizationId: organizationId.data,
            requestId: context.get("requestId"),
          });
          if (!disabled.ok) {
            return context.json(
              {
                code: disabled.error.code,
                message: disabled.error.message,
                requestId: context.get("requestId"),
              } satisfies ProblemDetails,
              404,
            );
          }
          return context.json({ ...disabled.value, requestId: context.get("requestId") });
        } catch {
          return context.json(
            {
              code: "service_unavailable",
              message:
                "The custom hostname could not be disabled while its provider configuration is being removed.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            503,
          );
        }
      }

      try {
        const removed = await removePublicDomain(context.env, {
          actorUserId: authorization.userId,
          domainId: domainId.data,
          organizationId: organizationId.data,
          requestId: context.get("requestId"),
        });
        if (!removed.ok) {
          return context.json(
            {
              code: removed.error.code,
              message: removed.error.message,
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            404,
          );
        }
        return context.json({
          domainId: domainId.data,
          ok: true,
          requestId: context.get("requestId"),
        });
      } catch {
        return context.json(
          {
            code: "service_unavailable",
            message:
              "The custom hostname could not be removed while its provider configuration is being deleted.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
    },
  );

  router.get("/api/platform/organization-context", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Platform Organization access requires a registered canonical hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizePlatformAdministratorSession(
      context.env.CONTROL_DB,
      session?.session.id ?? null,
      session?.user.id ?? null,
    );
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }

    const platformContext = await getPlatformOrganizationContext(
      context.env.CONTROL_DB,
      organizationId,
      session.session.id,
      authorization.value.userId,
    );
    const response: PlatformOrganizationContextResponse = {
      ...platformContext,
      requestId: context.get("requestId"),
    };
    return context.json(response);
  });
}
