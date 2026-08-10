import type { DurableObjectStorage } from "@cloudflare/workers-types";

import { publicAuditionRateLimitRequestSchema, publicAuditionRateLimits } from "./contracts";

export async function checkPublicAuditionInquiryRateLimit(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = publicAuditionRateLimitRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ code: "invalid_public_rate_limit_request" }, { status: 400 });
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const now = Date.now();
  const buckets = [
    ...publicAuditionRateLimits.map((limit) => ({
      ...limit,
      bucketKey:
        limit.key === "ip"
          ? `audition:ip:${parsed.data.clientKey}`
          : limit.key === "email"
            ? `audition:email:${parsed.data.emailKey}`
            : `audition:organization:${parsed.data.organizationId}`,
    })),
  ];
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
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };
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
    return { allowed: true, retryAfterSeconds: 0 };
  });
  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        code: "public_rate_limit_exceeded",
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
  return Response.json({ allowed: true });
}
