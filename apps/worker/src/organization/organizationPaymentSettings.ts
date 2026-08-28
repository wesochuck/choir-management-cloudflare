import {
  paymentActivationSettingsSchema,
  paymentModuleIdSchema,
  type PaymentModuleId,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import { mutateOrganizationStore, readOrganizationStore, storeErrorCode } from "./rpc/repository";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class PaymentSettingsError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PaymentSettingsError";
  }
}

export async function readOrganizationPaymentActivations(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<{
  readonly activations: z.infer<typeof paymentActivationSettingsSchema>;
  readonly organizationName: string;
}> {
  const response = await readOrganizationStore(env, organizationId, "/internal/payment-settings");
  if (!response.ok) {
    throw new PaymentSettingsError(
      await storeErrorCode(response, "payment_settings_error"),
      response.status,
      "Organization payment settings are unavailable.",
    );
  }
  const value: unknown = await response.json();
  const parsed = z
    .object({
      activations: paymentActivationSettingsSchema,
      organizationName: z.string().min(1).max(120),
    })
    .safeParse(value);
  if (!parsed.success) {
    throw new PaymentSettingsError(
      "payment_settings_invalid",
      503,
      "Organization payment settings are invalid.",
    );
  }
  return parsed.data;
}

export async function updateOrganizationPaymentActivation(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  moduleId: PaymentModuleId,
  enabled: boolean,
): Promise<z.infer<typeof paymentActivationSettingsSchema>> {
  const validatedModuleId = paymentModuleIdSchema.parse(moduleId);
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/payment-settings",
    {
      action: "update_payment_activation",
      actorUserId: actor.actorUserId,
      confirm: true,
      enabled,
      moduleId: validatedModuleId,
      organizationId: actor.organizationId,
      requestId: actor.requestId,
    },
  );
  if (!response.ok) {
    throw new PaymentSettingsError(
      await storeErrorCode(response, "payment_settings_error"),
      response.status,
      "The payment activation setting could not be updated.",
    );
  }
  const value: unknown = await response.json();
  return paymentActivationSettingsSchema.parse(
    z.object({ activations: paymentActivationSettingsSchema }).parse(value).activations,
  );
}
