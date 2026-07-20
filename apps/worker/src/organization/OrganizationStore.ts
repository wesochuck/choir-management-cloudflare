import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import type { Env } from "../env";
import { deliveryJobSchema } from "../jobs/contracts";
import { migrateOrganization } from "./migrations";

const completionSchema = z.object({
  completedAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
});

export class OrganizationStore extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    migrateOrganization(state.storage.sql);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/internal/health") {
      return Response.json({ status: "ok" });
    }

    if (request.method === "POST" && url.pathname === "/internal/jobs/claim") {
      const parsed = deliveryJobSchema.safeParse(await request.json());
      if (!parsed.success) {
        return Response.json({ code: "invalid_job" }, { status: 400 });
      }

      const existing = this.ctx.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM job_ledger WHERE idempotency_key = ? LIMIT 1",
          parsed.data.idempotencyKey,
        )
        .toArray()
        .at(0);
      if (existing) {
        return Response.json({ claimed: false, status: existing.status });
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO job_ledger
          (idempotency_key, job_id, kind, status, attempt, claimed_at)
          VALUES (?, ?, ?, 'claimed', ?, ?)`,
        parsed.data.idempotencyKey,
        parsed.data.jobId,
        parsed.data.kind,
        parsed.data.attempt,
        new Date().toISOString(),
      );
      return Response.json({ claimed: true, status: "claimed" });
    }

    if (request.method === "POST" && url.pathname === "/internal/jobs/complete") {
      const parsed = completionSchema.safeParse(await request.json());
      if (!parsed.success) {
        return Response.json({ code: "invalid_completion" }, { status: 400 });
      }
      this.ctx.storage.sql.exec(
        `UPDATE job_ledger SET status = 'completed', completed_at = ?
         WHERE idempotency_key = ? AND status = 'claimed'`,
        parsed.data.completedAt,
        parsed.data.idempotencyKey,
      );
      return Response.json({ completed: true });
    }

    return Response.json({ code: "not_found" }, { status: 404 });
  }
}
