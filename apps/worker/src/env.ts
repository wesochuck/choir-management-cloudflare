import { z } from "zod";

import type { OrganizationStore } from "./organization/OrganizationStore";
import type { CustomDomainParams } from "./workflows/CustomDomainWorkflow";
import type { FleetSchemaParams } from "./workflows/FleetSchemaWorkflow";
import type { ProvisioningParams } from "./workflows/ProvisioningWorkflow";

const appEnvironmentSchema = z.enum(["local", "staging", "production"]);

const startupConfigSchema = z.object({
  APP_ENV: appEnvironmentSchema,
  BUILD_VERSION: z.string().min(1).max(128),
  CUSTOM_DOMAIN_PROVIDER_MODE: z.enum(["cloudflare", "disabled", "fake"]),
  EXTERNAL_EFFECTS_MODE: z.enum(["disabled", "fake", "sandbox"]),
  EMAIL_EVENTS_DLQ_NAME: z.string().min(1).max(128),
  EMAIL_EVENTS_QUEUE_NAME: z.string().min(1).max(128),
  JOBS_DLQ_NAME: z.string().min(1).max(128),
  PLATFORM_EMAIL_FROM: z.email(),
  PLATFORM_EMAIL_MODE: z.enum(["capture", "disabled", "sandbox"]),
  PRODUCT_BASE_DOMAIN: z.string().min(1).max(253),
});

const betterAuthSecretSchema = z.string().min(32).max(4096);
const signedLinkSecretSchema = z.string().min(32).max(4096);

export interface Env {
  readonly APP_ENV: "staging" | "production" | "local";
  readonly ASSETS: Fetcher;
  readonly BETTER_AUTH_SECRET: string;
  readonly BREVO_API_KEY?: string | undefined;
  readonly BREVO_SMS_ALLOWED_RECIPIENTS?: string | undefined;
  readonly BREVO_SMS_SENDER?: string | undefined;
  readonly BUILD_VERSION: "staging" | "unreleased" | "development";
  readonly CLOUDFLARE_API_TOKEN?: string | undefined;
  readonly CLOUDFLARE_CUSTOM_HOSTNAMES_ZONE_ID?: string | undefined;
  readonly CONTROL_DB: D1Database;
  readonly CUSTOM_DOMAIN_PROVIDER_MODE: "cloudflare" | "disabled" | "fake";
  readonly CUSTOM_DOMAIN_WORKFLOW: Workflow<CustomDomainParams>;
  readonly EMAIL_EVENTS_DLQ_NAME: string;
  readonly EMAIL_EVENTS_QUEUE_NAME: string;
  readonly EXTERNAL_EFFECTS_MODE: "sandbox" | "disabled" | "fake";
  readonly FLEET_SCHEMA_WORKFLOW: Workflow<FleetSchemaParams>;
  readonly JOBS_QUEUE: Queue;
  readonly JOBS_DLQ_NAME: string;
  readonly ORGANIZATION_FILES: R2Bucket;
  readonly ORGANIZATION_STORE: DurableObjectNamespace<OrganizationStore>;
  readonly PLATFORM_EMAIL?: SendEmail | undefined;
  readonly PLATFORM_EMAIL_ALLOWED_RECIPIENTS?: string | undefined;
  readonly PLATFORM_EMAIL_FROM: string;
  readonly PLATFORM_EMAIL_MODE: "sandbox" | "disabled" | "capture";
  readonly PRODUCT_BASE_DOMAIN: string;
  readonly PROVISIONING_WORKFLOW: Workflow<ProvisioningParams>;
  readonly ROUTING_CACHE: KVNamespace;
  readonly SIGNED_LINK_SECRET: string;
  readonly STRIPE_SECRET_KEY?: string | undefined;
  readonly STRIPE_PAYMENTS_ENABLED?: string | undefined;
  readonly STRIPE_WEBHOOK_SECRET?: string | undefined;
  readonly STATUS_AUTOMATION_FIXTURE_MODE?: string | undefined;
}

export type StartupConfig = z.infer<typeof startupConfigSchema>;

export function validateStartupConfig(env: Env): StartupConfig {
  betterAuthSecretSchema.parse(env.BETTER_AUTH_SECRET);
  signedLinkSecretSchema.parse(env.SIGNED_LINK_SECRET);
  return startupConfigSchema.parse({
    APP_ENV: env.APP_ENV,
    BUILD_VERSION: env.BUILD_VERSION,
    CUSTOM_DOMAIN_PROVIDER_MODE: env.CUSTOM_DOMAIN_PROVIDER_MODE,
    EXTERNAL_EFFECTS_MODE: env.EXTERNAL_EFFECTS_MODE,
    EMAIL_EVENTS_DLQ_NAME: env.EMAIL_EVENTS_DLQ_NAME,
    EMAIL_EVENTS_QUEUE_NAME: env.EMAIL_EVENTS_QUEUE_NAME,
    JOBS_DLQ_NAME: env.JOBS_DLQ_NAME,
    PLATFORM_EMAIL_FROM: env.PLATFORM_EMAIL_FROM,
    PLATFORM_EMAIL_MODE: env.PLATFORM_EMAIL_MODE,
    PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
  });
}
