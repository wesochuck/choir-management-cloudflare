import { z } from "zod";
import { requestIdSchema } from "./primitives";

export const notificationKindSchema = z.enum([
  "audition",
  "ticket_sale",
  "donation",
  "rsvp_decline",
  "compliance",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationFilterSchema = z.enum([
  "all",
  "unread",
  "audition",
  "ticket_sale",
  "donation",
  "rsvp_decline",
  "compliance",
]);
export type NotificationFilter = z.infer<typeof notificationFilterSchema>;

export const organizationNotificationSchema = z.object({
  body: z.string().max(1_000),
  createdAt: z.iso.datetime(),
  destinationPath: z.string().max(500).nullable(),
  expiresAt: z.iso.datetime(),
  id: z.uuid(),
  kind: notificationKindSchema,
  readAt: z.iso.datetime().nullable(),
  title: z.string().min(1).max(200),
});

export type OrganizationNotification = z.infer<typeof organizationNotificationSchema>;

export const organizationNotificationsResponseSchema = z.object({
  hasMoreUnread: z.boolean(),
  nextCursor: z.string().nullable(),
  notifications: z.array(organizationNotificationSchema).max(100),
  requestId: requestIdSchema,
  snapshotBoundary: z.iso.datetime(),
  unreadCount: z.number().int().nonnegative(),
});

export type OrganizationNotificationsResponse = z.infer<
  typeof organizationNotificationsResponseSchema
>;

export const organizationNotificationReadResponseSchema = z.object({
  notification: organizationNotificationSchema,
  requestId: requestIdSchema,
  success: z.literal(true),
});

export type OrganizationNotificationReadResponse = z.infer<
  typeof organizationNotificationReadResponseSchema
>;

export const organizationNotificationReadAllRequestSchema = z.object({
  boundary: z.iso.datetime(),
});

export type OrganizationNotificationReadAllRequest = z.infer<
  typeof organizationNotificationReadAllRequestSchema
>;

export const organizationNotificationReadAllResponseSchema = z.object({
  markedCount: z.number().int().nonnegative(),
  requestId: requestIdSchema,
  success: z.literal(true),
});

export type OrganizationNotificationReadAllResponse = z.infer<
  typeof organizationNotificationReadAllResponseSchema
>;
