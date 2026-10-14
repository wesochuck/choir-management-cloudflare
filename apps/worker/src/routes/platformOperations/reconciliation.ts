import {
  organizationIdSchema,
  platformStripeReconciliationApplyRequestSchema,
  platformStripeReconciliationPreviewRequestSchema,
  type PlatformStripeReconciliationApplyResponse,
  type PlatformStripeReconciliationApplyResult,
  type PlatformStripeReconciliationPreviewResponse,
  type PlatformStripeReconciliationRow,
  type ProblemDetails,
} from "@choir/contracts";
import {
  compareStripePaymentToLocalCandidate,
  type LocalPaymentCandidate,
  type ReconciliationLookupError,
  type StripePaymentSnapshot,
} from "@choir/domain";
import type { Context, Hono } from "hono";

import { createAuth } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import { getPlatformOrganizationContext } from "../../auth/platformElevation";
import { validateStartupConfig } from "../../env";
import {
  reconciliationReportSchema,
  type ReconciliationReport,
} from "../../organization/reconciliationStore";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import {
  retrieveStripeCheckoutReconciliationSession,
  retrieveStripePaymentReconciliationSnapshot,
  StripeConnectError,
} from "../../payments/stripeConnect";
import type { WorkerHonoEnvironment } from "../helpers";
import { isAuthorizedPlatformHostname, resolveCanonicalOrganizationId } from "../helpers";
import { authorizePlatformRead, type WorkerContext } from "./shared";

const RECONCILIATION_ARCHIVE_PAGE_SIZE = 1_000;

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function checkoutSessionSnapshotFields(
  session: Awaited<ReturnType<typeof retrieveStripeCheckoutReconciliationSession>>,
): Partial<StripePaymentSnapshot> {
  return {
    checkoutSessionAmountCents: session.amountTotalCents,
    checkoutSessionCurrency: session.currency,
    checkoutSessionId: session.id,
    checkoutSessionMode: session.mode,
    checkoutSessionOrganizationId: session.metadata.organization_id ?? null,
    checkoutSessionPaymentStatus: session.paymentStatus,
    checkoutSessionPaymentType: session.metadata.payment_type ?? null,
    checkoutSessionPurchaseId: session.metadata.purchase_id ?? null,
    checkoutSessionRequestId: session.metadata.checkout_request_id ?? null,
    checkoutSessionStatus: session.status,
  };
}

function checkoutSessionMatchesCandidate(
  session: Awaited<ReturnType<typeof retrieveStripeCheckoutReconciliationSession>>,
  candidate: LocalPaymentCandidate,
  organizationId: string,
): boolean {
  return (
    session.id === candidate.providerSessionId &&
    session.mode === "payment" &&
    session.metadata.organization_id === organizationId &&
    session.metadata.purchase_id === candidate.resourceId &&
    session.metadata.checkout_request_id === candidate.checkoutRequestId &&
    session.metadata.payment_type === candidate.paymentType
  );
}

function checkoutSessionFallbackSnapshot(
  session: Awaited<ReturnType<typeof retrieveStripeCheckoutReconciliationSession>>,
  candidate: LocalPaymentCandidate,
  providerPaymentId: string,
  checkoutFields: Partial<StripePaymentSnapshot>,
): StripePaymentSnapshot {
  return {
    amountCapturedCents: null,
    amountChargedCents: session.amountTotalCents ?? candidate.amountCents,
    amountReceivedCents: null,
    amountRefundedCents: 0,
    chargeCaptured: null,
    chargeId: null,
    chargeStatus: null,
    currency: session.currency,
    fullyRefunded: false,
    paymentIntentId: providerPaymentId.startsWith("pi_") ? providerPaymentId : null,
    paymentIntentStatus: null,
    processorFeeCents: null,
    providerBalanceTransactionId: null,
    providerPaymentId,
    refundCompletedAt: null,
    ...checkoutFields,
  };
}

function nullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function reconciliationProviderPaymentId(
  snapshot: StripePaymentSnapshot | null,
  candidate: LocalPaymentCandidate,
): string {
  if (snapshot?.providerPaymentId) return snapshot.providerPaymentId;
  return candidate.providerPaymentId.length > 0
    ? candidate.providerPaymentId
    : candidate.providerSessionId;
}

