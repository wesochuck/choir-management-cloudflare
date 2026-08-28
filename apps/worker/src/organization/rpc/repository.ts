import type { Env } from "../../env";
import { invokeOrganizationRpc, organizationStoreStub } from "./client";

/**
 * Shared Organization-store RPC repository helpers. Worker repository modules
 * previously re-implemented the same stub alias, error-code extraction, URL
 * construction, and JSON mutation transport; these helpers are the single
 * source of truth while each module keeps its own typed error classes and
 * status branching.
 */

export async function storeErrorCode(response: Response, fallback: string): Promise<string> {
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : fallback;
}

export function storeErrorStatus(response: Response): 400 | 404 | 409 | 500 | 503 {
  return response.status === 400 ||
    response.status === 404 ||
    response.status === 409 ||
    response.status === 500
    ? response.status
    : 503;
}

export function organizationStoreUrl(
  path: string,
  parameters: Readonly<Record<string, string>> = {},
): URL {
  const url = new URL(`https://organization.internal${path}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

export async function readOrganizationStore(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  path: string,
  parameters: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const url = organizationStoreUrl(path, { organizationId, ...parameters });
  return invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
}

export async function mutateOrganizationStore(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return invokeOrganizationRpc(
    organizationStoreStub(env, organizationId),
    `https://organization.internal${path}`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
