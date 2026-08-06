import {
  organizationProfileRequestSchema,
  seasonCreateRequestSchema,
  seasonUpdateRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { type Context } from "hono";
import { z } from "zod";
import { MusicCsvError } from "@choir/domain";
import { createAuth } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import { getPlatformOrganizationContext } from "../../auth/platformElevation";
import type { Env } from "../../env";
import { validateStartupConfig } from "../../env";
import { MusicRepositoryError } from "../../organization/organizationMusic";
import { CommunicationRepositoryError } from "../../organization/organizationCommunications";
import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../../communications/emailFeedback";
import { createOrganizationProfile, deleteOrganizationProfile } from "../../organization/profiles";
import { getSetupStatus } from "../../organization/organizationSetup";
import { createSeason, updateSeason } from "../../organization/organizationSeasons";

import { readJsonObject, authorizeCalendarRoute } from "./routeContracts";

import type { WorkerHonoEnvironment } from "./routeContracts";

import { resolveCanonicalOrganizationId, seasonMutationFailure } from "./routeUtilities";

export async function saveSeasonRoute(
  context: Context<WorkerHonoEnvironment>,
  seasonId: string | null,
) {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const parsed = (seasonId ? seasonUpdateRequestSchema : seasonCreateRequestSchema).safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsed.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid season details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const actor = {
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
    };
    const season = seasonId
      ? await updateSeason(context.env, actor, seasonId, parsed.data)
      : await createSeason(context.env, actor, parsed.data);
    return context.json({ ...season, requestId: context.get("requestId") }, seasonId ? 200 : 201);
  } catch (error: unknown) {
    const failure = seasonMutationFailure(
      error,
      context.get("requestId"),
      `The season could not be ${seasonId ? "updated" : "created"}.`,
    );
    return context.json(failure.problem, failure.status);
  }
}

