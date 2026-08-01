import {
  organizationPaymentSettingsResponseSchema,
  paymentActivationSettingsSchema,
  paymentModuleIdSchema,
  type OrganizationPaymentSettingsResponse,
  type PaymentModuleId,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

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
    : "payment_settings_error";
}

export async function readOrganizationPaymentActivations(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<{
  readonly activations: z.infer<typeof paymentActivationSettingsSchema>;
  readonly organizationName: string;
}> {
  const url = new URL("https://organization.internal/internal/payment-settings");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    throw new PaymentSettingsError(
      await errorCode(response),
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
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/payment-settings",
    {
      body: JSON.stringify({
        action: "update_payment_activation",
        actorUserId: actor.actorUserId,
        confirm: true,
        enabled,
        moduleId: validatedModuleId,
        organizationId: actor.organizationId,
        requestId: actor.requestId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new PaymentSettingsError(
      await errorCode(response),
      response.status,
      "The payment activation setting could not be updated.",
    );
  }
  const value: unknown = await response.json();
  return paymentActivationSettingsSchema.parse(
    z.object({ activations: paymentActivationSettingsSchema }).parse(value).activations,
  );
}

export function paymentSettingsResponse(
  input: Omit<OrganizationPaymentSettingsResponse, "requestId"> & { readonly requestId: string },
): OrganizationPaymentSettingsResponse {
  return organizationPaymentSettingsResponseSchema.parse(input);
}
