import {
  adminSearchQueryResponseSchema,
  searchCategorySchema,
  searchResultItemSchema,
  type ProblemDetails,
  type SearchCategory,
  type SearchResultItem,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import type { Env } from "../env";
import { listOrganizationProfileEmails } from "../organization/profiles";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

const internalSearchResponseSchema = z.object({
  results: z.array(searchResultItemSchema),
});

async function findEmailMatchedProfileIds(
  database: D1Database,
  organizationId: string,
  query: string,
  limit: number,
): Promise<readonly string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const emailLike = `%${trimmed}%`;
  const emailRows = await database
    .prepare(
      `SELECT m.profileId AS profileId
       FROM member m
       JOIN user u ON u.id = m.userId
       WHERE m.organizationId = ? AND m.profileId IS NOT NULL AND (u.email LIKE ? OR u.name LIKE ?)
       LIMIT ?`,
    )
    .bind(organizationId, emailLike, emailLike, limit)
    .all<{ profileId: string }>();
  return emailRows.results.map((r) => r.profileId);
}

async function enrichRosterResults(
  database: D1Database,
  organizationId: string,
  items: readonly SearchResultItem[],
): Promise<readonly SearchResultItem[]> {
  const rosterItems = items.filter((r) => r.category === "roster");
  if (rosterItems.length === 0) return items;

  const emailMap = await listOrganizationProfileEmails(database, organizationId);
  return items.map((item) => {
    if (item.category !== "roster") return item;
    const profileId = item.id.replace(/^roster-/, "");
    const email = emailMap.get(profileId);
    if (!email) return item;
    const subtitle = item.subtitle ? `${item.subtitle} • ${email}` : email;
    return { ...item, subtitle };
  });
}

async function fetchInternalSearchResults(
  env: Env,
  organizationId: string,
  query: string,
  category: SearchCategory | undefined,
  limit: number,
  profileIds: readonly string[],
): Promise<readonly SearchResultItem[] | null> {
  const stub = organizationStoreStub(env, organizationId);
  const url = new URL("https://organization.internal/internal/search");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("q", query);
  if (category) url.searchParams.set("category", category);
  if (limit) url.searchParams.set("limit", String(limit));
  if (profileIds.length > 0) {
    url.searchParams.set("profileIds", profileIds.join(","));
  }

  const response = await invokeOrganizationRpc(stub, url.toString());
  if (!response.ok) return null;

  const body: unknown = await response.json();
  const parsed = internalSearchResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.results : [];
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/search", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const query = context.req.query("q") ?? "";
    const categoryParsed = searchCategorySchema.optional().safeParse(context.req.query("category"));
    const category = categoryParsed.success ? categoryParsed.data : undefined;
    const limitParam = context.req.query("limit");
    const limit = limitParam ? Number(limitParam) : 20;

    try {
      const emailProfileIds =
        !category || category === "roster"
          ? await findEmailMatchedProfileIds(
              context.env.CONTROL_DB,
              authorization.organizationId,
              query,
              limit,
            )
          : [];

      const rawResults = await fetchInternalSearchResults(
        context.env,
        authorization.organizationId,
        query,
        category,
        limit,
        emailProfileIds,
      );

      if (rawResults === null) {
        return context.json(
          {
            code: "search_failed",
            message: "Unable to complete search request.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          500,
        );
      }

      const results = await enrichRosterResults(
        context.env.CONTROL_DB,
        authorization.organizationId,
        rawResults,
      );

      const parsedResponse = adminSearchQueryResponseSchema.parse({
        requestId: context.get("requestId"),
        results,
      });

      return context.json(parsedResponse);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization search is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
