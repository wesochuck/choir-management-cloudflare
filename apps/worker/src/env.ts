import { z } from "zod";

import type { OrganizationStore } from "./organization/OrganizationStore";
import type { FleetSchemaParams } from "./workflows/FleetSchemaWorkflow";
import type { ProvisioningParams } from "./workflows/ProvisioningWorkflow";

export const appEnvironmentSchema = z.enum(["local", "preview", "staging", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

const startupConfigSchema = z.object({
  APP_ENV: appEnvironmentSchema,
  BUILD_VERSION: z.string().min(1).max(128),
  EXTERNAL_EFFECTS_MODE: z.enum(["disabled", "fake", "sandbox"]),
  JOBS_DLQ_NAME: z.string().min(1).max(128),
  PLATFORM_EMAIL_FROM: z.email(),
  PLATFORM_EMAIL_MODE: z.enum(["capture", "disabled", "sandbox"]),
  PRODUCT_BASE_DOMAIN: z.string().min(1).max(253),
});

const betterAuthSecretSchema = z.string().min(32).max(4096);
const signedLinkSecretSchema = z.string().min(32).max(4096);

export interface Env {
  readonly APP_ENV: string;
  readonly ASSETS: Fetcher;
  readonly BETTER_AUTH_SECRET: string;
  readonly BREVO_API_KEY?: string;
  readonly BREVO_EMAIL_FROM?: string;
  readonly BREVO_EMAIL_FROM_NAME?: string;
  readonly BREVO_SMS_ALLOWED_RECIPIENTS?: string;
  readonly BREVO_SMS_SENDER?: string;
  readonly BUILD_VERSION: string;
  readonly CONTROL_DB: D1Database;
  readonly EXTERNAL_EFFECTS_MODE: string;
  readonly FLEET_SCHEMA_WORKFLOW: Workflow<FleetSchemaParams>;
  readonly JOBS_QUEUE: Queue;
  readonly JOBS_DLQ_NAME: string;
  readonly ORGANIZATION_FILES: R2Bucket;
  readonly ORGANIZATION_STORE: DurableObjectNamespace<OrganizationStore>;
  readonly PLATFORM_EMAIL?: SendEmail;
  readonly PLATFORM_EMAIL_ALLOWED_RECIPIENTS?: string;
  readonly PLATFORM_EMAIL_FROM: string;
  readonly PLATFORM_EMAIL_MODE: string;
  readonly PRODUCT_BASE_DOMAIN: string;
  readonly PROVISIONING_WORKFLOW: Workflow<ProvisioningParams>;
  readonly ROUTING_CACHE: KVNamespace;
  readonly SIGNED_LINK_SECRET: string;
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
}

export type StartupConfig = z.infer<typeof startupConfigSchema>;

export function validateStartupConfig(env: Env): StartupConfig {
  betterAuthSecretSchema.parse(env.BETTER_AUTH_SECRET);
  signedLinkSecretSchema.parse(env.SIGNED_LINK_SECRET);
  return startupConfigSchema.parse({
    APP_ENV: env.APP_ENV,
    BUILD_VERSION: env.BUILD_VERSION,
    EXTERNAL_EFFECTS_MODE: env.EXTERNAL_EFFECTS_MODE,
    JOBS_DLQ_NAME: env.JOBS_DLQ_NAME,
    PLATFORM_EMAIL_FROM: env.PLATFORM_EMAIL_FROM,
    PLATFORM_EMAIL_MODE: env.PLATFORM_EMAIL_MODE,
    PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
  });
}
