import { z } from "zod";

export const STRIPE_V2_VERSION = "2026-08-26.dahlia";

export const stripeV2AccountSchema = z.object({
  applied_configurations: z.array(z.string()).default([]),
  configuration: z
    .object({
      merchant: z
        .object({
          capabilities: z
            .object({
              card_payments: z
                .object({
                  status: z.string().default("inactive"),
                })
                .default({ status: "inactive" }),
              stripe_balance: z
                .object({
                  payouts: z
                    .object({
                      status: z.string().default("inactive"),
                    })
                    .default({ status: "inactive" }),
                })
                .optional(),
            })
            .default({ card_payments: { status: "inactive" } }),
        })
        .optional(),
    })
    .default({}),
  dashboard: z.enum(["full", "express", "none"]).default("full"),
  defaults: z
    .object({
      responsibilities: z
        .object({
          fees_collector: z.string().default("stripe"),
          losses_collector: z.string().default("stripe"),
          requirements_collector: z.string().default("stripe"),
        })
        .default({
          fees_collector: "stripe",
          losses_collector: "stripe",
          requirements_collector: "stripe",
        }),
    })
    .default({
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
        requirements_collector: "stripe",
      },
    }),
  id: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  livemode: z.boolean().default(false),
  metadata: z.record(z.string(), z.string()).default({}),
  object: z.literal("v2.core.account"),
  requirements: z
    .object({
      currently_due: z.array(z.string()).default([]),
      eventually_due: z.array(z.string()).default([]),
      past_due: z.array(z.string()).default([]),
    })
    .default({
      currently_due: [],
      eventually_due: [],
      past_due: [],
    }),
});

export type StripeV2Account = z.infer<typeof stripeV2AccountSchema>;

const stripeV2AccountLinkSchema = z.object({
  object: z.literal("v2.core.account_link").optional(),
  url: z.url(),
});

const stripeCheckoutSessionSchema = z.object({
  id: z.string().regex(/^cs_[A-Za-z0-9_]+$/),
  url: z.url(),
});

export class StripeConnectError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly requestLogUrl: string | undefined;
  readonly safeMessage: string;

  constructor(
    message: string,
    status = 503,
    options?: {
      readonly code?: string | undefined;
      readonly requestId?: string | undefined;
      readonly requestLogUrl?: string | undefined;
    },
  ) {
    super(message);
    this.name = "StripeConnectError";
    this.status = status;
    this.code =
      options?.code ?? (status >= 500 ? "stripe_connect_unavailable" : "stripe_connect_error");
    this.requestId = options?.requestId;
    this.requestLogUrl = options?.requestLogUrl;
    this.safeMessage = message;
  }
}

export class StripeCheckoutError extends Error {
  readonly status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "StripeCheckoutError";
    this.status = status;
  }
}

export interface StripeAccountReadiness {
  readonly cardPaymentsStatus: string;
  readonly chargesEnabled: boolean;
  readonly configurationValid: boolean;
  readonly dashboardType: string;
  readonly detailsSubmitted: boolean;
  readonly feesCollector: string;
  readonly lossesCollector: string;
  readonly payoutsEnabled: boolean;
  readonly payoutsStatus: string;
  readonly ready: boolean;
  readonly requirementsDue: string[];
  readonly status: "not_started" | "onboarding" | "restricted" | "ready";
}

function isResponsibilitiesValid(account: StripeV2Account): boolean {
  const responsibilities = account.defaults.responsibilities;
  const reqCollector = responsibilities.requirements_collector;
  return (
    account.dashboard === "full" &&
    responsibilities.fees_collector === "stripe" &&
    responsibilities.losses_collector === "stripe" &&
    (reqCollector === "stripe" || !reqCollector)
  );
}

