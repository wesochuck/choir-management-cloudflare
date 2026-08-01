import { publicDomainRegistrationRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import { createAuth } from "../auth/config";
import { validateStartupConfig } from "../env";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";
import { disablePublicDomain, registerPublicDomain } from "../tenancy/registerPublicDomain";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { resolveCanonicalOrganizationId } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/public-domains", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Public Website Domain registration requires a canonical product hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = publicDomainRegistrationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid Public Website Domain hostname is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
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
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    if (authorization.value.role !== "owner") {
      return context.json(
        {
          code: "forbidden",
          message: "Only an Organization Owner may register a Public Website Domain.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const registration = await registerPublicDomain(context.env, {
      actorUserId: authorization.value.userId,
      hostname: parsedBody.data.hostname,
      organizationId,
      requestId: context.get("requestId"),
    });
    if (!registration.ok) {
      const status = registration.error.code === "validation_failed" ? 400 : 409;
      return context.json(
        {
          code: registration.error.code,
          message: registration.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
    return context.json({ ...registration.value, requestId: context.get("requestId") }, 201);
  });

  router.delete("/api/organization/public-domains/:domainId", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const domainId = z.uuid().safeParse(context.req.param("domainId"));
    if (!organizationId || !domainId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The Public Website Domain was not found.",
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
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    if (authorization.value.role !== "owner") {
      return context.json(
        {
          code: "forbidden",
          message: "Only an Organization Owner may disable a Public Website Domain.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }

    const disabled = await disablePublicDomain(context.env, {
      actorUserId: authorization.value.userId,
      domainId: domainId.data,
      organizationId,
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
  });
}
