import type { z } from "zod";

import { identity } from "./ticketingStore/readModel";
import {
  deactivateDiscountCode,
  reactivateDiscountCode,
  upsertDiscountCode,
} from "./ticketingStore/discountCodes";
import { issueTicketScanCredential, validateTicketScan } from "./ticketingStore/scanning";
import {
  recordTicketNotificationResult,
  resendTicketConfirmation,
} from "./ticketingStore/notifications";
import { deleteTicketBundle, upsertTicketBundle } from "./ticketingStore/bundles";
import { createFakeCheckout, quoteTicketCheckout } from "./ticketingStore/checkout";
import { wakeOrganizationAlarm } from "./scheduler";
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
  readTicketPurchaseFromStore,
  readTicketWillCallFromStore,
} from "./ticketingStore/queries";

interface StripeTicketOperationResult {
  readonly response: Response;
  readonly schedulerWorkQueued: boolean;
}

function dispatchStripeTicketOperation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof operationSchema>,
): StripeTicketOperationResult | null {
  switch (operation.action) {
    case "stripe_ticket_completed":
      return completeStripeTicketPurchase(storage, operation);
    case "stripe_ticket_expired":
      return {
        response: expireStripeTicketPurchase(storage, operation),
        schedulerWorkQueued: false,
      };
    case "stripe_ticket_refunded":
      return refundStripeTicketPurchases(storage, operation);
    default:
      return null;
  }
}

function ticketPurchaseStatus(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
): string | null {
  const row = storage.sql
    .exec<{ readonly status: string }>(
      "SELECT status FROM ticket_purchases WHERE checkout_request_id = ? LIMIT 1",
      checkoutRequestId,
    )
    .toArray()
    .at(0);
  return row?.status ?? null;
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
  if (stripeOperation) {
    if (stripeOperation.response.ok && stripeOperation.schedulerWorkQueued) {
      await wakeOrganizationAlarm(storage);
    }
    return stripeOperation.response;
  }
  switch (operation.data.action) {
    case "create_fake_checkout": {
      const response = createFakeCheckout(storage, operation.data, organization);
      // Only a newly created paid checkout enqueues scheduler work. Idempotent
      // replays (200) and failures must not arm the alarm.
      if (response.ok && response.status === 201) {
        await wakeOrganizationAlarm(storage);
      }
      return response;
    }
    case "create_stripe_pending": {
      const response = createFakeCheckout(storage, operation.data, organization);
      // Pending Stripe checkouts enqueue no outbox row. Wake only when the
      // new checkout is paid (for example a free total), never for pending or
      // idempotent replays.
      if (response.ok && response.status === 201) {
        const status = ticketPurchaseStatus(storage, operation.data.checkout.checkoutRequestId);
        if (status !== null && status !== "pending") {
          await wakeOrganizationAlarm(storage);
        }
      }
      return response;
    }
    case "quote_ticket_checkout":
      return quoteTicketCheckout(storage, operation.data, organization);
    case "attach_stripe_session":
      return attachStripeSession(storage, operation.data);
    case "issue_ticket_scan_credential":
      return issueTicketScanCredential(storage, operation.data);
    case "refund_fake_purchase": {
      const refund = refundFakePurchase(storage, operation.data);
      if (refund.response.ok && refund.schedulerWorkQueued) {
        await wakeOrganizationAlarm(storage);
      }
      return refund.response;
    }
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
    case "reactivate_discount_code":
      return reactivateDiscountCode(storage, operation.data);
    case "record_ticket_notification_result":
      return recordTicketNotificationResult(storage, operation.data);
    case "resend_ticket_confirmation": {
      const response = resendTicketConfirmation(storage, operation.data);
      if (response.ok) await wakeOrganizationAlarm(storage);
      return response;
    }
  }
  return Response.json({ code: "invalid_ticketing_operation" }, { status: 400 });
}
