import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { recordDatabaseCost } from "../observability/databaseCost";
import { z } from "zod";

export const publicCheckoutRateLimitRequestSchema = z.object({
  action: z.enum(["ticket_checkout", "donation_checkout", "ticket_quote"]),
  checkoutRequestId: z.uuid().optional(),
  clientKey: z.string().min(1).max(128),
  emailKey: z.string().min(1).max(128).optional(),
  hasTurnstileToken: z.boolean().default(false),
  organizationId: z.string().min(1).max(128),
  turnstileVerified: z.boolean().default(false),
});

export type PublicCheckoutRateLimitRequest = z.infer<typeof publicCheckoutRateLimitRequestSchema>;

interface RateLimitBucketDefinition {
  readonly bucketKey: string;
  readonly challengeThreshold?: number;
  readonly durationMs: number;
  readonly limit: number;
}

function isIdempotentReplay(
  storage: DurableObjectStorage,
  action: string,
  checkoutRequestId?: string,
): { readonly isReplay: boolean; readonly rowsRead: number; readonly rowsWritten: number } {
  if (!checkoutRequestId) return { isReplay: false, rowsRead: 0, rowsWritten: 0 };
  const table = action === "ticket_checkout" ? "ticket_purchases" : "donations";
  const cursor = storage.sql.exec<{ readonly id: string }>(
    `SELECT id FROM ${table} WHERE checkout_request_id = ? LIMIT 1`,
    checkoutRequestId,
  );
  const existing = cursor.toArray().at(0);
  return {
    isReplay: Boolean(existing),
    rowsRead: cursor.rowsRead,
    rowsWritten: cursor.rowsWritten,
  };
}

function buildRateLimitBuckets(data: PublicCheckoutRateLimitRequest): RateLimitBucketDefinition[] {
  if (data.action === "ticket_quote") {
    return [
      {
        bucketKey: `quote:ticket:ip:${data.clientKey}`,
        durationMs: 60 * 1_000,
        limit: 30,
      },
      {
        bucketKey: `quote:ticket:organization:${data.organizationId}`,
        durationMs: 60 * 1_000,
        limit: 200,
      },
    ];
  }

  const prefix = data.action === "ticket_checkout" ? "checkout:ticket" : "checkout:donation";
  const buckets: RateLimitBucketDefinition[] = [
    {
      bucketKey: `${prefix}:ip:${data.clientKey}`,
      challengeThreshold: 5,
      durationMs: 10 * 60 * 1_000,
      limit: 10,
    },
    {
      bucketKey: `${prefix}:organization:${data.organizationId}`,
      durationMs: 10 * 60 * 1_000,
      limit: 60,
    },
  ];
  if (data.emailKey) {
    buckets.push({
      bucketKey: `${prefix}:email:${data.emailKey}`,
      challengeThreshold: 5,
      durationMs: 10 * 60 * 1_000,
      limit: 10,
    });
  }
  return buckets;
}

