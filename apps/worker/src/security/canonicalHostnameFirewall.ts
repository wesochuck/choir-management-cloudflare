import { z } from "zod";

import type { Env } from "../env";

export type CanonicalHostnameFirewallMode = "cloudflare-inline" | "disabled" | "fake";
export type CanonicalHostnameFirewallAction = "block" | "log";

export const DEFAULT_FIREWALL_RULE_DESCRIPTION =
  "Managed Choir Manager Canonical Hostname Firewall";
export const MAX_WAF_EXPRESSION_LENGTH = 4000;

export interface CanonicalHostnameDatabase {
  prepare(query: string): {
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  };
}

export type CanonicalHostnameFirewallEnv = Pick<Env, "APP_ENV" | "PRODUCT_BASE_DOMAIN"> & {
  readonly CONTROL_DB: CanonicalHostnameDatabase;
} & Partial<
    Pick<
      Env,
      | "CANONICAL_HOSTNAME_FIREWALL_MODE"
      | "CLOUDFLARE_WAF_API_TOKEN"
      | "CLOUDFLARE_WAF_ZONE_ID"
      | "CLOUDFLARE_WAF_RULESET_ID"
      | "CLOUDFLARE_WAF_RULE_ID"
      | "CLOUDFLARE_WAF_RULE_ACTION"
    >
  >;

export interface CanonicalHostnameFirewallResult {
  readonly action: CanonicalHostnameFirewallAction;
  readonly changed: boolean;
  readonly desiredHostnameCount: number;
  readonly environment: string;
  readonly expressionLength: number;
  readonly mode: CanonicalHostnameFirewallMode;
  readonly ruleId: string | null;
}

export class CanonicalHostnameFirewallError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CanonicalHostnameFirewallError";
  }
}

const cloudflareErrorSchema = z.object({
  code: z.number().int().optional(),
  message: z.string().min(1).max(500),
});

const cloudflareRuleSchema = z.object({
  action: z.string().min(1).max(64),
  description: z.string().min(1).max(500).optional(),
  enabled: z.boolean().default(true),
  expression: z.string().min(1),
  id: z.string().min(1).max(128),
  last_updated: z.string().optional(),
  version: z.string().optional(),
});

type CloudflareRule = z.infer<typeof cloudflareRuleSchema>;

const cloudflareRulesetSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().optional(),
  phase: z.string().optional(),
  rules: z.array(cloudflareRuleSchema).default([]),
});

const cloudflareRuleEnvelopeSchema = z.object({
  errors: z.array(cloudflareErrorSchema).default([]),
  messages: z.array(z.unknown()).default([]),
  result: cloudflareRuleSchema.optional(),
  success: z.boolean(),
});

const cloudflareRulesetEnvelopeSchema = z.object({
  errors: z.array(cloudflareErrorSchema).default([]),
  messages: z.array(z.unknown()).default([]),
  result: cloudflareRulesetSchema.optional(),
  success: z.boolean(),
});

export function normalizeCanonicalHostname(hostname: string): string {
  const trimmed = hostname.trim();
  const lower = trimmed.toLowerCase();
  const withoutDot = lower.endsWith(".") ? lower.slice(0, -1) : lower;

  if (!withoutDot || withoutDot.length > 253) {
    throw new CanonicalHostnameFirewallError(
      `Invalid canonical hostname: "${hostname}" exceeds allowable length limits (1-253 chars).`,
    );
  }

  const labels = withoutDot.split(".");
  for (const label of labels) {
    if (!label || label.length > 63) {
      throw new CanonicalHostnameFirewallError(
        `Invalid canonical hostname: label "${label}" in "${hostname}" exceeds allowable length (1-63 chars).`,
      );
    }
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      throw new CanonicalHostnameFirewallError(
        `Invalid canonical hostname: "${hostname}" contains invalid characters or malformed labels.`,
      );
    }
  }

  return withoutDot;
}

