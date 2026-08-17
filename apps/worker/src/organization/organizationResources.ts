import {
  organizationResourceSchema,
  organizationResourcesResponseSchema,
  type OrganizationResource,
  type OrganizationResourceRequest,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";

export class ResourceRepositoryError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500 | 503,
  ) {
    super(code);
    this.name = "ResourceRepositoryError";
  }
}

function stub(env: Env, organizationId: string): ReturnType<typeof organizationStoreStub> {
  return organizationStoreStub(env, organizationId);
}

async function failure(response: Response): Promise<ResourceRepositoryError> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : "resource_repository_error";
  let status: ResourceRepositoryError["status"] = 503;
  if (response.status === 400) status = 400;
  else if (response.status === 404) status = 404;
  else if (response.status === 409) status = 409;
  else if (response.status === 500) status = 500;
  return new ResourceRepositoryError(code, status);
}

async function mutate(
  env: Env,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await invokeOrganizationRpc(
    stub(env, organizationId),
    "https://organization.internal/internal/resources/manage",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw await failure(response);
  return response;
}

export async function listOrganizationResources(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationResource[]> {
  const url = new URL("https://organization.internal/internal/resources");
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(stub(env, organizationId), url);
  if (!response.ok) throw await failure(response);
  return organizationResourcesResponseSchema.omit({ requestId: true }).parse(await response.json())
    .resources;
}

interface Context {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export async function createOrganizationResource(
  env: Env,
  context: Context,
  resource: OrganizationResourceRequest,
): Promise<OrganizationResource> {
  const resourceId = crypto.randomUUID();
  const response = await mutate(env, context.organizationId, {
    action: "create",
    ...context,
    resource,
    resourceId,
  });
  return organizationResourceSchema.parse(await response.json());
}

export async function updateOrganizationResource(
  env: Env,
  context: Context,
  resourceId: string,
  resource: OrganizationResourceRequest,
): Promise<{ readonly previousFileId: string | null; readonly resource: OrganizationResource }> {
  const response = await mutate(env, context.organizationId, {
    action: "update",
    ...context,
    resource,
    resourceId,
  });
  const result = z
    .object({
      previousFileId: z.uuid().nullable(),
      resource: organizationResourceSchema,
    })
    .parse(await response.json());
  return result;
}

export async function deleteOrganizationResource(
  env: Env,
  context: Context,
  resourceId: string,
): Promise<OrganizationResource> {
  const response = await mutate(env, context.organizationId, {
    action: "delete",
    ...context,
    resourceId,
  });
  return organizationResourceSchema.parse(await response.json());
}

export async function reorderOrganizationResources(
  env: Env,
  context: Context,
  resourceIds: readonly string[],
): Promise<void> {
  await mutate(env, context.organizationId, { action: "reorder", ...context, resourceIds });
}