function stripeRowFields(
  snapshot: StripePaymentSnapshot | null,
): Pick<
  PlatformStripeReconciliationRow,
  | "stripeAmountChargedCents"
  | "stripeAmountCapturedCents"
  | "stripeAmountReceivedCents"
  | "stripeAmountRefundedCents"
  | "stripeChargeCaptured"
  | "stripeChargeStatus"
  | "stripeFullyRefunded"
  | "stripeProcessorFeeCents"
  | "stripeProviderBalanceTransactionId"
  | "stripeRefundCompletedAt"
  | "stripePaymentIntentStatus"
> {
  return {
    stripeAmountChargedCents: nullable(snapshot?.amountChargedCents),
    stripeAmountCapturedCents: nullable(snapshot?.amountCapturedCents),
    stripeAmountReceivedCents: nullable(snapshot?.amountReceivedCents),
    stripeAmountRefundedCents: nullable(snapshot?.amountRefundedCents),
    stripeChargeCaptured: nullable(snapshot?.chargeCaptured),
    stripeChargeStatus: nullable(snapshot?.chargeStatus),
    stripeFullyRefunded: nullable(snapshot?.fullyRefunded),
    stripeProcessorFeeCents: nullable(snapshot?.processorFeeCents),
    stripeProviderBalanceTransactionId: nullable(snapshot?.providerBalanceTransactionId),
    stripeRefundCompletedAt: nullable(snapshot?.refundCompletedAt),
    stripePaymentIntentStatus: nullable(snapshot?.paymentIntentStatus),
  };
}

function stripeSnapshotForApply(snapshot: StripePaymentSnapshot) {
  return {
    amountChargedCents: snapshot.amountChargedCents,
    amountCapturedCents: nullable(snapshot.amountCapturedCents),
    amountReceivedCents: nullable(snapshot.amountReceivedCents),
    amountRefundedCents: snapshot.amountRefundedCents,
    chargeCaptured: nullable(snapshot.chargeCaptured),
    chargeStatus: nullable(snapshot.chargeStatus),
    checkoutSessionAmountCents: nullable(snapshot.checkoutSessionAmountCents),
    checkoutSessionCurrency: nullable(snapshot.checkoutSessionCurrency),
    checkoutSessionId: nullable(snapshot.checkoutSessionId),
    checkoutSessionMode: nullable(snapshot.checkoutSessionMode),
    checkoutSessionOrganizationId: nullable(snapshot.checkoutSessionOrganizationId),
    checkoutSessionPaymentStatus: nullable(snapshot.checkoutSessionPaymentStatus),
    checkoutSessionPaymentType: nullable(snapshot.checkoutSessionPaymentType),
    checkoutSessionPurchaseId: nullable(snapshot.checkoutSessionPurchaseId),
    checkoutSessionRequestId: nullable(snapshot.checkoutSessionRequestId),
    checkoutSessionStatus: nullable(snapshot.checkoutSessionStatus),
    currency: snapshot.currency,
    fullyRefunded: snapshot.fullyRefunded,
    paymentIntentId: nullable(snapshot.paymentIntentId),
    paymentIntentStatus: nullable(snapshot.paymentIntentStatus),
    processorFeeCents: snapshot.processorFeeCents,
    providerBalanceTransactionId: snapshot.providerBalanceTransactionId,
    providerPaymentId: snapshot.providerPaymentId,
    refundCompletedAt: snapshot.refundCompletedAt,
  };
}

function staleReconciliationSelectionResponse(context: Context<WorkerHonoEnvironment>): Response {
  return context.json(
    {
      code: "stripe_reconciliation_preview_stale",
      message:
        "One or more selected payments changed or fell outside the preview cutoff. Run a new preview before applying.",
      requestId: context.get("requestId"),
    } satisfies ProblemDetails,
    409,
  );
}

