import type { Context } from "hono";
import { z } from "zod";
import type { WorkerHonoEnvironment } from "../helpers";
import { validateStartupConfig } from "../../env";
import { issueWalletPass, walletApiKey, walletPassBody } from "../../payments/ticketWallet";
import { resolveOrganization } from "../../tenancy/resolveOrganization";
import { verifySignedLinkScope } from "../../security/signedLinks";
import { organizationStoreStub } from "../../organization/rpc/client";
import { readPublicTicketPurchase } from "../../organization/organizationTicketing";

const walletRequest = z.object({ token: z.string().min(1).max(4096) });

function logWalletUnavailable(details: Record<string, unknown>): void {
  console.error(JSON.stringify({ event: "ticket_wallet_unavailable", ...details }));
}

function walletErrorDetails(error: unknown): {
  readonly errorMessage: string;
  readonly errorType: string;
} {
  return {
    errorMessage: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    errorType: error instanceof Error ? error.name : typeof error,
  };
}

export async function ticketWallet(context: Context<WorkerHonoEnvironment>) {
  validateStartupConfig(context.env);
  context.header("Cache-Control", "no-store");
  const missing = () =>
    context.json(
      {
        code: "ticket_wallet_not_found",
        message: "Ticket unavailable.",
        requestId: context.get("requestId"),
      },
      404,
    );
  const unavailable = () =>
    context.json(
      {
        code: "ticket_wallet_unavailable",
        message: "Wallet is currently unavailable. Use the QR code on your receipt.",
        requestId: context.get("requestId"),
      },
      503,
    );
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!context.req.header("content-type")?.toLowerCase().startsWith("application/json"))
    return missing();
  const input = walletRequest.safeParse(await context.req.json<unknown>().catch(() => null));
  if (!resolved.ok || !input.success) return missing();
  const organizationId = resolved.value.organizationId;
  const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, input.data.token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "ticket_receipt",
  });
  if (!envelope?.resourceId) return missing();
  const key = walletApiKey(context.env);
  if (!key) {
    logWalletUnavailable({ organizationId, reason: "missing_api_key" });
    return unavailable();
  }
  const purchaseId = envelope.resourceId;
  try {
    const order = await readPublicTicketPurchase(context.env, organizationId, purchaseId);
    if (!order.scanToken) return missing();
    const stub = organizationStoreStub(context.env, organizationId);
    const claim = await stub.claimTicketWalletPass({
      organizationId,
      purchaseId,
      eventIds: [order.eventId, ...order.includedEvents.map((event) => event.id)],
    });
    if (claim.state === "ready") return context.json({ shareUrl: claim.shareUrl });
    if (claim.state !== "claimed") {
      logWalletUnavailable({ organizationId, purchaseId, reason: "claim_unavailable" });
      return unavailable();
    }
    const pass = await issueWalletPass(
      key,
      walletPassBody(order, order.scanToken, claim.organizationName, claim.details),
    );
    if ("rejected" in pass) {
      logWalletUnavailable({
        organizationId,
        providerError: pass.providerError,
        purchaseId,
        reason: "provider_rejected",
        status: pass.status,
      });
      await stub.finishTicketWalletPass({
        organizationId,
        purchaseId,
        retryAfter: Date.now() + 60000,
      });
      return unavailable();
    }
    const saved = await stub.finishTicketWalletPass({
      organizationId,
      purchaseId,
      shareUrl: pass.shareUrl,
    });
    return saved ? context.json(pass) : missing();
  } catch (error: unknown) {
    logWalletUnavailable({
      ...walletErrorDetails(error),
      organizationId,
      purchaseId,
      reason: "unexpected_error",
    });
    // The provider assigns its own serial. Never replay an ambiguous create.
    return unavailable();
  }
}
