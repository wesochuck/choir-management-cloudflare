import { z } from "zod";
import { stripeChargeRefundIsComplete } from "./stripeWebhook";
import { stripeV1Request } from "./stripeClient";

export interface StripePaymentSettlement {
  readonly balanceTransactionId: string | null;
  readonly currency: string | null;
  readonly feeCents: number | null;
  readonly netCents: number | null;
}

const stripeSettlementBalanceTxnSchema = z.object({
  currency: z.string().optional(),
  fee: z.number().int(),
  id: z.string().min(1).max(256),
  net: z.number().int().optional(),
});

const stripeSettlementChargeSchema = z.object({
  balance_transaction: z
    .union([stripeSettlementBalanceTxnSchema, z.string().min(1)])
    .nullable()
    .optional(),
});

const stripeSettlementPaymentIntentSchema = z.object({
  latest_charge: z
    .union([stripeSettlementChargeSchema, z.string().min(1)])
    .nullable()
    .optional(),
});

function extractBalanceTransaction(
  result: unknown,
  isPaymentIntent: boolean,
): z.infer<typeof stripeSettlementBalanceTxnSchema> | string | null {
  if (isPaymentIntent) {
    const piParsed = stripeSettlementPaymentIntentSchema.safeParse(result);
    if (
      piParsed.success &&
      piParsed.data.latest_charge &&
      typeof piParsed.data.latest_charge === "object"
    ) {
      return piParsed.data.latest_charge.balance_transaction ?? null;
    }
    return null;
  }
  const chargeParsed = stripeSettlementChargeSchema.safeParse(result);
  return chargeParsed.success ? (chargeParsed.data.balance_transaction ?? null) : null;
}

async function fetchBalanceTransactionById(
  secretKey: string,
  connectedAccountId: string,
  balanceTxnId: string,
): Promise<StripePaymentSettlement> {
  const txnResult: unknown = await stripeV1Request(
    secretKey,
    `/v1/balance_transactions/${encodeURIComponent(balanceTxnId)}`,
    {
      errorType: "connect",
      method: "GET",
      stripeAccount: connectedAccountId,
    },
  );
  const parsedTxn = stripeSettlementBalanceTxnSchema.safeParse(txnResult);
  if (parsedTxn.success) {
    return {
      balanceTransactionId: parsedTxn.data.id,
      currency: parsedTxn.data.currency ?? null,
      feeCents: parsedTxn.data.fee,
      netCents: parsedTxn.data.net ?? null,
    };
  }
  return {
    balanceTransactionId: balanceTxnId,
    currency: null,
    feeCents: null,
    netCents: null,
  };
}

export async function retrieveStripePaymentSettlement(
  secretKey: string,
  connectedAccountId: string,
  providerPaymentId: string,
): Promise<StripePaymentSettlement> {
  const isPaymentIntent = providerPaymentId.startsWith("pi_");
  const path = isPaymentIntent
    ? `/v1/payment_intents/${encodeURIComponent(providerPaymentId)}?expand[]=latest_charge.balance_transaction`
    : `/v1/charges/${encodeURIComponent(providerPaymentId)}?expand[]=balance_transaction`;

  const result: unknown = await stripeV1Request(secretKey, path, {
    errorType: "connect",
    method: "GET",
    stripeAccount: connectedAccountId,
  });

  const balanceTxn = extractBalanceTransaction(result, isPaymentIntent);

  if (balanceTxn && typeof balanceTxn === "object") {
    return {
      balanceTransactionId: balanceTxn.id,
      currency: balanceTxn.currency ?? null,
      feeCents: balanceTxn.fee,
      netCents: balanceTxn.net ?? null,
    };
  }

  if (typeof balanceTxn === "string") {
    return fetchBalanceTransactionById(secretKey, connectedAccountId, balanceTxn);
  }

  return {
    balanceTransactionId: null,
    currency: null,
    feeCents: null,
    netCents: null,
  };
}

export interface StripePaymentReconciliationSnapshot {
  readonly amountChargedCents: number;
  readonly amountCapturedCents?: number | null | undefined;
  readonly amountReceivedCents?: number | null | undefined;
  readonly amountRefundedCents: number;
  readonly chargeId: string | null;
  readonly chargeCaptured?: boolean | null | undefined;
  readonly chargeStatus?: string | null | undefined;
  readonly currency: string | null;
  readonly fullyRefunded: boolean;
  readonly processorFeeCents: number | null;
  readonly providerBalanceTransactionId: string | null;
  readonly providerPaymentId: string;
  readonly paymentIntentId?: string | null | undefined;
  readonly paymentIntentStatus?: string | null | undefined;
  readonly refundCompletedAt: string | null;
}