export function communicationProblem(error: unknown, requestIdValue: string, message: string) {
  console.error(
    JSON.stringify({
      event: "communication_route_error",
      error: error instanceof Error ? error.message : String(error),
      requestId: requestIdValue,
    }),
  );
  const suppression = error instanceof EmailRecipientSuppressedError;
  const status = suppression
    ? error.status
    : error instanceof CommunicationRepositoryError
      ? error.status
      : 503;
  return {
    problem: {
      code: suppression
        ? error.code
        : error instanceof CommunicationRepositoryError
          ? error.code
          : "service_unavailable",
      message: suppression ? error.message : message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status,
  };
}

export function musicImportProblem(
  error: unknown,
  requestIdValue: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 500 | 503 } {
  if (error instanceof MusicRepositoryError) {
    return {
      problem: {
        code: error.code,
        message: "The music catalog import could not be completed.",
        requestId: requestIdValue,
      },
      status: error.status,
    };
  }
  if (error instanceof MusicCsvError) {
    const row = error.row === null ? "" : ` (row ${String(error.row)})`;
    return {
      problem: {
        code: "validation_failed",
        message: `${error.message}${row}`,
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      problem: {
        code: "validation_failed",
        message: "The music CSV contains invalid values.",
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  return {
    problem: {
      code: "service_unavailable",
      message: "The music catalog import could not be completed.",
      requestId: requestIdValue,
    },
    status: 503,
  };
}

export function stripePaymentsGlobalEnabled(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "STRIPE_PAYMENTS_ENABLED">,
): boolean {
  return (
    env.APP_ENV !== "local" &&
    env.APP_ENV !== "preview" &&
    env.EXTERNAL_EFFECTS_MODE !== "disabled" &&
    env.STRIPE_PAYMENTS_ENABLED?.trim().toLowerCase() === "true"
  );
}

export async function readOrganizationStripeStatus(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
) {
  const url = new URL("https://organization.internal/internal/stripe-connect");
  url.searchParams.set("organizationId", organizationId);
  const response = await env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(organizationId),
  ).fetch(url);
  const status = z
    .object({
      accountId: z
        .string()
        .regex(/^acct_[A-Za-z0-9]+$/)
        .nullable(),
      chargesEnabled: z.boolean(),
      detailsSubmitted: z.boolean(),
      payoutsEnabled: z.boolean(),
      requirementsDue: z.array(z.string()),
      status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
    })
    .safeParse(await response.json().catch(() => null));
  if (!response.ok || !status.success) throw new Error("stripe_status_unavailable");
  return status.data;
}

export const platformMfaVerificationSchema = z.discriminatedUnion("method", [
  z.object({ code: z.string().regex(/^\d{6}$/), method: z.literal("totp") }),
  z.object({ code: z.string().min(8).max(128), method: z.literal("recovery_code") }),
]);

export const administratorRecoveryRequestSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(200).optional(),
  password: z.string().max(128).optional(),
  passwordConfirm: z.string().max(128).optional(),
});

export interface AdministratorRecoveryRequest {
  readonly email: string;
  readonly displayName: string;
}

export interface AdministratorRecoveryAuthorization {
  readonly userId: string;
}

export interface AdministratorRecoveryIdentity {
  readonly createdMembership: boolean;
  readonly createdUser: boolean;
  readonly email: string;
  readonly membershipId: string;
  readonly upgradedMembership: boolean;
  readonly userId: string;
}

export async function readAdministratorRecoveryRequest(
  context: Context<WorkerHonoEnvironment>,
): Promise<AdministratorRecoveryRequest | Response> {
  const body = await readJsonObject(context);
  const parsed = administratorRecoveryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid administrator email and display name are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  if (
    parsed.data.password !== undefined &&
    parsed.data.passwordConfirm !== undefined &&
    parsed.data.password !== parsed.data.passwordConfirm
  ) {
    return context.json(
      {
        code: "validation_failed",
        message: "Passwords do not match. Passwords are not stored by administrator recovery.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const email = parsed.data.email.toLowerCase();
  return {
    displayName: parsed.data.name?.trim() ?? email.split("@", 1)[0] ?? "Administrator",
    email,
  };
}

export async function authorizeAdministratorRecovery(
  context: Context<WorkerHonoEnvironment>,
  requestUrl: URL,
  organizationId: string,
): Promise<AdministratorRecoveryAuthorization | Response> {
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const platform = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!platform.ok) {
    return context.json(
      {
        code: platform.error.code,
        message: platform.error.message,
        requestId: context.get("requestId"),
      },
      platform.error.code === "unauthorized" ? 401 : 403,
    );
  }
  const elevation = await getPlatformOrganizationContext(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id ?? "",
    platform.value.userId,
  );
  return elevation.canEdit
    ? { userId: platform.value.userId }
    : context.json(
        {
          code: "platform_elevation_required",
          message:
            "Enable a current Platform Administrator elevation before recovering an administrator.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
}

export async function ensureAdministratorRecoverySetup(
  context: Context<WorkerHonoEnvironment>,
  organizationId: string,
): Promise<Response | true> {
  try {
    const status = await getSetupStatus(context.env, organizationId);
    return status.launched
      ? true
      : context.json(
          {
            code: "admin_recovery_not_required",
            message: "Administrator recovery is available only after setup has been launched.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
  } catch {
    return context.json(
      {
        code: "setup_recovery_unavailable",
        message: "Administrator recovery status is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
}

export async function recoverAdministratorIdentity(
  context: Context<WorkerHonoEnvironment>,
  organizationId: string,
  request: AdministratorRecoveryRequest,
): Promise<AdministratorRecoveryIdentity | Response> {
  const membershipCount = await context.env.CONTROL_DB.prepare(
    `SELECT COUNT(*) AS count FROM member WHERE organizationId = ? AND role IN ('owner', 'admin')`,
  )
    .bind(organizationId)
    .first<{ count: number }>();
  if ((membershipCount?.count ?? 0) > 0) {
    return context.json(
      {
        code: "admin_recovery_not_required",
        message: "Administrator recovery is not required for this Organization.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  const now = Date.now();
  const existingUser = await context.env.CONTROL_DB.prepare(
    "SELECT id FROM user WHERE lower(email) = lower(?) LIMIT 1",
  )
    .bind(request.email)
    .first<{ id: string }>();
  const userId = existingUser?.id ?? crypto.randomUUID();
  const existingMembership = await context.env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE organizationId = ? AND userId = ? LIMIT 1",
  )
    .bind(organizationId, userId)
    .first<{ id: string; role: "owner" | "admin" | "member" }>();
  const membershipId = existingMembership?.id ?? crypto.randomUUID();
  const statements = [
    context.env.CONTROL_DB.prepare(
      `INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES (?, ?, ?, 1, ?, ?, 0)`,
    ).bind(userId, request.displayName, request.email, now, now),
    existingMembership
      ? context.env.CONTROL_DB.prepare(
          "UPDATE member SET role = 'admin' WHERE id = ? AND organizationId = ? AND userId = ?",
        ).bind(membershipId, organizationId, userId)
      : context.env.CONTROL_DB.prepare(
          "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, 'admin', ?)",
        ).bind(membershipId, organizationId, userId, now),
  ];
  try {
    await context.env.CONTROL_DB.batch(statements);
  } catch {
    return context.json(
      {
        code: "admin_recovery_conflict",
        message: "The administrator identity could not be recovered.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  return {
    createdMembership: existingMembership === null,
    createdUser: existingUser === null,
    email: request.email,
    membershipId,
    upgradedMembership: existingMembership?.role === "member",
    userId,
  };
}

export async function createAdministratorRecoveryProfile(
  context: Context<WorkerHonoEnvironment>,
  organizationId: string,
  actorUserId: string,
  request: AdministratorRecoveryRequest,
  identity: AdministratorRecoveryIdentity,
): Promise<string | Response> {
  let profileId: string | null = null;
  try {
    const profile = await createOrganizationProfile(context.env, {
      actorUserId,
      organizationId,
      profile: organizationProfileRequestSchema.parse({ displayName: request.displayName }),
      requestId: context.get("requestId"),
    });
    profileId = profile.id;
    await context.env.CONTROL_DB.prepare(
      "UPDATE member SET profileId = ? WHERE id = ? AND organizationId = ?",
    )
      .bind(profile.id, identity.membershipId, organizationId)
      .run();
    return profile.id;
  } catch {
    const cleanup = identity.createdMembership
      ? [
          context.env.CONTROL_DB.prepare(
            "DELETE FROM member WHERE id = ? AND organizationId = ? AND userId = ?",
          ).bind(identity.membershipId, organizationId, identity.userId),
        ]
      : identity.upgradedMembership
        ? [
            context.env.CONTROL_DB.prepare(
              "UPDATE member SET role = 'member' WHERE id = ? AND organizationId = ? AND userId = ?",
            ).bind(identity.membershipId, organizationId, identity.userId),
          ]
        : [];
    if (identity.createdUser)
      cleanup.push(
        context.env.CONTROL_DB.prepare("DELETE FROM user WHERE id = ? AND email = ?").bind(
          identity.userId,
          identity.email,
        ),
      );
    await context.env.CONTROL_DB.batch(cleanup).catch(() => undefined);
    if (profileId) {
      await deleteOrganizationProfile(context.env, {
        actorUserId,
        organizationId,
        profileId,
        requestId: context.get("requestId"),
      }).catch(() => undefined);
    }
    return context.json(
      {
        code: "admin_recovery_unavailable",
        message: "The administrator Profile could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
}

export async function recoverAdministrator(
  context: Context<WorkerHonoEnvironment>,
): Promise<Response> {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Administrator recovery requires a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const request = await readAdministratorRecoveryRequest(context);
  if (request instanceof Response) return request;
  const authorization = await authorizeAdministratorRecovery(context, requestUrl, organizationId);
  if (authorization instanceof Response) return authorization;
  const setup = await ensureAdministratorRecoverySetup(context, organizationId);
  if (setup instanceof Response) return setup;
  try {
    await assertEmailProviderRecipientAvailable(context.env.CONTROL_DB, request.email);
  } catch (error: unknown) {
    if (error instanceof EmailRecipientSuppressedError) {
      return context.json(
        { code: error.code, message: error.message, requestId: context.get("requestId") },
        error.status,
      );
    }
    return context.json(
      {
        code: "service_unavailable",
        message: "The email suppression list could not be checked.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
  const identity = await recoverAdministratorIdentity(context, organizationId, request);
  if (identity instanceof Response) return identity;
  const profile = await createAdministratorRecoveryProfile(
    context,
    organizationId,
    authorization.userId,
    request,
    identity,
  );
  if (profile instanceof Response) return profile;
  await context.env.CONTROL_DB.prepare(
    "INSERT INTO platform_audit_events (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at) VALUES (?, ?, ?, 'organization.admin.recovered', 'organization_membership', ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      authorization.userId,
      organizationId,
      identity.membershipId,
      context.get("requestId"),
      JSON.stringify({ email: identity.email, profileCreated: true, role: "administrator" }),
      new Date().toISOString(),
    )
    .run();
  return context.json({
    membershipId: identity.membershipId,
    requestId: context.get("requestId"),
    success: true,
    userId: identity.userId,
  });
}
