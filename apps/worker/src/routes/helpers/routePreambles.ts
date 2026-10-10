import type { ProblemDetails } from "@choir/contracts";
import type { Context } from "hono";

import { createAuth } from "../../auth/config";
import { validateStartupConfig } from "../../env";

import { invitationIdSchema, type WorkerHonoEnvironment } from "./routeContracts";
import { isAuthorizedPlatformHostname, resolveCanonicalOrganizationId } from "./tenancyHelpers";

type AccountAuth = ReturnType<typeof createAuth>;

export interface AccountSession {
  readonly auth: AccountAuth;
  readonly requestUrl: URL;
  readonly session: NonNullable<Awaited<ReturnType<AccountAuth["api"]["getSession"]>>>;
}

export interface OrganizationInvitationScope {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly requestUrl: URL;
}

/**
 * Account-lane guard for `/api/account/*` routes. Preserves the exact
 * ordering every account route requires: startup config, then
 * authorized-platform-hostname resolution (product base host or a canonical
 * Organization host), then the Better Auth session. Organization-member and
 * Platform-Administrator authorization never enter this lane.
 */
export async function requireAccountSession(
  context: Context<WorkerHonoEnvironment>,
): Promise<Response | AccountSession> {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
    return context.json(
      {
        code: "not_found",
        message: "Account management requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }
  return { auth, requestUrl, session };
}

/**
 * Organization invitation scope guard. Resolves the Organization from the
 * validated hostname and registry (never from a client-supplied ID) and
 * validates the invitation identifier, returning the shared `not_found`
 * envelope when either is unknown. Session handling, invitation-state checks,
 * and reject/cancel/accept role checks stay in the caller so the lanes never
 * merge.
 */
export async function requireOrganizationInvitationScope(
  context: Context<WorkerHonoEnvironment>,
): Promise<Response | OrganizationInvitationScope> {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const invitationId = invitationIdSchema.safeParse(context.req.param("invitationId"));
  if (!organizationId || !invitationId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return { invitationId: invitationId.data, organizationId, requestUrl };
}
