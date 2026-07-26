import { organizationIdSchema } from "@choir/contracts";
import { z } from "zod";

export const jobKindSchema = z.enum([
  "attendance_report",
  "audition_notification",
  "communication_delivery",
  "event_reminder",
  "organization_export",
  "projection_publish",
  "stale_checkout_cleanup",
  "ticket_notification",
]);

export const deliveryJobSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
  kind: jobKindSchema,
  organizationId: organizationIdSchema,
  version: z.literal(1),
});

export type DeliveryJob = z.infer<typeof deliveryJobSchema>;
