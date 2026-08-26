import { identity } from "./queries";
import { createDonationCheckout } from "./checkout";
import { createManualDonation } from "./manual";
import { refundDonation, updateDonationThankYou } from "./mutations";
import {
  attachStripeDonationSession,
  completeStripeDonation,
  expireStripeDonation,
  refundStripeDonation,
} from "./stripeLifecycle";
import { operationSchema } from "./types";

export * from "./types";
export * from "./queries";
export * from "./patrons";
export * from "./checkout";
export * from "./manual";
export * from "./stripeLifecycle";
export * from "./mutations";

export async function manageDonationsInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = operationSchema.safeParse(await request.json().catch(() => null));
  if (!operation.success)
    return Response.json({ code: "invalid_donation_operation" }, { status: 400 });
  const organization = identity(storage);
  if (organization?.organizationId !== operation.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  switch (operation.data.action) {
    case "create_donation_checkout":
      return createDonationCheckout(storage, operation.data);
    case "create_stripe_pending_donation":
      return createDonationCheckout(storage, operation.data);
    case "create_manual_donation":
      return createManualDonation(storage, operation.data);
    case "update_donation_thank_you":
      return updateDonationThankYou(storage, operation.data);
    case "attach_stripe_donation_session":
      return attachStripeDonationSession(storage, operation.data);
    case "refund_donation":
      return refundDonation(storage, operation.data);
    case "stripe_donation_completed":
      return completeStripeDonation(storage, operation.data);
    case "stripe_donation_expired":
      return expireStripeDonation(storage, operation.data);
    case "stripe_donation_refunded":
      return refundStripeDonation(storage, operation.data);
  }
}
