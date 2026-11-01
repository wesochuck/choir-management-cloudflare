import {
  type NotificationFilter,
  type OrganizationNotification,
  type OrganizationNotificationsResponse,
  organizationNotificationSchema,
  organizationNotificationsResponseSchema,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import {
  mutateOrganizationStore,
  readOrganizationStore,
  storeErrorCode,
  storeErrorStatus,
} from "./rpc/repository";

export class NotificationRepositoryError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 409 | 500 | 503,
  ) {
    super(code);
    this.name = "NotificationRepositoryError";
  }
}

async function failure(response: Response): Promise<NotificationRepositoryError> {
  return new NotificationRepositoryError(
    await storeErrorCode(response, "notification_repository_error"),
    storeErrorStatus(response),
  );
}

export async function listOrganizationNotifications(
  env: Env,
  organizationId: string,
  parameters: {
    readonly cursor?: string | null | undefined;
    readonly filter?: NotificationFilter | undefined;
    readonly limit?: number | undefined;
    readonly profileId: string;
  },
): Promise<Omit<OrganizationNotificationsResponse, "requestId">> {
  const query: Record<string, string> = {
    profileId: parameters.profileId,
  };
  if (parameters.cursor) {
    query.cursor = parameters.cursor;
  }
  if (parameters.filter && parameters.filter !== "all") {
    query.filter = parameters.filter;
  }
  if (parameters.limit) {
    query.limit = String(parameters.limit);
  }

  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/notifications",
    query,
  );
  if (!response.ok) throw await failure(response);
  return organizationNotificationsResponseSchema
    .omit({ requestId: true })
    .parse(await response.json());
}

export async function markOrganizationNotificationRead(
  env: Env,
  organizationId: string,
  parameters: {
    readonly notificationId: string;
    readonly profileId: string;
  },
): Promise<OrganizationNotification> {
  const response = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/notifications/read",
    parameters,
  );
  if (!response.ok) throw await failure(response);
  const parsed = z
    .object({ notification: organizationNotificationSchema })
    .parse(await response.json());
  return parsed.notification;
}

export async function markAllOrganizationNotificationsRead(
  env: Env,
  organizationId: string,
  parameters: {
    readonly boundary: string;
    readonly profileId: string;
  },
): Promise<number> {
  const response = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/notifications/read-all",
    parameters,
  );
  if (!response.ok) throw await failure(response);
  const parsed = z
    .object({ markedCount: z.number().int().nonnegative() })
    .parse(await response.json());
  return parsed.markedCount;
}
