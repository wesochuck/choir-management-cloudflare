import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { FleetSchemaParams } from "../apps/worker/src/workflows/FleetSchemaWorkflow";

declare module "vitest" {
  export interface ProvidedContext {
    readonly controlMigrations: readonly D1Migration[];
  }
}

declare global {
  namespace Cloudflare {
    interface Env {
      readonly BETTER_AUTH_SECRET: string;
      readonly FLEET_SCHEMA_WORKFLOW: Workflow<FleetSchemaParams>;
      readonly JOBS_DLQ_NAME: string;
      readonly SIGNED_LINK_SECRET: string;
    }
  }
}