export async function readDesiredCanonicalHostnames(
  db: CanonicalHostnameDatabase,
  productBaseDomain: string,
  appEnv: "staging" | "production" | "local",
): Promise<readonly string[]> {
  const rows = await db
    .prepare(
      `SELECT hostname
       FROM organization_domains
       WHERE kind = 'canonical'
         AND status <> 'disabled'
       ORDER BY hostname`,
    )
    .all<{ readonly hostname: string }>();

  const normalizedBase = normalizeCanonicalHostname(productBaseDomain);
  const stagingSuffix = `.staging.${normalizedBase}`;
  const stagingApex = `staging.${normalizedBase}`;
  const prodSuffix = `.${normalizedBase}`;

  const validHostnames = new Set<string>();

  for (const row of rows.results) {
    const host = normalizeCanonicalHostname(row.hostname);

    if (appEnv === "staging") {
      if (host.endsWith(stagingSuffix) && host !== stagingApex) {
        validHostnames.add(host);
      }
    } else if (appEnv === "production") {
      if (
        host.endsWith(prodSuffix) &&
        host !== normalizedBase &&
        host !== stagingApex &&
        !host.endsWith(stagingSuffix)
      ) {
        validHostnames.add(host);
      }
    } else {
      if (
        host.endsWith(stagingSuffix) ||
        host.endsWith(".localhost") ||
        (host.endsWith(prodSuffix) && host !== normalizedBase)
      ) {
        validHostnames.add(host);
      }
    }
  }

  return Array.from(validHostnames).sort();
}

export function buildCanonicalHostnameWafExpression(params: {
  readonly appEnv: "staging" | "production" | "local";
  readonly hostnames: readonly string[];
  readonly productBaseDomain: string;
}): string {
  const base = normalizeCanonicalHostname(params.productBaseDomain);
  let expression: string;

  if (params.appEnv === "staging") {
    if (params.hostnames.length === 0) {
      expression = `(http.host wildcard "*.staging.${base}")`;
    } else {
      const hostsSet = params.hostnames.map((h) => `"${h}"`).join(" ");
      expression = `(http.host wildcard "*.staging.${base}" and not lower(http.host) in {${hostsSet}})`;
    }
  } else {
    const stagingExclusion = `not (http.host eq "staging.${base}" or http.host wildcard "*.staging.${base}")`;
    if (params.hostnames.length === 0) {
      expression = `(http.host wildcard "*.${base}" and ${stagingExclusion})`;
    } else {
      const hostsSet = params.hostnames.map((h) => `"${h}"`).join(" ");
      expression = `(http.host wildcard "*.${base}" and ${stagingExclusion} and not lower(http.host) in {${hostsSet}})`;
    }
  }

  if (expression.length > MAX_WAF_EXPRESSION_LENGTH) {
    throw new CanonicalHostnameFirewallError(
      `Canonical hostname firewall WAF expression length (${String(expression.length)}) exceeds safety limit of ${String(MAX_WAF_EXPRESSION_LENGTH)} characters.`,
      false,
    );
  }

  return expression;
}

export interface FakeFirewallRuleState {
  readonly action: CanonicalHostnameFirewallAction;
  readonly description: string;
  readonly enabled: boolean;
  readonly expression: string;
  readonly id: string;
  readonly rulesetId: string;
  readonly updatedAt: string;
}

let fakeFirewallState: FakeFirewallRuleState | null = null;

export function getFakeFirewallState(): FakeFirewallRuleState | null {
  return fakeFirewallState;
}

export function resetFakeFirewallState(): void {
  fakeFirewallState = null;
}

function resolveFirewallAction(env: CanonicalHostnameFirewallEnv): CanonicalHostnameFirewallAction {
  if (env.CLOUDFLARE_WAF_RULE_ACTION) {
    return env.CLOUDFLARE_WAF_RULE_ACTION;
  }
  return env.APP_ENV === "staging" ? "log" : "block";
}

