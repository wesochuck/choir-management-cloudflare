import { operationSchema } from "./seasonStore/contracts";
import { activateSeason, createSeason, deleteSeason, updateSeason } from "./seasonStore/lifecycle";
import {
  attachDuesSession,
  completeStripeDues,
  createDuesCheckout,
  expireStripeDues,
  markDuesCashPaid,
  refundDues,
  refundStripeDues,
} from "./seasonStore/payments";
import { identity } from "./seasonStore/shared";

export {
  listDuesFromStore,
  listSeasonsFromStore,
  readMemberActiveSeasonFromStore,
} from "./seasonStore/queries";

// eslint-disable-next-line complexity -- dispatches the typed Organization season/payment operations.
export async function manageSeasonsInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = operationSchema.safeParse(await request.json().catch(() => null));
  if (!operation.success) {
    return Response.json({ code: "invalid_season_operation" }, { status: 400 });
  }
  const organization = identity(storage);
  if (organization?.organizationId !== operation.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  switch (operation.data.action) {
    case "create_season":
      return createSeason(storage, operation.data);
    case "update_season":
      return updateSeason(storage, operation.data);
    case "activate_season":
      return activateSeason(storage, operation.data);
    case "delete_season":
      return deleteSeason(storage, operation.data);
    case "create_dues_checkout":
      return createDuesCheckout(storage, operation.data);
    case "prepare_dues_checkout":
      return createDuesCheckout(storage, operation.data);
    case "attach_dues_session":
      return attachDuesSession(storage, operation.data);
    case "refund_dues":
      return refundDues(storage, operation.data);
    case "mark_dues_cash_paid":
      return markDuesCashPaid(storage, operation.data);
    case "stripe_dues_completed":
      return completeStripeDues(storage, operation.data);
    case "stripe_dues_expired":
      return expireStripeDues(storage, operation.data);
    case "stripe_dues_refunded":
      return refundStripeDues(storage, operation.data);
  }
}
