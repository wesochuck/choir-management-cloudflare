import {
  adminSearchQueryResponseSchema,
  type AdminSearchQueryRequest,
  type SearchResultItem,
} from "@choir/contracts";

import { request } from "./client";

export async function searchOrganization(
  params: AdminSearchQueryRequest,
  signal?: AbortSignal,
): Promise<readonly SearchResultItem[]> {
  const url = new URL("/api/organization/search", "https://app.internal");
  url.searchParams.set("q", params.query);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.includeHidden) url.searchParams.set("includeHidden", "true");

  const path = `${url.pathname}${url.search}`;
  const response = await request(path, { signal: signal ?? null });
  return adminSearchQueryResponseSchema.parse(await response.json()).results;
}
