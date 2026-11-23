import type { Context } from "hono";

import { readOrganizationMemberProfile } from "../../organization/profiles";
import { linkedOrganizationProfileId } from "../../tenancy/linkedOrganizationProfile";
import type { CalendarAuthorization, WorkerHonoEnvironment } from "./routeContracts";

export async function isActiveFinancialAlertRecipient(
  context: Context<WorkerHonoEnvironment>,
  authorization: Extract<CalendarAuthorization, { readonly ok: true }>,
): Promise<boolean> {
  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  if (!profileId) return false;
  const profile = await readOrganizationMemberProfile(
    context.env,
    authorization.organizationId,
    profileId,
  );
  return (
    profile.globalStatus === "Active" &&
    !profile.doNotEmail &&
    !profile.providerEmailSuppressed &&
    profile.receiveFinancialAlerts
  );
}
