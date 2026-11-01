import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { NotificationFilter, OrganizationNotificationsResponse } from "@choir/contracts";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../../api/notifications";

export function useNotifications({
  cursor = null,
  enabled = true,
  filter = "all",
  limit = 25,
  organizationId,
  userId,
}: {
  readonly cursor?: string | null | undefined;
  readonly enabled?: boolean | undefined;
  readonly filter?: NotificationFilter | undefined;
  readonly limit?: number | undefined;
  readonly organizationId: string | null | undefined;
  readonly userId: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const queryKey = [
    "notifications",
    organizationId ?? "",
    userId ?? "",
    { cursor, filter, limit },
  ] as const;
  const baseKey = ["notifications", organizationId ?? "", userId ?? ""] as const;

  const query = useQuery<OrganizationNotificationsResponse>({
    enabled: Boolean(enabled && organizationId && userId),
    queryFn: async ({ signal }) => {
      return listNotifications({ cursor, filter, limit, signal });
    },
    queryKey,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      return markNotificationRead(notificationId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async (boundary: string) => {
      return markAllNotificationsRead(boundary);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const markRead = useCallback(
    async (notificationId: string) => {
      return markReadMutation.mutateAsync(notificationId);
    },
    [markReadMutation],
  );

  const markAllRead = useCallback(
    async (boundary: string) => {
      return markAllReadMutation.mutateAsync(boundary);
    },
    [markAllReadMutation],
  );

  return {
    ...query,
    isMarkingAllRead: markAllReadMutation.isPending,
    isMarkingRead: markReadMutation.isPending,
    markAllRead,
    markRead,
  };
}
