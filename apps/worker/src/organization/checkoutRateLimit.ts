import type { DurableObjectStorage } from "@cloudflare/workers-types";
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
): boolean {
  if (!checkoutRequestId) return false;
  const table = action === "ticket_checkout" ? "ticket_purchases" : "donations";
  const existing = storage.sql
    .exec<{ readonly id: string }>(
      `SELECT id FROM ${table} WHERE checkout_request_id = ? LIMIT 1`,
      checkoutRequestId,
    )
    .toArray()
    .at(0);
  return Boolean(existing);
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

  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  if (isIdempotentReplay(storage, parsed.data.action, parsed.data.checkoutRequestId)) {
    return Response.json({ allowed: true, idempotentReplay: true });
  }

  const now = Date.now();
  const buckets = buildRateLimitBuckets(parsed.data);

  const result = storage.transactionSync(() => {
    const existing = buckets.map((bucket) => ({
      ...bucket,
      row: storage.sql
        .exec<{ readonly requestCount: number; readonly windowStartedAt: number }>(
          `SELECT request_count AS requestCount, window_started_at AS windowStartedAt
           FROM public_rate_limit_buckets WHERE bucket_key = ? LIMIT 1`,
          bucket.bucketKey,
        )
        .toArray()
        .at(0),
    }));

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
        storage.sql.exec(
          `UPDATE public_rate_limit_buckets
           SET request_count = request_count + 1 WHERE bucket_key = ?`,
          bucket.bucketKey,
        );
      } else {
        storage.sql.exec(
          `INSERT INTO public_rate_limit_buckets (bucket_key, window_started_at, request_count)
           VALUES (?, ?, 1)
           ON CONFLICT(bucket_key) DO UPDATE SET window_started_at = excluded.window_started_at,
             request_count = excluded.request_count`,
          bucket.bucketKey,
          now,
        );
      }
    }

    storage.sql.exec(
      "DELETE FROM public_rate_limit_buckets WHERE window_started_at < ?",
      now - 24 * 60 * 60 * 1_000,
    );

    return { allowed: true, reason: "ok", retryAfterSeconds: 0 };
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
