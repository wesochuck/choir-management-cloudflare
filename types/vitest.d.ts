import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare module "vitest" {
  export interface ProvidedContext {
    readonly controlMigrations: readonly D1Migration[];
  }
}

declare global {
  namespace Cloudflare {
    interface Env {
      readonly BETTER_AUTH_SECRET: string;
    }
  }
}
