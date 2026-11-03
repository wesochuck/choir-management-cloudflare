import type { Hono } from "hono";
import { checkoutReminderTokenRequestSchema } from "@choir/contracts";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { verifySignedLinkScope } from "../security/signedLinks";
import { organizationStoreStub } from "../organization/rpc/client";
import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>) {
  router.get("/api/public/checkout-reminders/recovery", async (context) => {
    context.header("Cache-Control", "no-store");
    context.header("Referrer-Policy", "no-referrer");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const parsed = checkoutReminderTokenRequestSchema.safeParse(context.req.query());
    if (!resolved.ok || !parsed.success) return context.json({ code: "recovery_unavailable" }, 404);
    const token = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, parsed.data.token, {
      expectedOrganizationId: resolved.value.organizationId,
      expectedPurpose: "checkout_recovery",
    });
    if (!token?.resourceId || !token.nonce)
      return context.json({ code: "recovery_unavailable" }, 404);
    const choices = await organizationStoreStub(
      context.env,
      resolved.value.organizationId,
    ).readCheckoutRecoveryChoices({
      organizationId: resolved.value.organizationId,
      reminderId: token.resourceId,
      nonce: token.nonce,
      now: new Date().toISOString(),
    });
    return choices ? context.json(choices) : context.json({ code: "recovery_unavailable" }, 404);
  });
  router.post("/api/public/checkout-reminders/stop", async (context) => {
    context.header("Cache-Control", "no-store");
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    const parsed = checkoutReminderTokenRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!resolved.ok || !parsed.success)
      return context.json({ code: "reminder_preference_unavailable" }, 404);
    const token = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, parsed.data.token, {
      expectedOrganizationId: resolved.value.organizationId,
      expectedPurpose: "checkout_reminder_unsubscribe",
    });
    if (!token?.subjectId) return context.json({ code: "reminder_preference_unavailable" }, 404);
    const result = await organizationStoreStub(
      context.env,
      resolved.value.organizationId,
    ).stopCheckoutReminders({
      organizationId: resolved.value.organizationId,
      recipientId: token.subjectId,
      requestId: context.get("requestId"),
    });
    return result.stopped
      ? context.json({ success: true })
      : context.json({ code: "reminder_preference_unavailable" }, 404);
  });
}
