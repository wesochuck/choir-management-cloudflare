import { z } from "zod";
import { communicationChannelSchema, communicationMessageSchema } from "./communications";

export const communicationOverviewItemSchema = z.object({
  id: z.string().min(1).max(256),
  source: z.enum(["message", "ticket", "audition", "checkout_reminder", "scheduler"]),
  subject: z.string().max(500),
  timestamp: z.iso.datetime(),
  channel: communicationChannelSchema,
  automatic: z.boolean(),
  status: z.enum(["Draft", "Sent", "Sent with issues", "Failed", "Delayed", "Scheduled", "Queued"]),
  projected: z.boolean(),
  recipientCount: z.number().int().nonnegative().nullable(),
  href: z.string().startsWith("/admin/").max(1000),
  message: communicationMessageSchema.nullable(),
});
export type CommunicationOverviewItem = z.infer<typeof communicationOverviewItemSchema>;

export const communicationOverviewSchema = z.object({
  timezone: z.string().min(1).max(100),
  asOf: z.iso.datetime(),
  drafts: z.array(communicationOverviewItemSchema).max(3),
  recent: z.array(communicationOverviewItemSchema).max(5),
  upcoming: z.array(communicationOverviewItemSchema).max(3),
  attention: z.array(communicationOverviewItemSchema).max(3),
  hasMore: z.object({
    drafts: z.boolean(),
    recent: z.boolean(),
    upcoming: z.boolean(),
    attention: z.boolean(),
  }),
});
export type CommunicationOverview = z.infer<typeof communicationOverviewSchema>;
