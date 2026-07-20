import { z } from "zod";

export const organizationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export type OrganizationId = z.infer<typeof organizationIdSchema>;

export const requestIdSchema = z.uuid();

export const healthResponseSchema = z.object({
  environment: z.enum(["local", "preview", "staging", "production"]),
  requestId: requestIdSchema,
  service: z.literal("choir-management-cloudflare"),
  status: z.literal("ok"),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const problemDetailsSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: requestIdSchema,
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