function resolveReadinessStatus(
  validConfig: boolean,
  cardPaymentsStatus: string,
  payoutsStatus: string,
  hasPastDue: boolean,
  hasCurrentlyDue: boolean,
): "not_started" | "onboarding" | "restricted" | "ready" {
  if (
    !validConfig ||
    cardPaymentsStatus === "restricted" ||
    payoutsStatus === "restricted" ||
    hasPastDue
  ) {
    return "restricted";
  }
  if (cardPaymentsStatus === "active" && payoutsStatus === "active" && !hasCurrentlyDue) {
    return "ready";
  }
  return "onboarding";
}

export function mapStripeAccountReadiness(
  account: StripeV2Account | null | undefined,
): StripeAccountReadiness {
  if (!account?.id) {
    return {
      cardPaymentsStatus: "inactive",
      chargesEnabled: false,
      configurationValid: true,
      dashboardType: "full",
      detailsSubmitted: false,
      feesCollector: "stripe",
      lossesCollector: "stripe",
      payoutsEnabled: false,
      payoutsStatus: "inactive",
      ready: false,
      requirementsDue: [],
      status: "not_started",
    };
  }

  const responsibilities = account.defaults.responsibilities;
  const configurationValid = isResponsibilitiesValid(account);
  const cardPaymentsStatus =
    account.configuration.merchant?.capabilities.card_payments.status ?? "inactive";
  const payoutsStatus =
    account.configuration.merchant?.capabilities.stripe_balance?.payouts.status ??
    (cardPaymentsStatus === "active" ? "active" : "inactive");
  const currentlyDue = account.requirements.currently_due;
  const pastDue = account.requirements.past_due;

  const chargesEnabled = cardPaymentsStatus === "active";
  const payoutsEnabled = payoutsStatus === "active";
  const detailsSubmitted = cardPaymentsStatus !== "inactive" || currentlyDue.length > 0;

  const status = resolveReadinessStatus(
    configurationValid,
    cardPaymentsStatus,
    payoutsStatus,
    pastDue.length > 0,
    currentlyDue.length > 0,
  );

  return {
    cardPaymentsStatus,
    chargesEnabled,
    configurationValid,
    dashboardType: account.dashboard,
    detailsSubmitted,
    feesCollector: responsibilities.fees_collector,
    lossesCollector: responsibilities.losses_collector,
    payoutsEnabled,
    payoutsStatus,
    ready: status === "ready",
    requirementsDue: currentlyDue,
    status,
  };
}

export interface StripeReadinessCandidate {
  readonly charges_enabled?: boolean;
  readonly payouts_enabled?: boolean;
  readonly requirements?: { readonly currently_due?: readonly string[] };
  readonly chargesEnabled?: boolean;
  readonly payoutsEnabled?: boolean;
  readonly requirementsDue?: readonly string[];
  readonly status?: string;
  readonly ready?: boolean;
  readonly object?: string;
}

function isStripeV2Candidate(candidate: StripeReadinessCandidate): candidate is StripeV2Account {
  return candidate.object === "v2.core.account";
}

export function stripeAccountIsReady(account: StripeReadinessCandidate): boolean {
  if (typeof account.ready === "boolean") {
    return account.ready;
  }
  if (isStripeV2Candidate(account)) {
    return mapStripeAccountReadiness(account).status === "ready";
  }
  if (typeof account.status === "string") {
    return account.status === "ready";
  }
  const charges = Boolean(account.chargesEnabled ?? account.charges_enabled);
  const payouts = Boolean(account.payoutsEnabled ?? account.payouts_enabled);
  const due = account.requirementsDue ?? account.requirements?.currently_due ?? [];
  return charges && payouts && due.length === 0;
}

export function stripeConnectSetupUrl(origin: string, result: "refresh" | "return"): string {
  if (result === "refresh") {
    return new URL("/api/organization/stripe-connect/refresh", origin).toString();
  }
  const url = new URL("/admin/settings/setup-checklist", origin);
  url.searchParams.set("stripe", result);
  url.hash = "provider-status-title";
  return url.toString();
}

function stripeMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return "Stripe Connect could not complete the request.";
  }
  const error = body.error;
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "Stripe Connect could not complete the request.";
}

