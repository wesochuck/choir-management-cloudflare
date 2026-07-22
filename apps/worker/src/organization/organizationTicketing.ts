import {
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  publicTicketPurchaseSchema,
  ticketCheckoutRequestSchema,
  type OrganizationTicketOrder,
  type TicketCheckoutRequest,
} from "@choir/contracts";

import type { Env } from "../env";
import { ticketCheckoutMode } from "../payments/ticketCheckout";
import { issueSignedLink } from "../security/signedLinks";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class TicketingError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TicketingError";
  }
}

function stub(env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function errorCode(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : "ticketing_error";
}

export async function createPublicTicketCheckout(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  origin: string,
  checkout: TicketCheckoutRequest,
) {
  const validated = ticketCheckoutRequestSchema.parse(checkout);
  const checkoutMode = ticketCheckoutMode(env);
  const purchaseId = crypto.randomUUID();
  const providerSessionId = `fake_session_${crypto.randomUUID()}`;
  const response = await stub(env, organizationId).fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({
        action: "create_fake_checkout",
        checkout: validated,
        organizationId,
        providerSessionId,
        purchaseId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new TicketingError(code, response.status, "The ticket order could not be completed.");
  }
  const purchase = organizationTicketOrderSchema.parse(await response.json());
  const issuedAt = Math.floor(Date.now() / 1000);
  const eventEndsAt = Math.floor(new Date(purchase.eventStartsAt).getTime() / 1000) + 24 * 60 * 60;
  const successToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: Math.max(issuedAt + 7 * 24 * 60 * 60, eventEndsAt),
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "ticket_receipt",
    resourceId: purchase.id,
    version: 1,
  });
  const url = new URL("/tickets/order/success", origin);
  url.searchParams.set("token", successToken);
  return {
    checkoutMode,
    purchase: publicTicketPurchaseSchema.parse(purchase),
    successToken,
    url: url.href,
  };
}

export async function readPublicTicketPurchase(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  purchaseId: string,
) {
  const url = new URL("https://organization.internal/internal/ticketing/purchase");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("purchaseId", purchaseId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new TicketingError("ticket_purchase_not_found", 404, "Ticket order not found.");
  return publicTicketPurchaseSchema.parse(await response.json());
}

export async function listOrganizationTicketOrders(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly OrganizationTicketOrder[]> {
  const url = new URL("https://organization.internal/internal/ticketing/orders");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new TicketingError("ticket_orders_unavailable", 503, "Ticket orders unavailable.");
  return organizationTicketOrdersResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).orders;
}

export async function refundFakeTicketPurchase(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE">,
  actor: ActorContext,
  purchaseId: string,
): Promise<OrganizationTicketOrder> {
  ticketCheckoutMode(env);
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({
        action: "refund_fake_purchase",
        ...actor,
        purchaseId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new TicketingError(code, response.status, "The ticket order could not be refunded.");
  }
  return organizationTicketOrderSchema.parse(await response.json());
}
