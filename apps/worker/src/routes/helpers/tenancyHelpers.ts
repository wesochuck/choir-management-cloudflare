import type { Context } from "hono";

import type { createAuth } from "../../auth/config";
import { isCanonicalAuthHost, isProductBaseHost } from "../../auth/config";
import { verifyImpersonationCookie } from "../../auth/impersonation";
import { type Env, validateStartupConfig } from "../../env";
import { linkedOrganizationProfileId } from "../../tenancy/linkedOrganizationProfile";
import { resolveOrganization } from "../../tenancy/resolveOrganization";
import type { CalendarAuthorization, WorkerHonoEnvironment } from "./routeContracts";

export async function isAuthorizedPlatformHostname(requestUrl: URL, env: Env): Promise<boolean> {
  if (isProductBaseHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return true;
  }
  if (!isCanonicalAuthHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return false;
  }
  const resolvedOrganization = await resolveOrganization(requestUrl, env);
  return resolvedOrganization.ok && resolvedOrganization.value.routeKind === "canonical";
}

export async function resolveCanonicalOrganizationId(
  requestUrl: URL,
  env: Env,
): Promise<string | null> {
  if (!isCanonicalAuthHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return null;
  }
  const resolvedOrganization = await resolveOrganization(requestUrl, env);
  return resolvedOrganization.ok && resolvedOrganization.value.routeKind === "canonical"
    ? resolvedOrganization.value.organizationId
    : null;
}

export async function verifySecondFactor(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  verification:
    | { readonly code: string; readonly method: "recovery_code" }
    | { readonly code: string; readonly method: "totp" },
): Promise<boolean> {
  try {
    if (verification.method === "totp") {
      await auth.api.verifyTOTP({
        body: { code: verification.code, trustDevice: false },
        headers,
      });
    } else {
      await auth.api.verifyBackupCode({
        body: { code: verification.code, disableSession: true, trustDevice: false },
        headers,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function resolveEffectiveMemberProfileId(
  context: Context<WorkerHonoEnvironment>,
  authorization: Extract<CalendarAuthorization, { readonly ok: true }>,
): Promise<{
  readonly adminUserId: string | null;
  readonly isImpersonating: boolean;
  readonly profileId: string | null;
}> {
  if (authorization.role === "administrator" || authorization.role === "owner") {
    validateStartupConfig(context.env);
    const cookieHeader = context.req.raw.headers.get("cookie") ?? undefined;
    const impersonation = await verifyImpersonationCookie(
      context.env.SIGNED_LINK_SECRET,
      authorization.organizationId,
      authorization.userId,
      authorization.sessionId,
      cookieHeader,
    );
    if (impersonation.active && impersonation.impersonatedProfileId) {
      return {
        adminUserId: authorization.userId,
        isImpersonating: true,
        profileId: impersonation.impersonatedProfileId,
      };
    }
  }

  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  return {
    adminUserId: null,
    isImpersonating: false,
    profileId,
  };
}
