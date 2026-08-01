import { z } from "zod";
import { organizationIdSchema, requestIdSchema } from "./primitives";
export const problemDetailsSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: requestIdSchema,
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const setupStatusSchema = z.object({
  organizationId: organizationIdSchema,
  organizationName: z.string().min(1).max(120),
  completedSteps: z.array(z.string()),
  currentStep: z.string().nullable(),
  allModulesConfigured: z.boolean(),
  launched: z.boolean(),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const moduleStateSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export const moduleStatesResponseSchema = z.object({
  modules: z.array(moduleStateSchema),
});

export type ModuleState = z.infer<typeof moduleStateSchema>;
export type ModuleStatesResponse = z.infer<typeof moduleStatesResponseSchema>;

export const setupProgressRequestSchema = z.object({
  step: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type SetupProgressRequest = z.infer<typeof setupProgressRequestSchema>;

export const setupClaimResponseSchema = z.object({
  claimed: z.boolean(),
  organizationId: organizationIdSchema,
});

export type SetupClaimResponse = z.infer<typeof setupClaimResponseSchema>;
