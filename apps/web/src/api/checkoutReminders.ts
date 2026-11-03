import { checkoutReminderSettingsResponseSchema } from "@choir/contracts";
import { requestJson } from "./client";

export function getCheckoutReminderSettings(signal?: AbortSignal) {
  return requestJson(
    "/api/organization/checkout-reminder-settings",
    checkoutReminderSettingsResponseSchema,
    { signal: signal ?? null },
  );
}
export function updateCheckoutReminderSettings(enabled: boolean) {
  return requestJson(
    "/api/organization/checkout-reminder-settings",
    checkoutReminderSettingsResponseSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
}
