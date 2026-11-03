import { z } from "zod";
import { requestIdSchema } from "./primitives";

export const checkoutReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  enabledSince: z.iso.datetime(),
  generation: z.number().int().nonnegative(),
});

export const checkoutReminderSettingsMutationSchema = z.object({ enabled: z.boolean() });
export const checkoutReminderSettingsResponseSchema = checkoutReminderSettingsSchema.extend({
  requestId: requestIdSchema,
});

export const checkoutReminderKindSchema = z.enum(["ticket", "donation"]);
export const checkoutReminderStateSchema = z.enum([
  "scheduled",
  "queued",
  "sending",
  "sent",
  "skipped",
  "failed",
]);

export const checkoutRecoveryChoicesSchema = z.object({
  kind: checkoutReminderKindSchema,
  resourceId: z.uuid(),
  bundleId: z.uuid().nullable().default(null),
  email: z.email().max(320),
  eventIds: z.array(z.uuid()).max(100),
  quantity: z.number().int().positive().max(1_000).nullable(),
  amountCents: z.number().int().nonnegative().max(10_000_000).nullable(),
  levelId: z.string().min(1).max(100).nullable(),
  discountCode: z.string().max(100).nullable(),
});

export const checkoutReminderCaptureSchema = z.object({
  organizationId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  startedAt: z.iso.datetime(),
  choices: checkoutRecoveryChoicesSchema,
});

export const checkoutReminderTokenRequestSchema = z.object({
  token: z.string().min(1).max(4_096),
});

export const checkoutReminderHistoryItemSchema = z.object({
  id: z.uuid(),
  kind: checkoutReminderKindSchema,
  email: z.email().max(320),
  resourceId: z.uuid(),
  state: checkoutReminderStateSchema,
  scheduledAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  skipReason: z.string().max(100).nullable(),
});

export type CheckoutReminderSettings = z.infer<typeof checkoutReminderSettingsSchema>;
export type CheckoutRecoveryChoices = z.infer<typeof checkoutRecoveryChoicesSchema>;
export type CheckoutReminderCapture = z.infer<typeof checkoutReminderCaptureSchema>;
