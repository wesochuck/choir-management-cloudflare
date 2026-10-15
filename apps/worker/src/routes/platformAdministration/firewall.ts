import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "../helpers";
import {
  buildCanonicalHostnameWafExpression,
  readDesiredCanonicalHostnames,
  reconcileCanonicalHostnameFirewall,
} from "../../security/canonicalHostnameFirewall";
import { authorizePlatformAdministration } from "./shared";

export function registerPlatformFirewallRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/waf/status", async (context) => {
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizePlatformAdministration(context, requestUrl);
    if (authorization instanceof Response) {
      return authorization;
    }

    const hostnames = await readDesiredCanonicalHostnames(
      context.env.CONTROL_DB,
      context.env.PRODUCT_BASE_DOMAIN,
      context.env.APP_ENV,
    );
    const expression = buildCanonicalHostnameWafExpression({
      appEnv: context.env.APP_ENV,
      hostnames,
      productBaseDomain: context.env.PRODUCT_BASE_DOMAIN,
    });

    return context.json({
      action:
        context.env.CLOUDFLARE_WAF_RULE_ACTION ??
        (context.env.APP_ENV === "staging" ? "log" : "block"),
      environment: context.env.APP_ENV,
      expectedExpression: expression,
      expressionLength: expression.length,
      hostnames,
      mode: context.env.CANONICAL_HOSTNAME_FIREWALL_MODE ?? "fake",
      productBaseDomain: context.env.PRODUCT_BASE_DOMAIN,
      requestId: context.get("requestId"),
      ruleId: context.env.CLOUDFLARE_WAF_RULE_ID ?? null,
      rulesetId: context.env.CLOUDFLARE_WAF_RULESET_ID ?? null,
      zoneId: context.env.CLOUDFLARE_WAF_ZONE_ID ?? null,
    });
  });

  router.post("/api/platform/waf/sync", async (context) => {
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizePlatformAdministration(context, requestUrl);
    if (authorization instanceof Response) {
      return authorization;
    }

    const result = await reconcileCanonicalHostnameFirewall(context.env);

    return context.json({
      action: result.action,
      changed: result.changed,
      desiredHostnameCount: result.desiredHostnameCount,
      environment: result.environment,
      expressionLength: result.expressionLength,
      mode: result.mode,
      requestId: context.get("requestId"),
      ruleId: result.ruleId,
      success: true,
    });
  });
}
