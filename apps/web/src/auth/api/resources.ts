import {
  organizationResourceDeleteResponseSchema,
  organizationResourceResponseSchema,
  organizationResourcesResponseSchema,
  type OrganizationResource,
  type OrganizationResourceRequest,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationResources(
  signal?: AbortSignal,
): Promise<readonly OrganizationResource[]> {
  const response = await request("/api/organization/resources", { signal: signal ?? null });
  return organizationResourcesResponseSchema.parse(await response.json()).resources;
}

export async function createOrganizationResource(
  resource: OrganizationResourceRequest,
): Promise<OrganizationResource> {
  const response = await request("/api/organization/resources", {
    body: JSON.stringify(resource),
    method: "POST",
  });
  return organizationResourceResponseSchema.parse(await response.json());
}

export async function updateOrganizationResource(
  resourceId: string,
  resource: OrganizationResourceRequest,
): Promise<OrganizationResource> {
  const response = await request(`/api/organization/resources/${encodeURIComponent(resourceId)}`, {
    body: JSON.stringify(resource),
    method: "PUT",
  });
  return organizationResourceResponseSchema.parse(await response.json());
}

export async function reorderOrganizationResources(resourceIds: readonly string[]): Promise<void> {
  await request("/api/organization/resources/order", {
    body: JSON.stringify({ resourceIds }),
    method: "PUT",
  });
}

export async function deleteOrganizationResource(resourceId: string): Promise<void> {
  const response = await request(`/api/organization/resources/${encodeURIComponent(resourceId)}`, {
    method: "DELETE",
  });
  organizationResourceDeleteResponseSchema.parse(await response.json());
}