const stripeReconciliationBalanceTxnSchema = z.object({
  currency: z.string().optional(),
  fee: z.number().int().nonnegative(),
  id: z.string(),
  net: z.number().int().optional(),
});

const stripeReconciliationRefundItemSchema = z.object({
  amount: z.number().int().nonnegative().optional(),
  created: z.number(),
  id: z.string(),
  status: z.string().optional(),
});

const stripeReconciliationChargeSchema = z.object({
  amount: z.number().int().nonnegative(),
  amount_captured: z.number().int().nonnegative().optional(),
  amount_refunded: z.number().int().nonnegative().optional().default(0),
  balance_transaction: z
    .union([stripeReconciliationBalanceTxnSchema, z.string().min(1)])
    .nullable()
    .optional(),
  currency: z.string().optional(),
  captured: z.boolean().optional(),
  id: z.string(),
  paid: z.boolean().optional(),
  payment_intent: z.string().nullable().optional(),
  refunded: z.boolean().optional(),
  refunds: z
    .object({
      data: z.array(stripeReconciliationRefundItemSchema),
    })
    .nullable()
    .optional(),
  status: z.string().optional(),
});

const stripeReconciliationPaymentIntentSchema = z.object({
  amount: z.number().int().nonnegative().optional(),
  amount_received: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  id: z.string(),
  latest_charge: z
    .union([stripeReconciliationChargeSchema, z.string().min(1)])
    .nullable()
    .optional(),
  status: z.string().optional(),
});

type ReconciliationCharge = z.infer<typeof stripeReconciliationChargeSchema>;

interface ResolvedReconciliationCharge {
  readonly charge: ReconciliationCharge | null;
  readonly fallbackAmount: number;
  readonly fallbackCurrency: string | null;
  readonly amountReceivedCents: number | null;
  readonly paymentIntentId: string | null;
  readonly paymentIntentStatus: string | null;
}