async function selectReconciliationApplyCandidates(args: {
  readonly organizationId: string;
  readonly paymentAttemptIds?: readonly string[] | undefined;
  readonly providerPaymentIds?: readonly string[] | undefined;
  readonly resourceIds?: readonly string[] | undefined;
  readonly since?: string | null | undefined;
  readonly snapshotAt?: string | undefined;
  readonly stub: ReturnType<typeof organizationStoreStub>;
}): Promise<readonly LocalPaymentCandidate[] | null> {
  if (args.paymentAttemptIds !== undefined) {
    const selection = await args.stub.listStripePaymentReconciliationCandidates({
      organizationId: args.organizationId,
      paymentAttemptIds: args.paymentAttemptIds,
      snapshotAt: args.snapshotAt,
      since: args.since,
    });
    return selection.candidates.length === args.paymentAttemptIds.length
      ? selection.candidates
      : null;
  }

  if (args.resourceIds !== undefined || args.providerPaymentIds !== undefined) {
    const selection =
      args.resourceIds !== undefined
        ? await args.stub.listStripePaymentReconciliationCandidates({
            organizationId: args.organizationId,
            resourceIds: args.resourceIds,
            snapshotAt: args.snapshotAt,
            since: args.since,
          })
        : await args.stub.listStripePaymentReconciliationCandidates({
            organizationId: args.organizationId,
            providerPaymentIds: args.providerPaymentIds,
            snapshotAt: args.snapshotAt,
            since: args.since,
          });
    const requestedIds = args.resourceIds ?? args.providerPaymentIds ?? [];
    const candidateIds = new Set(
      selection.candidates.map((candidate) =>
        args.resourceIds !== undefined ? candidate.resourceId : candidate.providerPaymentId,
      ),
    );
    return requestedIds.some((id) => !candidateIds.has(id)) ? null : selection.candidates;
  }

  const { candidates } = await args.stub.listStripePaymentReconciliationCandidates({
    limit: 200,
    organizationId: args.organizationId,
    since: args.since,
  });
  return candidates;
}

async function fetchReconciliationSnapshot(
  secretKey: string,
  accountId: string,
  candidate: LocalPaymentCandidate,
  organizationId: string,
): Promise<{
  readonly lookupError: ReconciliationLookupError | null;
  readonly snapshot: StripePaymentSnapshot | null;
}> {
  try {
    let providerPaymentId = candidate.providerPaymentId;
    let checkoutSessionSnapshot: Partial<StripePaymentSnapshot> = {};
    if (providerPaymentId === "") {
      const session = await retrieveStripeCheckoutReconciliationSession(
        secretKey,
        accountId,
        candidate.providerSessionId,
      );
      checkoutSessionSnapshot = checkoutSessionSnapshotFields(session);
      providerPaymentId = session.paymentIntentId ?? "";
      if (
        !providerPaymentId.startsWith("pi_") ||
        !checkoutSessionMatchesCandidate(session, candidate, organizationId)
      ) {
        return {
          lookupError: null,
          snapshot: checkoutSessionFallbackSnapshot(
            session,
            candidate,
            providerPaymentId,
            checkoutSessionSnapshot,
          ),
        };
      }
    }
    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      accountId,
      providerPaymentId,
    );
    return { lookupError: null, snapshot: { ...snapshot, ...checkoutSessionSnapshot } };
  } catch (err: unknown) {
    if (err instanceof StripeConnectError) {
      return {
        lookupError: { code: err.code, message: err.safeMessage, status: err.status },
        snapshot: null,
      };
    }
    return {
      lookupError: { message: err instanceof Error ? err.message : String(err) },
      snapshot: null,
    };
  }
}

function buildReconciliationRow(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot | null,
  lookupError: ReconciliationLookupError | null,
): PlatformStripeReconciliationRow {
  const comparison = compareStripePaymentToLocalCandidate(candidate, snapshot, lookupError);
  return {
    classification: comparison.classification,
    createdAt: candidate.createdAt,
    currency: candidate.currency,
    localAmountCents: candidate.amountCents,
    localPaymentAttemptStatus: candidate.paymentAttemptStatus,
    localProcessorFeeCents: candidate.processorFeeCents,
    localProviderBalanceTransactionId: candidate.providerBalanceTransactionId,
    localResourceStatus: candidate.resourceStatus,
    manualReviewReason: comparison.manualReviewReason,
    paymentAttemptId: candidate.paymentAttemptId,
    paymentType: candidate.paymentType,
    proposedActions: [...comparison.proposedActions],
    providerPaymentId: reconciliationProviderPaymentId(snapshot, candidate),
    resourceId: candidate.resourceId,
    safeToApply: comparison.safeToApply,
    ...stripeRowFields(snapshot),
    stripeStatus: comparison.stripeStatus,
  };
}

