import type { z } from "zod";

import { identity } from "./ticketingStore/readModel";
import { deactivateDiscountCode, upsertDiscountCode } from "./ticketingStore/discountCodes";
import { issueTicketScanCredential, validateTicketScan } from "./ticketingStore/scanning";
import {
  recordTicketNotificationResult,
  resendTicketConfirmation,
} from "./ticketingStore/notifications";
import { deleteTicketBundle, upsertTicketBundle } from "./ticketingStore/bundles";
import { createFakeCheckout, quoteTicketCheckout } from "./ticketingStore/checkout";
import {
  attachStripeSession,
  completeStripeTicketPurchase,
  expireStripeTicketPurchase,
  refundFakePurchase,
  refundStripeTicketPurchases,
} from "./ticketingStore/payments";
import { operationSchema } from "./ticketingStore/contracts";

export {
  listDiscountCodesFromStore,
  listTicketBundlesFromStore,
  listTicketOrdersFromStore,
  readPublicDiscountAvailabilityFromStore,
  readTicketNotificationJobFromStore,
  readTicketPurchaseByProviderSessionFromStore,
  readTicketPurchaseFromStore,
  readTicketWillCallFromStore,
} from "./ticketingStore/queries";

function dispatchStripeTicketOperation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof operationSchema>,
): Response | null {
  switch (operation.action) {
    case "stripe_ticket_completed":
      return completeStripeTicketPurchase(storage, operation);
    case "stripe_ticket_expired":
      return expireStripeTicketPurchase(storage, operation);
    case "stripe_ticket_refunded":
      return refundStripeTicketPurchases(storage, operation);
    default:
      return null;
  }
}

// eslint-disable-next-line complexity -- dispatches the typed ticket/payment operations.
export async function manageTicketingInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = operationSchema.safeParse(await request.json().catch(() => null));
  if (!operation.success) {
    return Response.json({ code: "invalid_ticketing_operation" }, { status: 400 });
  }
  const organization = identity(storage);
  if (organization?.organizationId !== operation.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const stripeOperation = dispatchStripeTicketOperation(storage, operation.data);
  if (stripeOperation) return stripeOperation;
  switch (operation.data.action) {
    case "create_fake_checkout": {
      const response = createFakeCheckout(storage, operation.data, organization);
      if (response.ok) await storage.setAlarm(Date.now() + 1);
      return response;
    }
    case "create_stripe_pending": {
      const response = createFakeCheckout(storage, operation.data, organization);
      if (response.ok) await storage.setAlarm(Date.now() + 1);
      return response;
    }
    case "quote_ticket_checkout":
      return quoteTicketCheckout(storage, operation.data, organization);
    case "attach_stripe_session":
      return attachStripeSession(storage, operation.data);
    case "issue_ticket_scan_credential":
      return issueTicketScanCredential(storage, operation.data);
    case "refund_fake_purchase":
      return refundFakePurchase(storage, operation.data);
    case "validate_ticket_scan":
      return validateTicketScan(storage, operation.data);
    case "upsert_ticket_bundle":
      return upsertTicketBundle(storage, operation.data);
    case "delete_ticket_bundle":
      return deleteTicketBundle(storage, operation.data);
    case "upsert_discount_code":
      return upsertDiscountCode(storage, operation.data);
    case "deactivate_discount_code":
      return deactivateDiscountCode(storage, operation.data);
    case "record_ticket_notification_result":
      return recordTicketNotificationResult(storage, operation.data);
    case "resend_ticket_confirmation": {
      const response = resendTicketConfirmation(storage, operation.data);
      if (response.ok) await storage.setAlarm(Date.now() + 1);
      return response;
    }
  }
  return Response.json({ code: "invalid_ticketing_operation" }, { status: 400 });
}
