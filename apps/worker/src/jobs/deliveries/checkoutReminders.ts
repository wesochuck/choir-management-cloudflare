import type { CheckoutRecoveryChoices } from "@choir/contracts";
import { composeCheckoutReminderActions, renderCommunicationTemplate } from "@choir/domain";
import { deliverOrganizationCommunication } from "../../communications/provider";
import { isEmailProviderSuppressed } from "../../communications/emailFeedback";
import { organizationStoreStub } from "../../organization/rpc/client";
import { issueSignedLink } from "../../security/signedLinks";
import type { DeliveryJob } from "../contracts";
import {
  deliveryOrigin,
  readOrganizationBrandingConfig,
  readOrganizationEmailSenderConfig,
  type JobConsumerEnv,
} from "./shared";

export async function deliverCheckoutReminder(env: JobConsumerEnv, job: DeliveryJob) {
  const stub = organizationStoreStub(env, job.organizationId);
  const scope = { organizationId: job.organizationId, id: job.jobId };
  const destination = await stub.checkoutReminderDestination(scope);
  if (!destination) return;
  if (!env.CONTROL_DB)
    throw new Error("Checkout reminder suppression checks require control-plane access.");
  const suppressed = await isEmailProviderSuppressed(env.CONTROL_DB, destination);
  const memberships = await env.CONTROL_DB.prepare(
    `SELECT m.profileId FROM member m JOIN user u ON u.id = m.userId WHERE m.organizationId = ? AND u.email = ? AND m.profileId IS NOT NULL LIMIT 501`,
  )
    .bind(job.organizationId, destination)
    .all<{ profileId: string }>();
  if (memberships.results.length > 500)
    throw new Error("Checkout reminder profile lookup exceeded its bound.");

  const [origin, branding, sender] = await Promise.all([
    deliveryOrigin(env, job.organizationId, { unsubscribeUrl: null }),
    readOrganizationBrandingConfig(env, job.organizationId),
    readOrganizationEmailSenderConfig(env, job.organizationId),
  ]);
  const delivery = await stub.claimCheckoutReminder({
    ...scope,
    externallySuppressed: suppressed,
    profileIds: memberships.results.map((member) => member.profileId),
  });
  if (!delivery) {
    await reconcileAcceptedCheckoutReminder(env.CONTROL_DB, stub, scope);
    return;
  }
  try {
    const recoveryToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      version: 1,
      purpose: "checkout_recovery",
      organizationId: job.organizationId,
      issuedAt: delivery.issuedAt,
      expiresAt: delivery.expiresAt,
      resourceId: delivery.id,
      nonce: delivery.nonce,
    });
    const stopToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      version: 1,
      purpose: "checkout_reminder_unsubscribe",
      organizationId: job.organizationId,
      issuedAt: delivery.issuedAt,
      expiresAt: delivery.issuedAt + 365 * 24 * 60 * 60,
      subjectId: delivery.recipientId,
    });
    const returnUrl = `${origin}/checkout/return?token=${encodeURIComponent(recoveryToken)}`;
    const stopUrl = `${origin}/checkout/reminders/stop?token=${encodeURIComponent(stopToken)}`;
    const values = {
      ...reminderValues(delivery.choices, branding.organizationName, returnUrl),
      donationLevel: delivery.donationLevel,
      eventTitle: delivery.eventTitles.join(", "),
      eventDate: delivery.eventStartsAt
        .map((instant) =>
          new Intl.DateTimeFormat("en-US", {
            timeZone: delivery.timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(instant)),
        )
        .join(", "),
    };
    const body = renderCommunicationTemplate(
      delivery.contentMarkdown,
      delivery.recipientName,
      values,
    );
    const stillEligible = await stub.confirmCheckoutReminderSend({
      ...scope,
      externallySuppressed: await isEmailProviderSuppressed(env.CONTROL_DB, destination),
      profileIds: memberships.results.map((member) => member.profileId),
    });
    if (!stillEligible) return;
    const result = await deliverOrganizationCommunication(env, {
      channel: "email",
      contentMarkdown: composeCheckoutReminderActions(body, returnUrl, stopUrl),
      deliveryId: delivery.id,
      messageId: delivery.id,
      destination,
      organizationId: job.organizationId,
      organizationName: branding.organizationName || undefined,
      organizationLogoUrl: branding.logoFileId ? `${origin}/api/public/logo` : null,
      physicalAddress: branding.physicalAddress,
      fromName: sender.fromName ?? undefined,
      replyTo: sender.replyTo ?? undefined,
      sendingDomain: sender.sendingDomain ?? undefined,
      recipientName: delivery.recipientName,
      sourceId: delivery.id,
      sourceKind: "checkout_reminder",
      subject: renderCommunicationTemplate(delivery.subject, delivery.recipientName, values),
      unsubscribeUrl: stopUrl,
    });
    await stub.recordCheckoutReminderResult({
      ...scope,
      state: result.status === "suppressed" ? "skipped" : result.status,
      reason: result.status === "sent" ? null : result.failureDetail,
      providerMessageId: result.providerMessageId,
    });
  } catch (error: unknown) {
    // Once a delivery is claimed, an unknown provider result must never start another send.
    await stub.recordCheckoutReminderResult({
      ...scope,
      state: "failed",
      reason: "delivery_outcome_unknown",
      providerMessageId: null,
    });
    throw error;
  }
}

function reminderValues(
  choices: CheckoutRecoveryChoices,
  organizationName: string,
  returnUrl: string,
) {
  return {
    organizationName: organizationName || "the choir",
    checkoutSummary:
      choices.kind === "donation"
        ? `Donation: $${((choices.amountCents ?? 0) / 100).toFixed(2)}`
        : `${String(choices.quantity ?? 1)} ticket(s)`,
    returnUrl,
    donationAmount: `$${((choices.amountCents ?? 0) / 100).toFixed(2)}`,
    donationLevel: choices.levelId ?? "",
    eventDate: "",
    eventTitle: "Your selected performance",
  };
}

async function reconcileAcceptedCheckoutReminder(
  database: D1Database,
  stub: ReturnType<typeof organizationStoreStub>,
  scope: { id: string; organizationId: string },
) {
  const accepted = await database
    .prepare(
      "SELECT provider_message_id AS providerMessageId FROM email_provider_routes WHERE provider = 'cloudflare_email' AND source_kind = 'checkout_reminder' AND source_id = ? AND organization_id = ? AND state = 'accepted' LIMIT 1",
    )
    .bind(scope.id, scope.organizationId)
    .first<{ providerMessageId: string | null }>();
  if (accepted?.providerMessageId)
    await stub.recordCheckoutReminderResult({
      ...scope,
      state: "sent",
      reason: null,
      providerMessageId: accepted.providerMessageId,
    });
}