export function checkPublicCheckoutRateLimit(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const parsed = publicCheckoutRateLimitRequestSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ code: "invalid_public_rate_limit_request" }, { status: 400 });
  }

  let totalRowsRead = 0;
  let totalRowsWritten = 0;

  const identityCursor = storage.sql.exec<{ readonly organizationId: string }>(
    "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
  );
  const identity = identityCursor.toArray().at(0)?.organizationId;
  totalRowsRead += identityCursor.rowsRead;
  totalRowsWritten += identityCursor.rowsWritten;

  if (identity !== parsed.data.organizationId) {
    recordDatabaseCost({
      operation: "organization_sqlite.rate_limit.checkout",
      rowsRead: totalRowsRead,
      rowsWritten: totalRowsWritten,
      store: "organization_sqlite",
    });
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const replayCheck = isIdempotentReplay(
    storage,
    parsed.data.action,
    parsed.data.checkoutRequestId,
  );
  totalRowsRead += replayCheck.rowsRead;
  totalRowsWritten += replayCheck.rowsWritten;

  if (replayCheck.isReplay) {
    recordDatabaseCost({
      operation: "organization_sqlite.rate_limit.checkout",
      rowsRead: totalRowsRead,
      rowsWritten: totalRowsWritten,
      store: "organization_sqlite",
    });
    return Response.json({ allowed: true, idempotentReplay: true });
  }

  const now = Date.now();
  const buckets = buildRateLimitBuckets(parsed.data);

  const result = storage.transactionSync(() => {
    const existing = buckets.map((bucket) => {
      const cursor = storage.sql.exec<{
        readonly requestCount: number;
        readonly windowStartedAt: number;
      }>(
        `SELECT request_count AS requestCount, window_started_at AS windowStartedAt
           FROM public_rate_limit_buckets WHERE bucket_key = ? LIMIT 1`,
        bucket.bucketKey,
      );
      const row = cursor.toArray().at(0);
      totalRowsRead += cursor.rowsRead;
      totalRowsWritten += cursor.rowsWritten;
      return {
        ...bucket,
        row,
      };
    });

    const retryAfterSeconds = existing.reduce((retryAfter, bucket) => {
      if (!bucket.row || now - bucket.row.windowStartedAt >= bucket.durationMs) return retryAfter;
      if (bucket.row.requestCount < bucket.limit) return retryAfter;
      return Math.max(
        retryAfter,
        Math.ceil((bucket.durationMs - (now - bucket.row.windowStartedAt)) / 1_000),
      );
    }, 0);

    if (retryAfterSeconds > 0) {
      return { allowed: false, reason: "limit_exceeded", retryAfterSeconds };
    }

    const needsChallenge = existing.some(
      (b) =>
        b.challengeThreshold !== undefined &&
        b.row !== undefined &&
        now - b.row.windowStartedAt < b.durationMs &&
        b.row.requestCount >= b.challengeThreshold,
    );

    if (needsChallenge) {
      if (!parsed.data.hasTurnstileToken) {
        return { allowed: false, reason: "challenge_required", retryAfterSeconds: 0 };
      }
      if (!parsed.data.turnstileVerified) {
        return { allowed: false, reason: "invalid_challenge_token", retryAfterSeconds: 0 };
      }
    }

    for (const bucket of existing) {
      const active = bucket.row && now - bucket.row.windowStartedAt < bucket.durationMs;
      if (active) {
        const updateCursor = storage.sql.exec(
          `UPDATE public_rate_limit_buckets
           SET request_count = request_count + 1 WHERE bucket_key = ?`,
          bucket.bucketKey,
        );
        totalRowsRead += updateCursor.rowsRead;
        totalRowsWritten += updateCursor.rowsWritten;
      } else {
        const insertCursor = storage.sql.exec(
          `INSERT INTO public_rate_limit_buckets (bucket_key, window_started_at, request_count)
           VALUES (?, ?, 1)
           ON CONFLICT(bucket_key) DO UPDATE SET window_started_at = excluded.window_started_at,
             request_count = excluded.request_count`,
          bucket.bucketKey,
          now,
        );
        totalRowsRead += insertCursor.rowsRead;
        totalRowsWritten += insertCursor.rowsWritten;
      }
    }

    const pruneCursor = storage.sql.exec(
      "DELETE FROM public_rate_limit_buckets WHERE window_started_at < ?",
      now - 24 * 60 * 60 * 1_000,
    );
    totalRowsRead += pruneCursor.rowsRead;
    totalRowsWritten += pruneCursor.rowsWritten;

    return { allowed: true, reason: "ok", retryAfterSeconds: 0 };
  });

  recordDatabaseCost({
    operation: "organization_sqlite.rate_limit.checkout",
    rowsRead: totalRowsRead,
    rowsWritten: totalRowsWritten,
    store: "organization_sqlite",
  });

  if (!result.allowed) {
    if (result.reason === "challenge_required") {
      return Response.json(
        {
          code: "challenge_required",
          message: "Verification challenge required to proceed with checkout.",
        },
        { status: 403 },
      );
    }
    if (result.reason === "invalid_challenge_token") {
      return Response.json(
        {
          code: "invalid_challenge_token",
          message: "Verification challenge failed. Please try again.",
        },
        { status: 403 },
      );
    }
    return new Response(
      JSON.stringify({
        code: "public_rate_limit_exceeded",
        message: "Too many checkout requests. Please try again later.",
        retryAfterSeconds: result.retryAfterSeconds,
      }),
      {
        headers: {
          "content-type": "application/json",
          "retry-after": String(result.retryAfterSeconds),
        },
        status: 429,
      },
    );
  }

  return Response.json({ allowed: true, idempotentReplay: false });
}
