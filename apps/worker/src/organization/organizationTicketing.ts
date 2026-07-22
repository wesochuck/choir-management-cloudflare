import {
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  publicTicketPurchaseSchema,
  ticketBundleRequestSchema,
  ticketBundleSchema,
  ticketBundlesResponseSchema,
  ticketScanResultSchema,
  ticketCheckoutRequestSchema,
  type OrganizationTicketOrder,
  type TicketBundle,
  type TicketBundleRequest,
  type TicketScanResult,
  type TicketCheckoutRequest,
} from "@choir/contracts";
import { renderTicketWillCallCsv, ticketWillCallFilename } from "@choir/domain";
import { z } from "zod";

import type { Env } from "../env";
import { ticketCheckoutMode } from "../payments/ticketCheckout";
import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

function purchaseEndsAt(purchase: {
  readonly eventStartsAt: string;
  readonly includedEvents: readonly { readonly startsAt: string }[];
}): number {
  return Math.max(
    new Date(purchase.eventStartsAt).getTime(),
    ...purchase.includedEvents.map(({ startsAt }) => new Date(startsAt).getTime()),
  );
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
  const eventEndsAt = Math.floor(purchaseEndsAt(purchase) / 1000) + 24 * 60 * 60;
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
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  purchaseId: string,
) {
  const url = new URL("https://organization.internal/internal/ticketing/purchase");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("purchaseId", purchaseId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new TicketingError("ticket_purchase_not_found", 404, "Ticket order not found.");
  const purchase = publicTicketPurchaseSchema.parse(await response.json());
  const issuedAt = Math.floor(Date.now() / 1000);
  const eventEndsAt = Math.floor(purchaseEndsAt(purchase) / 1000) + 24 * 60 * 60;
  const scanToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: Math.max(issuedAt + 60 * 60, eventEndsAt),
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "ticket_scan",
    resourceId: purchase.id,
    version: 1,
  });
  return { ...purchase, scanToken };
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

export async function validateOrganizationTicketScan(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  actor: ActorContext,
  eventId: string,
  token: string,
): Promise<TicketScanResult> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: actor.organizationId,
    expectedPurpose: "ticket_scan",
  });
  if (!envelope?.resourceId || !z.uuid().safeParse(envelope.resourceId).success) {
    throw new TicketingError("ticket_scan_invalid", 404, "Ticket credential not found.");
  }
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({
        action: "validate_ticket_scan",
        ...actor,
        eventId,
        purchaseId: envelope.resourceId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new TicketingError("ticket_scan_unavailable", 503, "Ticket validation is unavailable.");
  }
  return ticketScanResultSchema.parse(await response.json());
}

const willCallResponseSchema = z.object({
  eventTitle: z.string().min(1).max(500),
  rows: z.array(organizationTicketOrderSchema).max(10_000),
});

export async function readOrganizationTicketWillCallCsv(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  eventId: string,
): Promise<{ readonly content: string; readonly filename: string }> {
  const url = new URL("https://organization.internal/internal/ticketing/will-call");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("eventId", eventId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    throw new TicketingError("ticket_event_not_found", 404, "Ticketed event not found.");
  }
  const result = willCallResponseSchema.parse(await response.json());
  return {
    content: renderTicketWillCallCsv(result.rows),
    filename: ticketWillCallFilename(result.eventTitle, eventId),
  };
}

export async function listOrganizationTicketBundles(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly TicketBundle[]> {
  const url = new URL("https://organization.internal/internal/ticketing/bundles");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new TicketingError("ticket_bundles_unavailable", 503, "Ticket bundles unavailable.");
  return ticketBundlesResponseSchema.omit({ requestId: true }).parse(await response.json()).bundles;
}

export async function saveOrganizationTicketBundle(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  bundleId: string,
  bundle: TicketBundleRequest,
): Promise<TicketBundle> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({
        action: "upsert_ticket_bundle",
        ...actor,
        bundle: ticketBundleRequestSchema.parse(bundle),
        bundleId: z.uuid().parse(bundleId),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new TicketingError(
      await errorCode(response),
      response.status,
      "The ticket bundle could not be saved.",
    );
  }
  return ticketBundleSchema.parse(await response.json());
}

export async function deleteOrganizationTicketBundle(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  bundleId: string,
): Promise<void> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({ action: "delete_ticket_bundle", ...actor, bundleId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new TicketingError(
      await errorCode(response),
      response.status,
      "The ticket bundle could not be deleted.",
    );
  }
}

export async function resendOrganizationTicketConfirmation(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  purchaseId: string,
): Promise<void> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({ action: "resend_ticket_confirmation", ...actor, purchaseId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new TicketingError(
      await errorCode(response),
      response.status,
      "The ticket confirmation could not be queued.",
    );
  }
}
