import {
  type NotificationFilter,
  type OrganizationNotificationReadAllResponse,
  type OrganizationNotificationReadResponse,
  type OrganizationNotificationsResponse,
  organizationNotificationReadAllResponseSchema,
  organizationNotificationReadResponseSchema,
  organizationNotificationsResponseSchema,
} from "@choir/contracts";

import { request } from "./client";

export async function listNotifications(
  options: {
    readonly cursor?: string | null | undefined;
    readonly filter?: NotificationFilter | undefined;
    readonly limit?: number | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<OrganizationNotificationsResponse> {
  const searchParams = new URLSearchParams();
  if (options.cursor) {
    searchParams.set("cursor", options.cursor);
  }
  if (options.filter && options.filter !== "all") {
    searchParams.set("filter", options.filter);
  }
  if (options.limit) {
    searchParams.set("limit", String(options.limit));
  }
  const queryString = searchParams.toString();
  const path = `/api/notifications${queryString ? `?${queryString}` : ""}`;
  const response = await request(path, { signal: options.signal ?? null });
  return organizationNotificationsResponseSchema.parse(await response.json());
}

export async function markNotificationRead(
  notificationId: string,
): Promise<OrganizationNotificationReadResponse> {
  const response = await request(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST",
  });
  return organizationNotificationReadResponseSchema.parse(await response.json());
}

export async function markAllNotificationsRead(
  boundary: string,
): Promise<OrganizationNotificationReadAllResponse> {
  const response = await request("/api/notifications/read-all", {
    body: JSON.stringify({ boundary }),
    method: "POST",
  });
  return organizationNotificationReadAllResponseSchema.parse(await response.json());
}