async function fetchReconciliationCharge(
  secretKey: string,
  connectedAccountId: string,
  path: string,
): Promise<ReconciliationCharge | null> {
  const result: unknown = await stripeV1Request(secretKey, path, {
    errorType: "connect",
    method: "GET",
    stripeAccount: connectedAccountId,
  });
  const parsed = stripeReconciliationChargeSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

function reconciliationChargePath(chargeId: string): string {
  return `/v1/charges/${encodeURIComponent(chargeId)}?expand[]=balance_transaction&expand[]=refunds`;
}

function paymentIntentChargeResult(
  paymentIntent: z.infer<typeof stripeReconciliationPaymentIntentSchema>,
  charge: ReconciliationCharge | null,
): ResolvedReconciliationCharge {
  const latestCharge = paymentIntent.latest_charge;
  return {
    amountReceivedCents:
      paymentIntent.amount_received ??
      (typeof latestCharge === "object" && latestCharge !== null
        ? (latestCharge.amount_captured ?? null)
        : (charge?.amount_captured ?? null)),
    charge: typeof latestCharge === "object" ? (latestCharge ?? null) : charge,
    fallbackAmount: paymentIntent.amount ?? 0,
    fallbackCurrency: paymentIntent.currency ?? null,
    paymentIntentId: paymentIntent.id,
    paymentIntentStatus: paymentIntent.status ?? null,
  };
}

async function fetchPaymentIntentReconciliationCharge(
  secretKey: string,
  connectedAccountId: string,
  providerPaymentId: string,
): Promise<ResolvedReconciliationCharge> {
  const intentResult: unknown = await stripeV1Request(
    secretKey,
    `/v1/payment_intents/${encodeURIComponent(providerPaymentId)}?expand[]=latest_charge.balance_transaction&expand[]=latest_charge.refunds`,
    {
      errorType: "connect",
      method: "GET",
      stripeAccount: connectedAccountId,
    },
  );
  const parsedIntent = stripeReconciliationPaymentIntentSchema.safeParse(intentResult);
  if (!parsedIntent.success) {
    return {
      amountReceivedCents: null,
      charge: null,
      fallbackAmount: 0,
      fallbackCurrency: null,
      paymentIntentId: null,
      paymentIntentStatus: null,
    };
  }
  const paymentIntent = parsedIntent.data;
  const latestCharge = paymentIntent.latest_charge;
  const charge =
    typeof latestCharge === "string"
      ? await fetchReconciliationCharge(
          secretKey,
          connectedAccountId,
          reconciliationChargePath(latestCharge),
        )
      : null;
  return paymentIntentChargeResult(paymentIntent, charge);
}

async function resolveReconciliationCharge(
  secretKey: string,
  connectedAccountId: string,
  providerPaymentId: string,
): Promise<ResolvedReconciliationCharge> {
  if (!providerPaymentId.startsWith("pi_")) {
    const charge = await fetchReconciliationCharge(
      secretKey,
      connectedAccountId,
      reconciliationChargePath(providerPaymentId),
    );
    return {
      amountReceivedCents: charge?.amount_captured ?? null,
      charge,
      fallbackAmount: 0,
      fallbackCurrency: null,
      paymentIntentId: charge?.payment_intent ?? null,
      paymentIntentStatus: null,
    };
  }
  return fetchPaymentIntentReconciliationCharge(secretKey, connectedAccountId, providerPaymentId);
}

function selectRefundCompletedAt(
  refunds: readonly {
    readonly created: number;
    readonly status?: string | undefined;
  }[],
): string | null {
  const succeeded = refunds.filter(
    (refund) => refund.status === undefined || refund.status === "succeeded",
  );
  const timingCandidates = succeeded.length > 0 ? succeeded : refunds;
  const latest =
    timingCandidates.length > 0
      ? timingCandidates.reduce((newest, current) =>
          current.created > newest.created ? current : newest,
        )
      : null;
  return latest?.created ? new Date(latest.created * 1000).toISOString() : null;
}

async function extractReconciliationFee(
  secretKey: string,
  connectedAccountId: string,
  balanceTransaction: ReconciliationCharge["balance_transaction"],
): Promise<{
  readonly processorFeeCents: number | null;
  readonly providerBalanceTransactionId: string | null;
}> {
  if (balanceTransaction && typeof balanceTransaction === "object") {
    return {
      processorFeeCents: balanceTransaction.fee,
      providerBalanceTransactionId: balanceTransaction.id,
    };
  }
  if (typeof balanceTransaction === "string") {
    const settlement = await fetchBalanceTransactionById(
      secretKey,
      connectedAccountId,
      balanceTransaction,
    );
    return {
      processorFeeCents: settlement.feeCents,
      providerBalanceTransactionId: settlement.balanceTransactionId,
    };
  }
  return { processorFeeCents: null, providerBalanceTransactionId: null };
}

export async function retrieveStripePaymentReconciliationSnapshot(
  secretKey: string,
  connectedAccountId: string,
  providerPaymentId: string,
): Promise<StripePaymentReconciliationSnapshot> {
  const {
    charge: chargeObj,
    fallbackAmount,
    fallbackCurrency,
    amountReceivedCents,
    paymentIntentId,
    paymentIntentStatus,
  } = await resolveReconciliationCharge(secretKey, connectedAccountId, providerPaymentId);

  if (!chargeObj) {
    return {
      amountChargedCents: fallbackAmount,
      amountCapturedCents: null,
      amountReceivedCents,
      amountRefundedCents: 0,
      chargeId: null,
      chargeCaptured: null,
      chargeStatus: null,
      currency: fallbackCurrency,
      fullyRefunded: false,
      processorFeeCents: null,
      providerBalanceTransactionId: null,
      providerPaymentId,
      paymentIntentId,
      paymentIntentStatus,
      refundCompletedAt: null,
    };
  }

  const refundCompletedAt = selectRefundCompletedAt(chargeObj.refunds?.data ?? []);

  const fullyRefunded = stripeChargeRefundIsComplete({
    amount: chargeObj.amount,
    amount_refunded: chargeObj.amount_refunded,
  });

  const { processorFeeCents, providerBalanceTransactionId } = await extractReconciliationFee(
    secretKey,
    connectedAccountId,
    chargeObj.balance_transaction,
  );

  return {
    amountChargedCents: chargeObj.amount,
    amountCapturedCents: chargeObj.amount_captured ?? null,
    amountReceivedCents,
    amountRefundedCents: chargeObj.amount_refunded,
    chargeId: chargeObj.id,
    chargeCaptured: chargeObj.captured ?? null,
    chargeStatus: chargeObj.status ?? null,
    currency: chargeObj.currency ?? fallbackCurrency,
    fullyRefunded,
    processorFeeCents,
    providerBalanceTransactionId,
    providerPaymentId,
    paymentIntentId,
    paymentIntentStatus,
    refundCompletedAt,
  };
}
