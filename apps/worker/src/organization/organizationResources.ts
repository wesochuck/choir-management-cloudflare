import {
  organizationResourceSchema,
  organizationResourcesResponseSchema,
  type OrganizationResource,
  type OrganizationResourceRequest,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import {
  mutateOrganizationStore,
  readOrganizationStore,
  storeErrorCode,
  storeErrorStatus,
} from "./rpc/repository";

export class ResourceRepositoryError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500 | 503,
  ) {
    super(code);
    this.name = "ResourceRepositoryError";
  }
}

async function failure(response: Response): Promise<ResourceRepositoryError> {
  return new ResourceRepositoryError(
    await storeErrorCode(response, "resource_repository_error"),
    storeErrorStatus(response),
  );
}

async function mutate(
  env: Env,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/resources/manage",
    body,
  );
  if (!response.ok) throw await failure(response);
  return response;
}

export async function listOrganizationResources(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationResource[]> {
  const response = await readOrganizationStore(env, organizationId, "/internal/resources");
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
