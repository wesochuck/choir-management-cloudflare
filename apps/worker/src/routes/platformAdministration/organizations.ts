import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";
import { type ProblemDetails } from "@choir/contracts";
import { createAuth, isProductBaseHost } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import { validateStartupConfig } from "../../env";
import {
  PLATFORM_ORGANIZATION_PAGE_SIZE,
  encodePlatformOrganizationCursor,
  parsePlatformOrganizationCursor,
} from "../helpers";
import type { PlatformOrganizationRow } from "../helpers";

export function registerPlatformOrganizationRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/organizations", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message:
            "The Platform Organization directory is available only on the product base hostname.",
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

    const cursor = parsePlatformOrganizationCursor(requestUrl.searchParams.get("cursor"));
    if (cursor === undefined) {
      return context.json(
        {
          code: "validation_failed",
          message: "The Organization directory cursor is invalid.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const baseQuery = `SELECT o.id AS organizationId, o.name, o.slug,
      o.lifecycle_state AS lifecycleState,
      o.operational_schema_version AS operationalSchemaVersion,
      o.provisioned_at AS provisionedAt, o.created_at AS createdAt,
      d.hostname AS canonicalHostname, d.status AS canonicalStatus
    FROM organizations o
    INNER JOIN organization_domains d
      ON d.organization_id = o.id AND d.kind = 'canonical'`;
    const statement = cursor
      ? context.env.CONTROL_DB.prepare(
          `${baseQuery}
         WHERE o.created_at < ? OR (o.created_at = ? AND o.id < ?)
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
        ).bind(cursor[0], cursor[0], cursor[1], PLATFORM_ORGANIZATION_PAGE_SIZE + 1)
      : context.env.CONTROL_DB.prepare(
          `${baseQuery}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
        ).bind(PLATFORM_ORGANIZATION_PAGE_SIZE + 1);
    const rows = await statement.all<PlatformOrganizationRow>();
    const organizations = rows.results.slice(0, PLATFORM_ORGANIZATION_PAGE_SIZE).map((row) => ({
      canonicalHostname: row.canonicalHostname,
      canonicalStatus: row.canonicalStatus,
      lifecycleState: row.lifecycleState,
      name: row.name,
      operationalSchemaVersion: row.operationalSchemaVersion,
      organizationId: row.organizationId,
      provisionedAt: row.provisionedAt,
      slug: row.slug,
    }));
    const cursorRow =
      organizations.length === PLATFORM_ORGANIZATION_PAGE_SIZE
        ? rows.results[PLATFORM_ORGANIZATION_PAGE_SIZE - 1]
        : undefined;
    return context.json({
      nextCursor:
        rows.results.length > PLATFORM_ORGANIZATION_PAGE_SIZE && cursorRow
          ? encodePlatformOrganizationCursor(cursorRow)
          : null,
      organizations,
      requestId: context.get("requestId"),
    });
  });
}
