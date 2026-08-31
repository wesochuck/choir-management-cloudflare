#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {{ readonly ok: boolean; readonly errors: readonly string[] }} CspCheckResult
 */

/**
 * @param {string} policy
 * @returns {Map<string, string[]>}
 */
export function parseDirectives(policy) {
  const directives = new Map();
  const tokens = policy
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const [name, ...sources] = token.split(/\s+/);
    if (name) {
      directives.set(name.toLowerCase(), sources);
    }
  }
  return directives;
}

/**
 * @param {string} routerSource
 * @returns {string[]}
 */
export function extractBaselineFromRouter(routerSource) {
  const match = routerSource.match(
    /export\s+function\s+buildContentSecurityPolicy\s*\([^)]*\)\s*:\s*string\s*\{([\s\S]*?)\n\}/,
  );
  if (!match) {
    throw new Error("Could not find buildContentSecurityPolicy in apps/worker/src/router.ts");
  }
  const body = match[1] ?? "";
  const arrayMatch = body.match(/return\s*\[([\s\S]*?)\]\.join/);
  if (!arrayMatch) {
    throw new Error("Could not parse directive array from buildContentSecurityPolicy");
  }

  const rawLines = (arrayMatch[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const baselineDirectives = [];
  for (const line of rawLines) {
    if (line.includes("scriptDirective")) {
      baselineDirectives.push(
        "script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
      );
    } else {
      const stringMatch = line.match(/^"([^"]+)",?$/);
      if (stringMatch && stringMatch[1]) {
        baselineDirectives.push(stringMatch[1]);
      }
    }
  }
  return baselineDirectives;
}

/**
 * @param {string} headersContent
 * @param {string} routerSource
 * @returns {CspCheckResult}
 */
export function validateStaticCsp(headersContent, routerSource) {
  const errors = [];

  const cspHeaderMatch = headersContent.match(/^\s*Content-Security-Policy:\s*(.+)$/im);
  if (!cspHeaderMatch || !cspHeaderMatch[1]) {
    return {
      errors: ["Content-Security-Policy header is missing from apps/web/public/_headers"],
      ok: false,
    };
  }

  const cspHeaderValue = cspHeaderMatch[1].trim();
  const directives = parseDirectives(cspHeaderValue);

  // 1. Strict protections
  const frameAncestors = directives.get("frame-ancestors");
  if (!frameAncestors || !frameAncestors.includes("'none'")) {
    errors.push("Directives must enforce `frame-ancestors 'none'`");
  }

  const objectSrc = directives.get("object-src");
  if (!objectSrc || !objectSrc.includes("'none'")) {
    errors.push("Directives must enforce `object-src 'none'`");
  }

  const baseUri = directives.get("base-uri");
  if (!baseUri || !baseUri.includes("'self'")) {
    errors.push("Directives must enforce `base-uri 'self'`");
  }

  // 2. Cloudflare Insights and Turnstile origins
  const scriptSrc = directives.get("script-src") ?? [];
  if (!scriptSrc.includes("https://static.cloudflareinsights.com")) {
    errors.push("`script-src` must include https://static.cloudflareinsights.com");
  }
  if (!scriptSrc.includes("https://challenges.cloudflare.com")) {
    errors.push("`script-src` must include https://challenges.cloudflare.com");
  }

  const connectSrc = directives.get("connect-src") ?? [];
  if (!connectSrc.includes("https://cloudflareinsights.com")) {
    errors.push("`connect-src` must include https://cloudflareinsights.com");
  }
  if (!connectSrc.includes("https://challenges.cloudflare.com")) {
    errors.push("`connect-src` must include https://challenges.cloudflare.com");
  }

  const frameSrc = directives.get("frame-src") ?? [];
  if (!frameSrc.includes("https://challenges.cloudflare.com")) {
    errors.push("`frame-src` must include https://challenges.cloudflare.com");
  }

  // 3. Baseline comparison with Worker router
  try {
    const baseline = extractBaselineFromRouter(routerSource);
    const baselineDirectivesMap = parseDirectives(baseline.join("; "));

    for (const [name, baselineSources] of baselineDirectivesMap.entries()) {
      const headerSources = directives.get(name);
      if (!headerSources) {
        errors.push(`Missing directive required by Worker baseline: \`${name}\``);
        continue;
      }
      const headerSet = new Set(headerSources);
      for (const src of baselineSources) {
        if (!headerSet.has(src)) {
          errors.push(
            `Directive \`${name}\` is missing source \`${src}\` required by Worker baseline`,
          );
        }
      }
    }

    for (const name of directives.keys()) {
      if (!baselineDirectivesMap.has(name)) {
        errors.push(
          `Static CSP defines unexpected directive not present in Worker baseline: \`${name}\``,
        );
      }
    }
  } catch (extractionError) {
    errors.push(
      `Worker baseline comparison error: ${extractionError instanceof Error ? extractionError.message : String(extractionError)}`,
    );
  }

  return {
    errors,
    ok: errors.length === 0,
  };
}

/**
 * @returns {CspCheckResult}
 */
export function runCspCheck() {
  const headersPath = join(repositoryRoot, "apps/web/public/_headers");
  const routerPath = join(repositoryRoot, "apps/worker/src/router.ts");

  const headersContent = readFileSync(headersPath, "utf8");
  const routerSource = readFileSync(routerPath, "utf8");

  return validateStaticCsp(headersContent, routerSource);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCspCheck();
  if (!result.ok) {
    console.error("CSP verification failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  } else {
    console.log(
      "CSP verification passed: apps/web/public/_headers matches Worker security baseline.",
    );
  }
}
