import {
  publishedOrganizationProjectionSchema,
  transactionFeeSettingsSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { validateStartupConfig } from "../env";
import {
  readPublishedOrganization,
  readPublishedOrganizationMedia,
} from "../publication/publishOrganization";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { privateOrganizationFileKey } from "../storage/privateFiles";
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
    const response = await invokeOrganizationRpc(
      organizationStoreStub(context.env, resolvedOrganization.value.organizationId),
      url,
    );
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
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, resolvedOrganization.value.organizationId),
        url,
      );
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
    const object =
      (await readPublishedOrganizationMedia(
        context.env,
        resolved.value.organizationId,
        version.data,
        fileId.data,
      )) ??
      (await readCommerceOrganizationMedia(
        context.env,
        resolved.value.organizationId,
        fileId.data,
      ));
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

async function readCommerceOrganizationMedia(
  env: WorkerHonoEnvironment["Bindings"],
  organizationId: string,
  fileId: string,
): Promise<R2ObjectBody | null> {
  const stub = organizationStoreStub(env, organizationId);
  const commerceUrl = new URL("https://organization.internal/internal/website/commerce-projection");
  const response = await invokeOrganizationRpc(stub, commerceUrl.toString()).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  const data: unknown = await response.json().catch(() => null);
  const parsed = publishedOrganizationProjectionSchema.safeParse(data);
  if (!parsed.success || !parsed.data.payload.mediaFileIds.includes(fileId)) {
    return null;
  }
  const key = privateOrganizationFileKey(organizationId, fileId);
  const object = await env.ORGANIZATION_FILES.get(key);
  if (
    !object ||
    object.customMetadata?.organizationId !== organizationId ||
    object.customMetadata.fileId !== fileId
  ) {
    return null;
  }
  const contentType = object.httpMetadata?.contentType;
  if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    return null;
  }
  return object;
}