async function applyReconciliationToCandidate(args: {
  readonly accountId: string;
  readonly adminUserId: string;
  readonly candidate: LocalPaymentCandidate;
  readonly organizationId: string;
  readonly reason: string;
  readonly secretKey: string;
  readonly stub: ReturnType<typeof organizationStoreStub>;
}): Promise<PlatformStripeReconciliationApplyResult> {
  const { lookupError, snapshot } = await fetchReconciliationSnapshot(
    args.secretKey,
    args.accountId,
    args.candidate,
    args.organizationId,
  );
  const comparison = compareStripePaymentToLocalCandidate(args.candidate, snapshot, lookupError);

  if (!snapshot || !comparison.safeToApply || comparison.proposedActions.length === 0) {
    return {
      actionsApplied: [],
      message: comparison.manualReviewReason ?? "Row is already matched or requires manual review.",
      providerPaymentId: reconciliationProviderPaymentId(snapshot, args.candidate),
      status: "skipped",
    };
  }

  const applyResult = await args.stub.applyHistoricalStripeReconciliation({
    actions: comparison.proposedActions,
    adminUserId: args.adminUserId,
    candidate: args.candidate,
    organizationId: args.organizationId,
    providerPaymentId: snapshot.providerPaymentId,
    reason: args.reason,
    stripeSnapshot: stripeSnapshotForApply(snapshot),
  });

  return {
    actionsApplied: [...applyResult.actionsApplied],
    message: applyResult.message,
    providerPaymentId: reconciliationProviderPaymentId(snapshot, args.candidate),
    status: applyResult.status,
  };
}

async function resolveReconciliationStripeAccess(
  context: Context<WorkerHonoEnvironment>,
  stub: ReturnType<typeof organizationStoreStub>,
  organizationId: string,
): Promise<
  | { readonly accountId: string; readonly ok: true; readonly secretKey: string }
  | { readonly ok: false; readonly response: Response }
