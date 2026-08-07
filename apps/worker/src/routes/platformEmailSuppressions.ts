import {
  platformLocalEmailSuppressionReleaseRequestSchema,
  type PlatformLocalEmailSuppressionReleaseResponse,
  platformEmailSuppressionReleaseRequestSchema,
  type PlatformEmailSuppression,
  type PlatformEmailSuppressionReleaseResponse,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { createAuth, isProductBaseHost } from "../auth/config";
import { authorizePlatformAdministratorSession } from "../auth/platformAdministrator";
import { validateStartupConfig } from "../env";

import type { Context, Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

type WorkerContext = Context<WorkerHonoEnvironment>;

const PAGE_SIZE = 25;
const querySchema = z.object({
  q: z.string().trim().max(320).default(""),
  status: z.enum(["active", "all"]).default("active"),
});
const cursorSchema = z.tuple([z.iso.datetime(), z.email()]);

interface EmailSuppressionRow {
  readonly active: number;
  readonly createdAt: string;
  readonly detail: string;
  readonly email: string;
  readonly providerMessageId: string;
  readonly reason: PlatformEmailSuppression["reason"];
  readonly sourceEventId: string;
  readonly updatedAt: string;
}

interface LocalSuppressionRow {
  readonly active: number;
  readonly email: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly profileId: string;
  readonly updatedAt: string;
}

interface SuppressionFilters {
  readonly cursor: readonly [string, string] | null;
  readonly query: string;
  readonly status: "active" | "all";
}

interface SuppressionAdministrator {
  readonly userId: string;
}

function parseCursor(value: string | null): readonly [string, string] | null | undefined {
  if (value === null) return null;
  if (value.length > 512) return undefined;
  const parsed = cursorSchema.safeParse(value.split("|"));
  return parsed.success ? parsed.data : undefined;
}

function encodeCursor(row: EmailSuppressionRow): string {
  return `${row.updatedAt}|${row.email}`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function parseFilters(requestUrl: URL): SuppressionFilters | null {
  const parsedQuery = querySchema.safeParse({
    q: requestUrl.searchParams.get("q") ?? "",
    status: requestUrl.searchParams.get("status") ?? "active",
  });
  if (!parsedQuery.success) return null;
  const cursor = parseCursor(requestUrl.searchParams.get("cursor"));
  if (cursor === undefined) return null;
  return { cursor, query: parsedQuery.data.q.toLowerCase(), status: parsedQuery.data.status };
}

async function readSuppressionRows(
  database: D1Database,
  filters: SuppressionFilters,
): Promise<{ readonly results: EmailSuppressionRow[] }> {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (filters.status === "active") {
    conditions.push(
      `(active = 1 OR EXISTS (
         SELECT 1 FROM email_provider_profile_suppressions local
         WHERE local.email_normalized = email_recipient_suppressions.email_normalized
           AND local.active = 1
       ))`,
    );
  }
  if (filters.query.length > 0) {
    conditions.push("email_normalized LIKE ? ESCAPE '\\'");
    bindings.push(`%${escapeLike(filters.query)}%`);
  }
  if (filters.cursor) {
    conditions.push("(updated_at < ? OR (updated_at = ? AND email_normalized < ?))");
    bindings.push(filters.cursor[0], filters.cursor[0], filters.cursor[1]);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return database
    .prepare(
      `SELECT email_normalized AS email, reason, source_event_id AS sourceEventId,
        provider_message_id AS providerMessageId, detail, active,
        created_at AS createdAt, updated_at AS updatedAt
       FROM email_recipient_suppressions
       ${where}
       ORDER BY updated_at DESC, email_normalized DESC
       LIMIT ?`,
    )
    .bind(...bindings, PAGE_SIZE + 1)
    .all<EmailSuppressionRow>();
}

async function readLocalSuppressions(
  database: D1Database,
  emails: readonly string[],
): Promise<LocalSuppressionRow[]> {
  if (emails.length === 0) return [];
  const placeholders = emails.map(() => "?").join(", ");
  const result = await database
    .prepare(
      `SELECT s.email_normalized AS email, s.organization_id AS organizationId,
        o.name AS organizationName, s.profile_id AS profileId, s.active,
        s.updated_at AS updatedAt
       FROM email_provider_profile_suppressions s
       JOIN organizations o ON o.id = s.organization_id
       WHERE s.email_normalized IN (${placeholders})
       ORDER BY s.email_normalized, s.updated_at DESC
       LIMIT 500`,
    )
    .bind(...emails)
    .all<LocalSuppressionRow>();
  return result.results;
}

function invalidResponse(context: WorkerContext, message: string): Response {
  return context.json(
    {
      code: "validation_failed",
      message,
      requestId: context.get("requestId"),
    } satisfies ProblemDetails,
    400,
  );
}

async function authorizeSuppressionAdministration(
  context: WorkerContext,
  requestUrl: URL,
): Promise<Response | SuppressionAdministrator> {
  const config = validateStartupConfig(context.env);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message:
          "Global email suppression administration is available only on the product base hostname.",
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
  return { userId: authorization.value.userId };
}

async function parseReleaseRequest(
  context: WorkerContext,
): Promise<ReturnType<typeof platformEmailSuppressionReleaseRequestSchema.parse> | null> {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return null;
  }
  const parsed = platformEmailSuppressionReleaseRequestSchema.safeParse(body);
  if (!parsed.success) return null;
  return { ...parsed.data, email: parsed.data.email.trim().toLowerCase() };
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/email-suppressions", async (context) => {
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizeSuppressionAdministration(context, requestUrl);
    if (authorization instanceof Response) return authorization;

    const filters = parseFilters(requestUrl);
    if (!filters) {
      return invalidResponse(context, "The email suppression filter is invalid.");
    }
    const rows = await readSuppressionRows(context.env.CONTROL_DB, filters);
    const pageRows = rows.results.slice(0, PAGE_SIZE);
    const localRows = await readLocalSuppressions(
      context.env.CONTROL_DB,
      pageRows.map((row) => row.email),
    );
    const localByEmail = new Map<string, LocalSuppressionRow[]>();
    for (const local of localRows) {
      const existing = localByEmail.get(local.email) ?? [];
      existing.push(local);
      localByEmail.set(local.email, existing);
    }
    const suppressions = pageRows.map((row) => ({
      active: row.active === 1,
      createdAt: row.createdAt,
      detail: row.detail,
      email: row.email,
      providerMessageId: row.providerMessageId,
      reason: row.reason,
      sourceEventId: row.sourceEventId,
      updatedAt: row.updatedAt,
      localSuppressions: (localByEmail.get(row.email) ?? []).map((local) => ({
        active: local.active === 1,
        organizationId: local.organizationId,
        organizationName: local.organizationName,
        profileId: local.profileId,
        reason: "provider" as const,
        updatedAt: local.updatedAt,
      })),
    }));
    const cursorRow = suppressions.length === PAGE_SIZE ? rows.results[PAGE_SIZE - 1] : undefined;
    return context.json({
      nextCursor: rows.results.length > PAGE_SIZE && cursorRow ? encodeCursor(cursorRow) : null,
      requestId: context.get("requestId"),
      suppressions,
    });
  });

  router.post("/api/platform/email-suppressions/release", async (context) => {
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizeSuppressionAdministration(context, requestUrl);
    if (authorization instanceof Response) return authorization;

    const releaseRequest = await parseReleaseRequest(context);
    if (!releaseRequest) {
      return invalidResponse(
        context,
        "A valid recipient email and a release reason are required to clear a suppression.",
      );
    }

    const existing = await context.env.CONTROL_DB.prepare(
      `SELECT active, reason, updated_at AS updatedAt
       FROM email_recipient_suppressions
       WHERE email_normalized = ?
       LIMIT 1`,
    )
      .bind(releaseRequest.email)
      .first<{
        readonly active: number;
        readonly reason: PlatformEmailSuppression["reason"];
        readonly updatedAt: string;
      }>();
    if (!existing) {
      return context.json(
        {
          code: "email_suppression_not_found",
          message: "No application-wide suppression exists for that recipient.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    let updatedAt = existing.updatedAt;
    if (existing.active === 1) {
      updatedAt = new Date().toISOString();
      const auditId = `email-suppression-release:${releaseRequest.email}:${existing.updatedAt}`;
      await context.env.CONTROL_DB.batch([
        context.env.CONTROL_DB.prepare(
          `UPDATE email_recipient_suppressions
           SET active = 0, updated_at = ?
           WHERE email_normalized = ? AND active = 1`,
        ).bind(updatedAt, releaseRequest.email),
        context.env.CONTROL_DB.prepare(
          `INSERT OR IGNORE INTO platform_audit_events
            (id, actor_user_id, organization_id, action, target_type, target_id,
             request_id, change_summary, occurred_at)
           VALUES (?, ?, NULL, 'platform.email_suppression.released',
             'email_recipient_suppression', ?, ?, ?, ?)`,
        ).bind(
          auditId,
          authorization.userId,
          releaseRequest.email,
          context.get("requestId"),
          JSON.stringify({
            previousReason: existing.reason,
            reason: releaseRequest.reason,
          }),
          updatedAt,
        ),
      ]);
    }

    const response = {
      active: false,
      email: releaseRequest.email,
      requestId: context.get("requestId"),
      updatedAt,
    } satisfies PlatformEmailSuppressionReleaseResponse;
    return context.json(response);
  });

  router.post("/api/platform/email-suppressions/release-local", async (context) => {
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizeSuppressionAdministration(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const parsed = platformLocalEmailSuppressionReleaseRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsed.success) {
      return invalidResponse(
        context,
        "A valid recipient, Organization, Profile, and release reason are required.",
      );
    }
    const input = { ...parsed.data, email: parsed.data.email.trim().toLowerCase() };
    const local = await context.env.CONTROL_DB.prepare(
      `SELECT active FROM email_provider_profile_suppressions
       WHERE organization_id = ? AND profile_id = ? AND email_normalized = ? LIMIT 1`,
    )
      .bind(input.organizationId, input.profileId, input.email)
      .first<{ readonly active: number }>();
    if (!local) {
      return context.json(
        {
          code: "provider_suppression_not_found",
          message: "No local provider suppression exists for that profile.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const organizationStub = context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(input.organizationId),
    );
    const organizationResponse = await organizationStub.fetch(
      "https://organization.internal/internal/email/provider-suppression-release",
      {
        body: JSON.stringify({
          actorUserId: authorization.userId,
          email: input.email,
          organizationId: input.organizationId,
          profileId: input.profileId,
          reason: input.reason,
          requestId: context.get("requestId"),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!organizationResponse.ok) {
      return context.json(
        {
          code:
            organizationResponse.status === 404
              ? "provider_suppression_not_found"
              : "provider_suppression_release_failed",
          message:
            organizationResponse.status === 404
              ? "The local provider suppression could not be found."
              : "The Organization provider suppression could not be released.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        organizationResponse.status === 404 ? 404 : 503,
      );
    }
    const updatedAt = new Date().toISOString();
    await context.env.CONTROL_DB.batch([
      context.env.CONTROL_DB.prepare(
        `UPDATE email_provider_profile_suppressions
         SET active = 0, updated_at = ?
         WHERE organization_id = ? AND profile_id = ? AND email_normalized = ?`,
      ).bind(updatedAt, input.organizationId, input.profileId, input.email),
      context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.email_provider_suppression.released',
           'email_provider_profile_suppression', ?, ?, ?, ?)`,
      ).bind(
        `email-provider-suppression-release:${input.organizationId}:${input.profileId}:${updatedAt}`,
        authorization.userId,
        input.organizationId,
        input.profileId,
        context.get("requestId"),
        JSON.stringify({ email: input.email, reason: input.reason }),
        updatedAt,
      ),
    ]);
    const response: PlatformLocalEmailSuppressionReleaseResponse = {
      active: false,
      email: input.email,
      organizationId: input.organizationId,
      profileId: input.profileId,
      requestId: context.get("requestId"),
      updatedAt,
    };
    return context.json(response);
  });
}
