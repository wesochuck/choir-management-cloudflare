import { z } from "zod";
import { retrieveStripePaymentSettlement } from "../../payments/stripeConnect";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";

const stripeConnectResponseSchema = z.object({
  accountId: z.string().nullable().optional(),
});

const unreconciledResponseSchema = z.object({
  providerPaymentIds: z.array(z.string()).optional(),
});

async function resolveConnectedAccountId(
  env: JobConsumerEnv,
  objectStub: ReturnType<typeof organizationStoreStub>,
  organizationId: string,
): Promise<string> {
  const connectUrl = new URL("https://organization.internal/internal/stripe-connect");
  connectUrl.searchParams.set("organizationId", organizationId);
  const connectRes = await invokeOrganizationRpc(objectStub, connectUrl);
  const connectJson: unknown = await connectRes.json().catch(() => null);
  const parsed = stripeConnectResponseSchema.safeParse(connectJson);
  let accountId = parsed.success ? (parsed.data.accountId ?? null) : null;

  if (!accountId && env.CONTROL_DB) {
    const row = await env.CONTROL_DB.prepare(
      `SELECT account_id AS accountId
         FROM stripe_connected_accounts
         WHERE organization_id = ? AND status = 'active'
         LIMIT 1`,
    )
      .bind(organizationId)
      .first<{ readonly accountId: string }>();
    accountId = row?.accountId ?? null;
  }

  if (!accountId || !env.STRIPE_SECRET_KEY) {
    throw new Error(
      `Stripe is not configured for organization ${organizationId} to reconcile fees.`,
    );
  }

  return accountId;
}

async function resolvePaymentIdsToReconcile(
  objectStub: ReturnType<typeof organizationStoreStub>,
  job: DeliveryJob,
): Promise<readonly string[]> {
  if (job.idempotencyKey.startsWith("reconcile-fee:")) {
    const paymentId = job.idempotencyKey.slice("reconcile-fee:".length);
    if (paymentId) return [paymentId];
  }

  const unreconciledUrl = new URL("https://organization.internal/internal/payments/unreconciled");
  unreconciledUrl.searchParams.set("organizationId", job.organizationId);
  const unreconciledRes = await invokeOrganizationRpc(objectStub, unreconciledUrl);
  const unreconciledJson: unknown = await unreconciledRes.json().catch(() => null);
  const parsed = unreconciledResponseSchema.safeParse(unreconciledJson);
  return parsed.success ? (parsed.data.providerPaymentIds ?? []) : [];
}

async function reconcileSinglePayment(
  env: JobConsumerEnv,
  objectStub: ReturnType<typeof organizationStoreStub>,
  organizationId: string,
  accountId: string,
  providerPaymentId: string,
): Promise<void> {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      `Stripe secret key missing for fee reconciliation on organization ${organizationId}.`,
    );
  }
  const settlement = await retrieveStripePaymentSettlement(secretKey, accountId, providerPaymentId);

  if (settlement.feeCents === null) {
    throw new Error(`Stripe fee settlement is pending for payment ${providerPaymentId}.`);
  }

  const manageUrl = new URL("https://organization.internal/internal/payments/manage");
  const dispatchRes = await invokeOrganizationRpc(objectStub, manageUrl, {
    body: JSON.stringify({
      action: "reconcile_payment_processor_fee",
      organizationId,
      processorFeeCents: settlement.feeCents,
      providerBalanceTransactionId: settlement.balanceTransactionId ?? null,
      providerPaymentId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!dispatchRes.ok) {
    throw new Error(`Failed to record reconciled processor fee for payment ${providerPaymentId}.`);
  }
}

export async function deliverPaymentFeeReconciliationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const objectStub = organizationStoreStub(env, job.organizationId);
  const accountId = await resolveConnectedAccountId(env, objectStub, job.organizationId);
  const paymentIds = await resolvePaymentIdsToReconcile(objectStub, job);

  for (const providerPaymentId of paymentIds) {
    await reconcileSinglePayment(env, objectStub, job.organizationId, accountId, providerPaymentId);
  }
}