> {
  const eligibilityRes = await invokeOrganizationRpc(
    stub,
    `https://organization.internal/internal/stripe-connect/eligibility?organizationId=${encodeURIComponent(organizationId)}`,
  );
  if (!eligibilityRes.ok) {
    return {
      ok: false,
      response: context.json(
        {
          code: "stripe_connect_unavailable",
          message: "Organization Stripe Connect details could not be checked.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      ),
    };
  }
  const eligibility = await eligibilityRes.json<{ readonly accountId: string | null }>();
  if (!eligibility.accountId) {
    return {
      ok: false,
      response: context.json(
        {
          code: "stripe_connect_not_connected",
          message: "This Organization does not currently have a connected Stripe account.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      ),
    };
  }
  const secretKey = context.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      ok: false,
      response: context.json(
        {
          code: "stripe_unavailable",
          message: "Stripe API key is not configured.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      ),
    };
  }
  return { accountId: eligibility.accountId, ok: true, secretKey };
}

async function requireReconciliationElevation(
  context: Context<WorkerHonoEnvironment>,
  requestUrl: URL,
  organizationId: string,
): Promise<
  | { readonly adminUserId: string; readonly ok: true }
  | { readonly ok: false; readonly response: Response }
> {
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    return {
      ok: false,
      response: context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      ),
    };
  }
  const elevation = await getPlatformOrganizationContext(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id ?? "",
    authorization.value.userId,
  );
  if (!elevation.canEdit) {
    return {
      ok: false,
      response: context.json(
        {
          code: "platform_elevation_required",
          message:
            "Enable a current Platform Administrator elevation before applying reconciliation.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      ),
    };
  }
  return { adminUserId: authorization.value.userId, ok: true };
}

async function listOrganizationExportArchives(
  bucket: R2Bucket,
  organizationId: string,
): Promise<{ readonly objects: readonly R2Object[]; readonly truncated: boolean }> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  for (;;) {
    const prefix = `organizations/${organizationId}/exports/`;
    const page = await bucket.list(
      cursor
        ? { cursor, limit: RECONCILIATION_ARCHIVE_PAGE_SIZE, prefix }
        : { limit: RECONCILIATION_ARCHIVE_PAGE_SIZE, prefix },
    );
    objects.push(...page.objects);
    if (objects.length > 10_000) return { objects, truncated: true };
    if (!page.truncated || !page.cursor) return { objects, truncated: false };
    cursor = page.cursor;
  }
}

async function readAndMergeReconciliationReport(
  context: WorkerContext,
  organizationId: string,
): Promise<ReconciliationReport | Response> {
  const reportResponse = await invokeOrganizationRpc(
    organizationStoreStub(context.env, organizationId),
    `https://organization.internal/internal/reconciliation-report?organizationId=${encodeURIComponent(organizationId)}`,
  );
  const report = reconciliationReportSchema.safeParse(
    await reportResponse.json().catch(() => null),
  );
  if (!reportResponse.ok || !report.success) {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization reconciliation report could not be read.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }

  const archiveObjects = await listOrganizationExportArchives(
    context.env.ORGANIZATION_FILES,
    organizationId,
  );
  if (archiveObjects.truncated) {
    return context.json(
      {
        code: "reconciliation_report_too_large",
        message: "The Organization has too many export archives to audit in one report.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
  const knownOrphans = new Map(
    report.data.orphanedExportArchives.map((archive) => [archive.archiveKey, archive]),
  );
  const completedArchives = new Set(report.data.completedExportArchiveKeys);
  for (const object of archiveObjects.objects) {
    if (completedArchives.has(object.key) || knownOrphans.has(object.key)) continue;
    knownOrphans.set(object.key, {
      archiveKey: object.key,
      exportId: object.customMetadata?.exportId ?? "unknown",
      status: "unreferenced",
    });
  }
  return {
    ...report.data,
    orphanedExportArchives: [...knownOrphans.values()],
  };
}

export function registerPlatformReconciliationRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post(
    "/api/platform/organizations/:organizationId/stripe-reconciliation/preview",
    async (context) => {
      validateStartupConfig(context.env);
      const requestUrl = new URL(context.req.url);
      if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
        return context.json(
          {
            code: "not_found",
            message:
              "Platform Stripe reconciliation requires the product base hostname or a registered Organization host.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const organizationId = organizationIdSchema.safeParse(context.req.param("organizationId"));
      if (!organizationId.success) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const authorization = await authorizePlatformRead(context, requestUrl);
      if (authorization instanceof Response) return authorization;
      const organization = await context.env.CONTROL_DB.prepare(
        "SELECT id FROM organizations WHERE id = ? LIMIT 1",
      )
        .bind(organizationId.data)
        .first<{ readonly id: string }>();
      if (!organization) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      const parsedBody = platformStripeReconciliationPreviewRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => ({})),
      );
      if (!parsedBody.success) {
        return context.json(
          {
            code: "validation_failed",
            message: "Invalid preview request parameters.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }

      const stub = organizationStoreStub(context.env, organizationId.data);
      const stripeAccess = await resolveReconciliationStripeAccess(
        context,
        stub,
        organizationId.data,
      );
      if (!stripeAccess.ok) return stripeAccess.response;
      const { accountId, secretKey } = stripeAccess;

      const { candidates, hasMore, nextCursor, snapshotAt } =
        await stub.listStripePaymentReconciliationCandidates({
          ...(parsedBody.data.cursor ? { cursor: parsedBody.data.cursor } : {}),
          ...(parsedBody.data.limit !== undefined ? { limit: parsedBody.data.limit } : {}),
          ...(parsedBody.data.snapshotAt ? { snapshotAt: parsedBody.data.snapshotAt } : {}),
          organizationId: organizationId.data,
          since: parsedBody.data.since,
        });

      const rows: PlatformStripeReconciliationRow[] = await mapConcurrent(
        candidates,
        4,
        async (candidate) => {
          const { lookupError, snapshot } = await fetchReconciliationSnapshot(
            secretKey,
            accountId,
            candidate,
            organizationId.data,
          );
          return buildReconciliationRow(candidate, snapshot, lookupError);
        },
      );

      const scannedCount = rows.length;
      const matchedCount = rows.filter((r) => r.classification === "matched").length;
      const repairableCount = rows.filter(
        (r) => r.safeToApply && r.proposedActions.length > 0,
      ).length;
      const manualReviewCount = rows.filter(
        (r) => !r.safeToApply && r.classification !== "matched",
      ).length;

      const occurredAt = new Date().toISOString();
      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.stripe_reconciliation.previewed', 'organization', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          authorization.userId,
          organizationId.data,
          organizationId.data,
          context.get("requestId"),
          JSON.stringify({
            accountId,
            manualReviewCount,
            matchedCount,
            repairableCount,
            scannedCount,
            cursor: parsedBody.data.cursor ?? null,
            snapshotAt,
            since: parsedBody.data.since ?? null,
          }),
          occurredAt,
        )
        .run();

      const responsePayload: PlatformStripeReconciliationPreviewResponse = {
        accountId,
        hasMore,
        manualReviewCount,
        matchedCount,
        organizationId: organizationId.data,
        repairableCount,
        requestId: context.get("requestId"),
        rows,
        scannedCount,
        nextCursor,
        snapshotAt,
      };

      return context.json(responsePayload);
    },
  );

  router.post(
    "/api/platform/organizations/:organizationId/stripe-reconciliation/apply",
    async (context) => {
      validateStartupConfig(context.env);
      const requestUrl = new URL(context.req.url);
      if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
        return context.json(
          {
            code: "not_found",
            message:
              "Platform Stripe reconciliation requires the product base hostname or a registered Organization host.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const organizationId = organizationIdSchema.safeParse(context.req.param("organizationId"));
      if (!organizationId.success) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      const elevation = await requireReconciliationElevation(
        context,
        requestUrl,
        organizationId.data,
      );
      if (!elevation.ok) return elevation.response;

      const organization = await context.env.CONTROL_DB.prepare(
        "SELECT id FROM organizations WHERE id = ? LIMIT 1",
      )
        .bind(organizationId.data)
        .first<{ readonly id: string }>();
      if (!organization) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      const parsedBody = platformStripeReconciliationApplyRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => null),
      );
      if (!parsedBody.success) {
        return context.json(
          {
            code: "validation_failed",
            message:
              "A valid confirmation, auditable reason (3-500 characters), and parameters are required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }

      const stub = organizationStoreStub(context.env, organizationId.data);
      const stripeAccess = await resolveReconciliationStripeAccess(
        context,
        stub,
        organizationId.data,
      );
      if (!stripeAccess.ok) return stripeAccess.response;
      const { accountId, secretKey } = stripeAccess;

      const targetCandidates = await selectReconciliationApplyCandidates({
        organizationId: organizationId.data,
        paymentAttemptIds: parsedBody.data.paymentAttemptIds,
        providerPaymentIds: parsedBody.data.providerPaymentIds,
        resourceIds: parsedBody.data.resourceIds,
        since: parsedBody.data.since,
        snapshotAt: parsedBody.data.snapshotAt,
        stub,
      });
      if (!targetCandidates) return staleReconciliationSelectionResponse(context);

      const results: PlatformStripeReconciliationApplyResult[] = await mapConcurrent(
        targetCandidates,
        4,
        async (candidate) =>
          applyReconciliationToCandidate({
            accountId,
            adminUserId: elevation.adminUserId,
            candidate,
            organizationId: organizationId.data,
            reason: parsedBody.data.reason,
            secretKey,
            stub,
          }),
      );

      const appliedCount = results.filter((r) => r.status === "applied").length;
      const skippedCount = results.filter((r) => r.status === "skipped").length;
      const failedCount = results.filter((r) => r.status === "failed").length;
      const refundedCount = results.filter((r) =>
        r.actionsApplied.includes("mark_refunded"),
      ).length;
      const paidCount = results.filter((r) => r.actionsApplied.includes("mark_paid")).length;
      const feeBackfilledCount = results.filter((r) =>
        r.actionsApplied.includes("backfill_fee"),
      ).length;

      const occurredAt = new Date().toISOString();
      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
          (id, actor_user_id, organization_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, ?, ?, 'platform.stripe_reconciliation.applied', 'organization', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          elevation.adminUserId,
          organizationId.data,
          organizationId.data,
          context.get("requestId"),
          JSON.stringify({
            accountId,
            appliedCount,
            failedCount,
            feeBackfilledCount,
            paidCount,
            reason: parsedBody.data.reason,
            refundedCount,
            skippedCount,
          }),
          occurredAt,
        )
        .run();

      const responsePayload: PlatformStripeReconciliationApplyResponse = {
        accountId,
        appliedCount,
        failedCount,
        feeBackfilledCount,
        organizationId: organizationId.data,
        paidCount,
        refundedCount,
        requestId: context.get("requestId"),
        results,
        skippedCount,
      };

      return context.json(responsePayload);
    },
  );

  router.get("/api/platform/reconciliation-report", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "A registered canonical hostname is required for reconciliation reports.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const authorization = await authorizePlatformRead(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const report = await readAndMergeReconciliationReport(context, organizationId);
    if (report instanceof Response) return report;
    return context.json({
      ...report,
      requestId: context.get("requestId"),
    });
  });
}
