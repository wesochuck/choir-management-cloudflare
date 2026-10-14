export const STRIPE_V2_VERSION = "2026-08-26.dahlia";

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
  readonly code: string;

  constructor(message: string, status = 503, code = "stripe_checkout_unavailable") {
    super(message);
    this.name = "StripeCheckoutError";
    this.status = status;
    this.code = code;
  }
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
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return "Stripe Connect could not complete the request.";
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
    typeof (body as { readonly error?: unknown }).error === "object" &&
    (body as { readonly error?: unknown }).error !== null
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- safe narrowing of error payload
    errorObj = (body as { readonly error: unknown }).error as Record<string, unknown>;
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