function parseStripeErrorPayload(
  response: Response,
  body: unknown,
): {
  readonly code: string | undefined;
  readonly message: string;
  readonly requestId: string | undefined;
  readonly requestLogUrl: string | undefined;
} {
  let errorObj: Record<string, unknown> | null = null;
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- safe narrowing of error payload
    errorObj = body.error as Record<string, unknown>;
  }
  const code = typeof errorObj?.code === "string" ? errorObj.code : undefined;
  const message = typeof errorObj?.message === "string" ? errorObj.message : stripeMessage(body);
  const requestId =
    response.headers.get("request-id") ??
    (typeof errorObj?.request_id === "string" ? errorObj.request_id : undefined);
  const requestLogUrl =
    typeof errorObj?.request_log_url === "string" ? errorObj.request_log_url : undefined;
  return { code, message, requestId, requestLogUrl };
}

export async function stripeV1Request(
  secretKey: string,
  path: string,
  init: {
    readonly body?: URLSearchParams;
    readonly method: "GET" | "POST";
    readonly idempotencyKey?: string;
    readonly stripeAccount?: string;
    readonly errorType?: "checkout" | "connect";
  },
): Promise<unknown> {
  const headers = new Headers({ authorization: `Bearer ${secretKey}` });
  if (init.body) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  if (init.stripeAccount) headers.set("stripe-account", init.stripeAccount);
  const requestInit: RequestInit = { headers, method: init.method };
  if (init.body) requestInit.body = init.body;
  const response = await fetch(`https://api.stripe.com${path}`, requestInit);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const { code, message, requestId, requestLogUrl } = parseStripeErrorPayload(response, body);
    if (init.errorType === "checkout") {
      throw new StripeCheckoutError(message, response.status);
    }
    throw new StripeConnectError(message, response.status, {
      code,
      requestId,
      requestLogUrl,
    });
  }
  return body;
}

export async function stripeV2Request(
  secretKey: string,
  path: string,
  init: {
    readonly body?: unknown;
    readonly method: "GET" | "POST";
    readonly idempotencyKey?: string;
  },
): Promise<unknown> {
  const headers = new Headers({
    authorization: `Bearer ${secretKey}`,
    "stripe-version": STRIPE_V2_VERSION,
  });
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const requestInit: RequestInit = { headers, method: init.method };
  if (init.body !== undefined) {
    requestInit.body = JSON.stringify(init.body);
  }
  const response = await fetch(`https://api.stripe.com${path}`, requestInit);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const { code, message, requestId, requestLogUrl } = parseStripeErrorPayload(response, body);
    throw new StripeConnectError(message, response.status, {
      code,
      requestId,
      requestLogUrl,
    });
  }
  return body;
}

export interface StripeCheckoutSessionInput {
  readonly cancelUrl: string;
  readonly currency: "usd";
  readonly metadata: Readonly<Record<string, string>>;
  readonly organizationName: string;
  readonly productName?: string;
  readonly quantity?: number;
  readonly successUrl: string;
  readonly unitAmountCents?: number;
  readonly lineItems?: readonly {
    readonly productName: string;
    readonly productDescription?: string;
    readonly quantity: number;
    readonly unitAmountCents: number;
  }[];
  readonly customerEmail?: string;
}

