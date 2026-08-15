import { transactionFeeSettingsSchema, type ProblemDetails } from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { validateStartupConfig } from "../env";
import {
  readPublishedOrganization,
  readPublishedOrganizationMedia,
} from "../publication/publishOrganization";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/public/projection", async (context) => {
    validateStartupConfig(context.env);
    const resolvedOrganization = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolvedOrganization.ok) {
      return context.json(
        {
          code: "not_found",
          message: "No published Organization website is available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const published = await readPublishedOrganization(
      context.env,
      resolvedOrganization.value.organizationId,
    );
    if (!published) {
      return context.json(
        {
          code: "not_found",
          message: "No published Organization website is available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    context.header("etag", published.httpEtag);
    context.header("vary", "Host");
    if (context.req.header("if-none-match") === published.httpEtag) {
      return context.body(null, 304);
    }
    return context.json(published.projection);
  });

  router.get("/api/public/commerce-projection", async (context) => {
    validateStartupConfig(context.env);
    const resolvedOrganization = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolvedOrganization.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Ticketing is not available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const url = new URL("https://organization.internal/internal/website/commerce-projection");
    url.searchParams.set("organizationId", resolvedOrganization.value.organizationId);
    const response = await context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(resolvedOrganization.value.organizationId),
    ).fetch(url);
    if (!response.ok) {
      return context.json(
        {
          code: "service_unavailable",
          message: "Ticketing is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    return context.json(await response.json());
  });

  router.get("/api/public/transaction-fee-settings", async (context) => {
    validateStartupConfig(context.env);
    const resolvedOrganization = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolvedOrganization.ok) {
      return context.json(
        {
          code: "not_found",
          message: "No published Organization website is available for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/transaction-fee-settings");
      url.searchParams.set("organizationId", resolvedOrganization.value.organizationId);
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(resolvedOrganization.value.organizationId),
      ).fetch(url);
      const settings = transactionFeeSettingsSchema.safeParse(await response.json());
      if (!response.ok || !settings.success) throw new Error("invalid_settings");
      return context.json({ ...settings.data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Transaction fee settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/public/media/:version/:fileId", async (context) => {
    validateStartupConfig(context.env);
    const version = z.coerce.number().int().positive().safeParse(context.req.param("version"));
    const fileId = z.uuid().safeParse(context.req.param("fileId"));
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!version.success || !fileId.success || !resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "The published Organization image was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const object = await readPublishedOrganizationMedia(
      context.env,
      resolved.value.organizationId,
      version.data,
      fileId.data,
    );
    if (!object) {
      return context.json(
        {
          code: "not_found",
          message: "The published Organization image was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    context.header("etag", object.httpEtag);
    context.header("vary", "Host");
    if (context.req.header("if-none-match") === object.httpEtag) return context.body(null, 304);
    context.header("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
    return context.body(object.body);
  });
}