async function cloudflareWafRequest(
  apiToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${apiToken}`);
  headers.set("content-type", "application/json");

  const response = await fetch(url, {
    ...init,
    headers,
  }).catch((error: unknown) => {
    throw new CanonicalHostnameFirewallError(
      `Cloudflare WAF network error: ${error instanceof Error ? error.message : "network failure"}`,
      true,
    );
  });

  const rawJson: unknown = await response.json().catch(() => null);
  const envelope = cloudflareRuleEnvelopeSchema
    .or(cloudflareRulesetEnvelopeSchema)
    .safeParse(rawJson);

  if (!envelope.success) {
    throw new CanonicalHostnameFirewallError(
      `Cloudflare WAF returned an invalid JSON response structure (status ${String(response.status)}).`,
      response.status >= 500 || response.status === 429,
      response.status,
    );
  }

  if (!response.ok || !envelope.data.success) {
    const errorMsg =
      envelope.data.errors[0]?.message ??
      `Cloudflare API error (status ${String(response.status)})`;
    throw new CanonicalHostnameFirewallError(
      errorMsg,
      response.status >= 500 || response.status === 429,
      response.status,
    );
  }

  return envelope.data.result;
}

function handleDisabledFirewall(
  env: CanonicalHostnameFirewallEnv,
  action: CanonicalHostnameFirewallAction,
): CanonicalHostnameFirewallResult {
  console.info(
    JSON.stringify({
      action,
      changed: false,
      environment: env.APP_ENV,
      event: "canonical_hostname_firewall_sync_completed",
      mode: "disabled",
      ruleId: null,
    }),
  );
  return {
    action,
    changed: false,
    desiredHostnameCount: 0,
    environment: env.APP_ENV,
    expressionLength: 0,
    mode: "disabled",
    ruleId: null,
  };
}

function handleFakeFirewall(
  env: CanonicalHostnameFirewallEnv,
  action: CanonicalHostnameFirewallAction,
  hostnames: readonly string[],
  expression: string,
): CanonicalHostnameFirewallResult {
  const previous = fakeFirewallState;
  const changed =
    previous?.expression !== expression || previous.action !== action || !previous.enabled;

  fakeFirewallState = {
    action,
    description: DEFAULT_FIREWALL_RULE_DESCRIPTION,
    enabled: true,
    expression,
    id: previous?.id ?? "fake-waf-rule-id",
    rulesetId: previous?.rulesetId ?? "fake-waf-ruleset-id",
    updatedAt: new Date().toISOString(),
  };

  console.info(
    JSON.stringify({
      action,
      changed,
      desiredHostnameCount: hostnames.length,
      environment: env.APP_ENV,
      event: "canonical_hostname_firewall_sync_completed",
      expressionLength: expression.length,
      mode: "fake",
      ruleId: fakeFirewallState.id,
    }),
  );

  return {
    action,
    changed,
    desiredHostnameCount: hostnames.length,
    environment: env.APP_ENV,
    expressionLength: expression.length,
    mode: "fake",
    ruleId: fakeFirewallState.id,
  };
}

async function discoverOrReadCloudflareRule(
  apiToken: string,
  zoneId: string,
  env: CanonicalHostnameFirewallEnv,
): Promise<{
  readonly existingRule: CloudflareRule | null;
  readonly ruleId: string | null;
  readonly rulesetId: string;
}> {
  const configuredRulesetId = env.CLOUDFLARE_WAF_RULESET_ID?.trim();
  const configuredRuleId = env.CLOUDFLARE_WAF_RULE_ID?.trim();

  if (configuredRulesetId && configuredRuleId) {
    const fetched = await cloudflareWafRequest(
      apiToken,
      `/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(configuredRulesetId)}/rules/${encodeURIComponent(configuredRuleId)}`,
      { method: "GET" },
    );
    const parsed = cloudflareRuleSchema.safeParse(fetched);
    return {
      existingRule: parsed.success ? parsed.data : null,
      ruleId: configuredRuleId,
      rulesetId: configuredRulesetId,
    };
  }

  const entrypointResult = await cloudflareWafRequest(
    apiToken,
    `/zones/${encodeURIComponent(zoneId)}/rulesets/phases/http_request_firewall_custom/entrypoint`,
    { method: "GET" },
  );
  const parsedRuleset = cloudflareRulesetSchema.safeParse(entrypointResult);
  if (!parsedRuleset.success) {
    throw new CanonicalHostnameFirewallError(
      "Cloudflare returned an unexpected ruleset format for the WAF entrypoint.",
      false,
    );
  }

  const found = parsedRuleset.data.rules.find(
    (r) => r.description === DEFAULT_FIREWALL_RULE_DESCRIPTION,
  );
  return {
    existingRule: found ?? null,
    ruleId: found?.id ?? null,
    rulesetId: parsedRuleset.data.id,
  };
}

async function applyCloudflareRuleMutation(
  apiToken: string,
  zoneId: string,
  rulesetId: string,
  ruleId: string | null,
  action: CanonicalHostnameFirewallAction,
  expression: string,
): Promise<string> {
  const body = JSON.stringify({
    action,
    description: DEFAULT_FIREWALL_RULE_DESCRIPTION,
    enabled: true,
    expression,
  });

  if (ruleId) {
    const patchResult = await cloudflareWafRequest(
      apiToken,
      `/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(rulesetId)}/rules/${encodeURIComponent(ruleId)}`,
      { body, method: "PATCH" },
    );
    const parsed = cloudflareRuleSchema.safeParse(patchResult);
    return parsed.success ? parsed.data.id : ruleId;
  }

  const createResult = await cloudflareWafRequest(
    apiToken,
    `/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(rulesetId)}/rules`,
    { body, method: "POST" },
  );
  const parsed = cloudflareRuleSchema.safeParse(createResult);
  if (!parsed.success) {
    throw new CanonicalHostnameFirewallError(
      "Failed to parse newly created Cloudflare WAF rule response.",
    );
  }
  return parsed.data.id;
}

async function handleCloudflareInlineFirewall(
  env: CanonicalHostnameFirewallEnv,
  action: CanonicalHostnameFirewallAction,
  hostnames: readonly string[],
  expression: string,
): Promise<CanonicalHostnameFirewallResult> {
  const apiToken = env.CLOUDFLARE_WAF_API_TOKEN?.trim();
  const zoneId = env.CLOUDFLARE_WAF_ZONE_ID?.trim();

  if (!apiToken || !zoneId) {
    throw new CanonicalHostnameFirewallError(
      "Cloudflare WAF credentials (CLOUDFLARE_WAF_API_TOKEN, CLOUDFLARE_WAF_ZONE_ID) are missing.",
      false,
    );
  }

  const { existingRule, ruleId, rulesetId } = await discoverOrReadCloudflareRule(
    apiToken,
    zoneId,
    env,
  );

  if (
    existingRule?.expression === expression &&
    existingRule.action === action &&
    existingRule.enabled
  ) {
    console.info(
      JSON.stringify({
        action,
        changed: false,
        desiredHostnameCount: hostnames.length,
        environment: env.APP_ENV,
        event: "canonical_hostname_firewall_sync_completed",
        expressionLength: expression.length,
        mode: "cloudflare-inline",
        ruleId,
      }),
    );
    return {
      action,
      changed: false,
      desiredHostnameCount: hostnames.length,
      environment: env.APP_ENV,
      expressionLength: expression.length,
      mode: "cloudflare-inline",
      ruleId,
    };
  }

  const updatedRuleId = await applyCloudflareRuleMutation(
    apiToken,
    zoneId,
    rulesetId,
    ruleId,
    action,
    expression,
  );

  console.info(
    JSON.stringify({
      action,
      changed: true,
      desiredHostnameCount: hostnames.length,
      environment: env.APP_ENV,
      event: "canonical_hostname_firewall_sync_completed",
      expressionLength: expression.length,
      mode: "cloudflare-inline",
      ruleId: updatedRuleId,
    }),
  );

  return {
    action,
    changed: true,
    desiredHostnameCount: hostnames.length,
    environment: env.APP_ENV,
    expressionLength: expression.length,
    mode: "cloudflare-inline",
    ruleId: updatedRuleId,
  };
}

export async function reconcileCanonicalHostnameFirewall(
  env: CanonicalHostnameFirewallEnv,
): Promise<CanonicalHostnameFirewallResult> {
  const mode = env.CANONICAL_HOSTNAME_FIREWALL_MODE ?? "fake";
  const action = resolveFirewallAction(env);

  console.info(
    JSON.stringify({
      action,
      environment: env.APP_ENV,
      event: "canonical_hostname_firewall_sync_started",
      mode,
    }),
  );

  if (mode === "disabled") {
    return handleDisabledFirewall(env, action);
  }

  try {
    const hostnames = await readDesiredCanonicalHostnames(
      env.CONTROL_DB,
      env.PRODUCT_BASE_DOMAIN,
      env.APP_ENV,
    );
    const expression = buildCanonicalHostnameWafExpression({
      appEnv: env.APP_ENV,
      hostnames,
      productBaseDomain: env.PRODUCT_BASE_DOMAIN,
    });

    if (mode === "fake") {
      return handleFakeFirewall(env, action, hostnames, expression);
    }

    return await handleCloudflareInlineFirewall(env, action, hostnames, expression);
  } catch (error: unknown) {
    const safeMessage =
      error instanceof Error ? error.message : "Unknown error during firewall sync";
    console.error(
      JSON.stringify({
        action,
        environment: env.APP_ENV,
        error: safeMessage,
        event: "canonical_hostname_firewall_sync_failed",
        mode,
      }),
    );
    throw error;
  }
}