export async function createStripeCheckoutSession(
  secretKey: string,
  connectedAccountId: string,
  input: StripeCheckoutSessionInput,
): Promise<{ readonly id: string; readonly url: string }> {
  const lineItems = input.lineItems ?? [
    {
      productName: input.productName ?? "Organization payment",
      quantity: input.quantity ?? 1,
      unitAmountCents: input.unitAmountCents ?? 0,
    },
  ];
  const body = new URLSearchParams({
    cancel_url: input.cancelUrl,
    mode: "payment",
    success_url: input.successUrl,
  });
  lineItems.forEach((lineItem, index) => {
    body.set(`line_items[${String(index)}][price_data][currency]`, input.currency);
    body.set(`line_items[${String(index)}][price_data][product_data][name]`, lineItem.productName);
    body.set(
      `line_items[${String(index)}][price_data][product_data][description]`,
      lineItem.productDescription ?? `Payment to ${input.organizationName}`,
    );
    body.set(
      `line_items[${String(index)}][price_data][unit_amount]`,
      String(lineItem.unitAmountCents),
    );
    body.set(`line_items[${String(index)}][quantity]`, String(lineItem.quantity));
  });
  if (input.customerEmail) body.set("customer_email", input.customerEmail);
  body.set("expires_at", String(Math.floor(Date.now() / 1000) + 1800));
  for (const [key, value] of Object.entries(input.metadata)) {
    body.set(`metadata[${key}]`, value);
    body.set(`payment_intent_data[metadata][${key}]`, value);
  }
  return stripeCheckoutSessionSchema.parse(
    await stripeV1Request(secretKey, "/v1/checkout/sessions", {
      body,
      errorType: "checkout",
      idempotencyKey: `payment-checkout-${input.metadata.checkout_request_id ?? crypto.randomUUID()}`,
      method: "POST",
      stripeAccount: connectedAccountId,
    }),
  );
}

export async function retrieveStripeCheckoutSession(
  secretKey: string,
  connectedAccountId: string,
  sessionId: string,
): Promise<{ readonly id: string; readonly url: string }> {
  return stripeCheckoutSessionSchema.parse(
    await stripeV1Request(secretKey, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      errorType: "checkout",
      method: "GET",
      stripeAccount: connectedAccountId,
    }),
  );
}

export async function createStripeRefund(
  secretKey: string,
  connectedAccountId: string,
  providerPaymentId: string,
  idempotencyKey: string,
): Promise<{ readonly id: string; readonly status: string }> {
  const body = new URLSearchParams({ payment_intent: providerPaymentId });
  const result: unknown = await stripeV1Request(secretKey, "/v1/refunds", {
    body,
    errorType: "connect",
    idempotencyKey,
    method: "POST",
    stripeAccount: connectedAccountId,
  });
  const parsed = z
    .object({ id: z.string().min(1).max(256), status: z.string().min(1).max(64) })
    .parse(result);
  return parsed;
}

export async function createStripeConnectedAccount(
  secretKey: string,
  organizationId: string,
  organizationName: string,
  country = "US",
): Promise<StripeV2Account> {
  const body = {
    configuration: {
      merchant: {
        capabilities: {
          card_payments: {
            requested: true,
          },
        },
      },
    },
    dashboard: "full",
    defaults: {
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
      },
    },
    display_name: organizationName,
    identity: {
      country,
    },
    include: ["configuration.merchant", "defaults", "requirements"],
    metadata: {
      organization_id: organizationId,
    },
  };

  const response = await stripeV2Request(secretKey, "/v2/core/accounts", {
    body,
    idempotencyKey: `organization-${organizationId}`,
    method: "POST",
  });
  return stripeV2AccountSchema.parse(response);
}

export async function retrieveStripeConnectedAccount(
  secretKey: string,
  accountId: string,
): Promise<StripeV2Account> {
  const query = new URLSearchParams([
    ["include[0]", "configuration.merchant"],
    ["include[1]", "defaults"],
    ["include[2]", "requirements"],
  ]);
  const response = await stripeV2Request(
    secretKey,
    `/v2/core/accounts/${encodeURIComponent(accountId)}?${query.toString()}`,
    { method: "GET" },
  );
  return stripeV2AccountSchema.parse(response);
}

export async function createStripeAccountOnboardingLink(
  secretKey: string,
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const body = {
    account: accountId,
    use_case: {
      account_onboarding: {
        collection_options: {
          fields: "eventually_due",
        },
        configurations: ["merchant"],
        refresh_url: refreshUrl,
        return_url: returnUrl,
      },
      type: "account_onboarding",
    },
  };

  const response = await stripeV2Request(secretKey, "/v2/core/account_links", {
    body,
    method: "POST",
  });
  const parsed = stripeV2AccountLinkSchema.safeParse(response);
  if (!parsed.success) {
    throw new StripeConnectError("Stripe did not return a valid onboarding link.");
  }
  return parsed.data.url;
}
