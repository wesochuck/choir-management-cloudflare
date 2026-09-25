import type { ProblemDetails } from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import { evaluateEdgeRateLimit } from "../../security/edgeRateLimit";
import { verifyTurnstileToken } from "../../security/turnstile";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const preflightProblemSchema = z.object({
  code: z.string().optional(),
});

export async function preflightCheckoutRequest(
  env: Env,
  organizationId: string,
  action: "ticket_checkout" | "donation_checkout",
  checkoutRequestId: string,
  buyerEmail: string,
  clientIp: string,
  turnstileToken: string | undefined,
  requestId: string,
): Promise<Response | null> {
  const edgeLimit = await evaluateEdgeRateLimit({
    clientIp,
    env,
    limiterName: "PUBLIC_MUTATION_RATE_LIMITER",
    operation: action,
    organizationId,
    requestId,
  });
  if (edgeLimit) return edgeLimit;

  const [clientKey, emailKey] = await Promise.all([
    sha256Hex(clientIp || "unknown"),
    sha256Hex(buyerEmail.trim().toLowerCase()),
  ]);
  const hasTurnstileToken = Boolean(turnstileToken?.trim());
  const turnstileVerified = hasTurnstileToken
    ? await verifyTurnstileToken(env, turnstileToken, clientIp)
    : false;
  const preflightRes = await invokeOrganizationRpc(
    organizationStoreStub(env, organizationId),
    "https://organization.internal/internal/checkout/rate-limit",
    {
      body: JSON.stringify({
        action,
        checkoutRequestId,
        clientKey,
        emailKey,
        hasTurnstileToken,
        organizationId,
        turnstileVerified,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (preflightRes.ok) return null;

  if (preflightRes.status === 429) {
    const retryAfter = preflightRes.headers.get("retry-after");
    return new Response(
      JSON.stringify({
        code: "public_rate_limit_exceeded",
        message: "Too many checkout requests. Please try again later.",
        requestId,
      } satisfies ProblemDetails),
      {
        headers: {
          "content-type": "application/json",
          ...(retryAfter ? { "retry-after": retryAfter } : {}),
        },
        status: 429,
      },
    );
  }

  if (preflightRes.status === 403) {
    const parsed = preflightProblemSchema.safeParse(await preflightRes.json().catch(() => null));
    const code =
      parsed.success && parsed.data.code === "invalid_challenge_token"
        ? "invalid_challenge_token"
        : "challenge_required";
    return Response.json(
      {
        code,
        message:
          code === "invalid_challenge_token"
            ? "Verification challenge failed. Please try again."
            : "Verification challenge required to proceed with checkout.",
        requestId,
      } satisfies ProblemDetails,
      { status: 403 },
    );
  }

  return Response.json(
    {
      code:
        action === "ticket_checkout"
          ? "ticket_checkout_unavailable"
          : "donation_checkout_unavailable",
      message:
        action === "ticket_checkout"
          ? "Online ticket checkout is not available right now."
          : "Online donation checkout is not available right now.",
      requestId,
    } satisfies ProblemDetails,
    { status: 503 },
  );
}

export async function preflightTicketQuoteRequest(
  env: Env,
  organizationId: string,
  clientIp: string,
  requestId: string,
): Promise<Response | null> {
  const edgeLimit = await evaluateEdgeRateLimit({
    clientIp,
    env,
    limiterName: "PUBLIC_READ_RATE_LIMITER",
    operation: "ticket_quote",
    organizationId,
    requestId,
  });
  if (edgeLimit) return edgeLimit;

  const clientKey = await sha256Hex(clientIp || "unknown");
  const preflightRes = await invokeOrganizationRpc(
    organizationStoreStub(env, organizationId),
    "https://organization.internal/internal/checkout/rate-limit",
    {
      body: JSON.stringify({
        action: "ticket_quote",
        clientKey,
        organizationId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (preflightRes.ok) return null;

  if (preflightRes.status === 429) {
    const retryAfter = preflightRes.headers.get("retry-after");
    return new Response(
      JSON.stringify({
        code: "public_rate_limit_exceeded",
        message: "Too many ticket quote requests. Please try again later.",
        requestId,
      } satisfies ProblemDetails),
      {
        headers: {
          "content-type": "application/json",
          ...(retryAfter ? { "retry-after": retryAfter } : {}),
        },
        status: 429,
      },
    );
  }

  return Response.json(
    {
      code: "ticket_quote_unavailable",
      message: "The ticket price could not be calculated right now.",
      requestId,
    } satisfies ProblemDetails,
    { status: 503 },
  );
}
