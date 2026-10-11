#!/usr/bin/env node
// Build-once staging release entry point for issue #134.
//
// `npm run release:staging -- --yes` shares the exact implementation with the
// existing `npm run deploy:staging` path. Both build, run the full release
// gate once, qualify staging, and retain the immutable artifact plus a
// separate staging receipt for later `npm run release:promote`.

import { pathToFileURL } from "node:url";

import { deployStaging } from "./deploy-staging-local.mjs";
import { sanitizeExternalOutput } from "./release-shared.mjs";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  deployStaging({ argv: process.argv }).catch((error) => {
    console.error(sanitizeExternalOutput(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
