import { z } from "zod";

export const organizationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export type OrganizationId = z.infer<typeof organizationIdSchema>;

export const requestIdSchema = z.uuid();

/** The canonical email validator shared by CSV/domain parsing and API contracts. */
export const emailAddressSchema = z.email();

export const healthResponseSchema = z.object({
  environment: z.enum(["local", "preview", "staging", "production"]),
  fingerprint: z.literal("cloudflare-worker").default("cloudflare-worker"),
  requestId: requestIdSchema,
  service: z.literal("choir-management-cloudflare"),
  status: z.literal("ok"),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const platformSetupCheckSchema = z.object({
  detail: z.string().min(1).max(500),
  id: z.enum([
    "startup_configuration",
    "control_plane",
    "platform_mfa",
    "email_delivery",
    "background_jobs",
    "schema",
    "stripe",
    "brevo",
  ]),
  label: z.string().min(1).max(120),
  status: z.enum(["attention", "error", "ok"]),
});

export const platformSetupStatusResponseSchema = z.object({
  checks: z.array(platformSetupCheckSchema).max(10),
  environment: z.enum(["local", "preview", "staging", "production"]),
  jobDeadLetterCount: z.number().int().nonnegative().nullable(),
  organizationCount: z.number().int().nonnegative().nullable(),
  requestId: requestIdSchema,
  version: z.string().min(1),
});

export type PlatformSetupCheck = z.infer<typeof platformSetupCheckSchema>;
export type PlatformSetupStatusResponse = z.infer<typeof platformSetupStatusResponseSchema>;

const providerSetupCheckSchema = z.object({
  detail: z.string().min(1).max(500),
  status: z.enum(["attention", "error", "ok"]),
});

const organizationEmailSenderSchema = z.object({
  fromEmail: z.email().nullable(),
  fromName: z.string().min(1).max(200).nullable(),
});

export const organizationProviderStatusResponseSchema = z.object({
  brevo: providerSetupCheckSchema,
  emailSender: organizationEmailSenderSchema,
  environment: z.enum(["local", "preview", "staging", "production"]),
  externalEffectsMode: z.enum(["disabled", "fake", "sandbox"]),
  requestId: requestIdSchema,
  stripe: providerSetupCheckSchema,
});

export type OrganizationProviderStatusResponse = z.infer<
  typeof organizationProviderStatusResponseSchema
>;

export const paymentModuleIdSchema = z.enum(["tickets", "donations", "dues"]);

export const paymentActivationSettingsSchema = z.object({
  donations: z.boolean(),
  dues: z.boolean(),
  tickets: z.boolean(),
});

export const paymentActivationRequestSchema = z.object({
  enabled: z.boolean(),
  moduleId: paymentModuleIdSchema,
  confirm: z.literal(true),
});

export const organizationPaymentSettingsResponseSchema = z.object({
  activations: paymentActivationSettingsSchema,
  environment: z.enum(["local", "preview", "staging", "production"]),
  externalEffectsMode: z.enum(["disabled", "fake", "sandbox"]),
  globalPaymentsEnabled: z.boolean(),
  organizationName: z.string().min(1).max(120),
  readiness: z.object({
    brevoConfigured: z.boolean(),
    stripeAccountReady: z.boolean(),
    stripeConfigured: z.boolean(),
    webhookConfigured: z.boolean(),
  }),
  requestId: requestIdSchema,
  stripe: z.object({
    accountId: z
      .string()
      .regex(/^acct_[A-Za-z0-9]+$/)
      .nullable(),
    chargesEnabled: z.boolean(),
    detailsSubmitted: z.boolean(),
    payoutsEnabled: z.boolean(),
    requirementsDue: z.array(z.string().min(1).max(200)).max(100),
    status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
  }),
});

export type PaymentModuleId = z.infer<typeof paymentModuleIdSchema>;
export type PaymentActivationSettings = z.infer<typeof paymentActivationSettingsSchema>;
export type PaymentActivationRequest = z.infer<typeof paymentActivationRequestSchema>;
export type OrganizationPaymentSettingsResponse = z.infer<
  typeof organizationPaymentSettingsResponseSchema
>;

const stripeConnectStatusSchema = z.object({
  accountId: z
    .string()
    .regex(/^acct_[A-Za-z0-9]+$/)
    .nullable(),
  chargesEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  payoutsEnabled: z.boolean(),
  requirementsDue: z.array(z.string().min(1).max(200)).max(100),
  status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
});

export const organizationStripeConnectStatusResponseSchema = z.object({
  platformConfigured: z.boolean(),
  requestId: requestIdSchema,
  stripe: stripeConnectStatusSchema,
});

export type OrganizationStripeConnectStatusResponse = z.infer<
  typeof organizationStripeConnectStatusResponseSchema
>;

export const organizationStripeConnectOnboardingResponseSchema = z.object({
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  requestId: requestIdSchema,
  status: stripeConnectStatusSchema.shape.status,
  url: z.url(),
});

export type OrganizationStripeConnectOnboardingResponse = z.infer<
  typeof organizationStripeConnectOnboardingResponseSchema
>;

export const organizationContextResponseSchema = z.object({
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
  role: z.enum(["owner", "administrator", "member"]),
  userId: z.string().min(1),
});

export type OrganizationContextResponse = z.infer<typeof organizationContextResponseSchema>;
