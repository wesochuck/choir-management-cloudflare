import {
  type OrganizationProviderStatusResponse,
  organizationPaymentSettingsResponseSchema,
  paymentActivationRequestSchema,
  organizationStripeConnectOnboardingResponseSchema,
  organizationStripeConnectStatusResponseSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { configuredPlatformEmailSender } from "../communications/provider";
import { validateStartupConfig } from "../env";
import {
  createStripeAccountOnboardingLink,
  createStripeConnectedAccount,
  retrieveStripeConnectedAccount,
  stripeAccountIsReady,
  StripeConnectError,
} from "../payments/stripeConnect";
import { upsertStripeAccountOrganization } from "../payments/stripeRouting";
import {
  readOrganizationPaymentActivations,
  updateOrganizationPaymentActivation,
  PaymentSettingsError,
} from "../organization/organizationPaymentSettings";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  providerSetupChecks,
  authorizeCalendarRoute,
  stripePaymentsGlobalEnabled,
  readOrganizationStripeStatus,
} from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/provider-status", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const config = validateStartupConfig(context.env);
    const providerChecks = providerSetupChecks(context.env, config.EXTERNAL_EFFECTS_MODE);
    return context.json({
      ...providerChecks,
      emailSender: configuredPlatformEmailSender(context.env),
      environment: config.APP_ENV,
      externalEffectsMode: config.EXTERNAL_EFFECTS_MODE,
      requestId: context.get("requestId"),
    } satisfies OrganizationProviderStatusResponse);
  });

  router.get("/api/organization/payment-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const [stored, stripe] = await Promise.all([
        readOrganizationPaymentActivations(context.env, authorization.organizationId),
        readOrganizationStripeStatus(context.env, authorization.organizationId),
      ]);
      const stripeConfigured = Boolean(context.env.STRIPE_SECRET_KEY?.trim());
      const webhookConfigured = Boolean(context.env.STRIPE_WEBHOOK_SECRET?.trim());
      const brevoConfigured =
        Boolean(context.env.PLATFORM_EMAIL) &&
        z.email().safeParse(context.env.PLATFORM_EMAIL_FROM).success &&
        context.env.PLATFORM_EMAIL_MODE !== "disabled";
      return context.json(
        organizationPaymentSettingsResponseSchema.parse({
          activations: stored.activations,
          environment: context.env.APP_ENV,
          externalEffectsMode: context.env.EXTERNAL_EFFECTS_MODE,
          globalPaymentsEnabled: stripePaymentsGlobalEnabled(context.env),
          organizationName: stored.organizationName,
          readiness: {
            brevoConfigured,
            stripeAccountReady: stripe.status === "ready",
            stripeConfigured,
            webhookConfigured,
          },
          requestId: context.get("requestId"),
          stripe,
        }),
      );
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof PaymentSettingsError ? error.code : "payment_settings_unavailable",
          message: "Payment settings could not be loaded.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  // eslint-disable-next-line complexity -- this endpoint preserves typed payment-activation failure states.
  router.post("/api/organization/payment-settings/activation", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = paymentActivationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Confirm the payment activation change before saving it.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stripe = await readOrganizationStripeStatus(context.env, authorization.organizationId);
      const globalEnabled = stripePaymentsGlobalEnabled(context.env);
      const stripeReady =
        Boolean(context.env.STRIPE_SECRET_KEY?.trim()) &&
        Boolean(context.env.STRIPE_WEBHOOK_SECRET?.trim()) &&
        stripe.status === "ready";
      const brevoReady =
        Boolean(context.env.PLATFORM_EMAIL) &&
        z.email().safeParse(context.env.PLATFORM_EMAIL_FROM).success &&
        context.env.PLATFORM_EMAIL_MODE !== "disabled";
      if (body.data.enabled && (!globalEnabled || !stripeReady || !brevoReady)) {
        return context.json(
          {
            code: "payments_not_ready",
            message:
              "Finish Stripe Connect, signed webhook, and Organization email setup before enabling online payments.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      const activations = await updateOrganizationPaymentActivation(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data.moduleId,
        body.data.enabled,
      );
      return context.json({ activations, requestId: context.get("requestId") });
    } catch (error: unknown) {
      return context.json(
        {
          code:
            error instanceof PaymentSettingsError ? error.code : "payment_activation_unavailable",
          message: "The payment activation setting could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof PaymentSettingsError && (error.status === 404 || error.status === 409)
          ? error.status
          : 503,
      );
    }
  });

  // eslint-disable-next-line complexity -- this endpoint maps provider status and typed failure states.
  router.get("/api/organization/stripe-connect", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const secretKey = context.env.STRIPE_SECRET_KEY?.trim() ?? "";
    try {
      const url = new URL("https://organization.internal/internal/stripe-connect");
      url.searchParams.set("organizationId", authorization.organizationId);
      const storeResponse = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      ).fetch(url);
      const stored = z
        .object({
          accountId: z
            .string()
            .regex(/^acct_[A-Za-z0-9]+$/)
            .nullable(),
          chargesEnabled: z.boolean(),
          detailsSubmitted: z.boolean(),
          payoutsEnabled: z.boolean(),
          requirementsDue: z.array(z.string()),
          status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
        })
        .parse(await storeResponse.json());
      if (!storeResponse.ok) throw new Error("stripe_connect_store_unavailable");
      if (secretKey && stored.accountId) {
        const account = await retrieveStripeConnectedAccount(secretKey, stored.accountId);
        const syncResponse = await context.env.ORGANIZATION_STORE.get(
          context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
        ).fetch("https://organization.internal/internal/stripe-connect", {
          body: JSON.stringify({
            accountId: account.id,
            actorUserId: authorization.userId,
            chargesEnabled: account.charges_enabled,
            detailsSubmitted: account.details_submitted,
            organizationId: authorization.organizationId,
            payoutsEnabled: account.payouts_enabled,
            requestId: context.get("requestId"),
            requirementsDue: account.requirements.currently_due,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const synced = organizationStripeConnectStatusResponseSchema.shape.stripe.safeParse(
          await syncResponse.json(),
        );
        if (syncResponse.ok && synced.success) {
          await upsertStripeAccountOrganization(context.env.CONTROL_DB, {
            accountId: stored.accountId,
            organizationId: authorization.organizationId,
            status:
              synced.data.status === "ready" &&
              synced.data.chargesEnabled &&
              synced.data.payoutsEnabled
                ? "active"
                : "pending",
          });
          return context.json({
            platformConfigured: Boolean(secretKey),
            requestId: context.get("requestId"),
            stripe: synced.data,
          });
        }
      }
      return context.json({
        platformConfigured: Boolean(secretKey),
        requestId: context.get("requestId"),
        stripe: stored,
      });
    } catch (error: unknown) {
      return context.json(
        {
          code:
            error instanceof StripeConnectError
              ? "stripe_connect_unavailable"
              : "service_unavailable",
          message:
            error instanceof StripeConnectError
              ? "Stripe could not verify the Organization connected account."
              : "Stripe Connect status could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof StripeConnectError && error.status >= 400 && error.status < 500
          ? 502
          : 503,
      );
    }
  });

  // eslint-disable-next-line complexity -- this endpoint preserves onboarding authorization and provider failures.
  router.post("/api/organization/stripe-connect/onboard", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const secretKey = context.env.STRIPE_SECRET_KEY?.trim() ?? "";
    if (!secretKey) {
      return context.json(
        {
          code: "stripe_connect_not_configured",
          message: "A Platform Administrator must configure the Stripe platform key first.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    try {
      const store = context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      );
      const statusUrl = new URL("https://organization.internal/internal/stripe-connect");
      statusUrl.searchParams.set("organizationId", authorization.organizationId);
      const statusResponse = await store.fetch(statusUrl);
      const status = z
        .object({
          accountId: z
            .string()
            .regex(/^acct_[A-Za-z0-9]+$/)
            .nullable(),
        })
        .parse(await statusResponse.json());
      let account = status.accountId
        ? await retrieveStripeConnectedAccount(secretKey, status.accountId)
        : null;
      if (!account) {
        const organization = await context.env.CONTROL_DB.prepare(
          "SELECT name FROM organizations WHERE id = ? LIMIT 1",
        )
          .bind(authorization.organizationId)
          .first<{ readonly name: string }>();
        account = await createStripeConnectedAccount(
          secretKey,
          authorization.organizationId,
          organization?.name.trim() ?? authorization.organizationId,
        );
      }
      const requestId = context.get("requestId");
      const syncResponse = await store.fetch(
        "https://organization.internal/internal/stripe-connect",
        {
          body: JSON.stringify({
            accountId: account.id,
            actorUserId: authorization.userId,
            chargesEnabled: account.charges_enabled,
            detailsSubmitted: account.details_submitted,
            organizationId: authorization.organizationId,
            payoutsEnabled: account.payouts_enabled,
            requestId,
            requirementsDue: account.requirements.currently_due,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!syncResponse.ok) throw new Error("stripe_connect_store_unavailable");
      await upsertStripeAccountOrganization(context.env.CONTROL_DB, {
        accountId: account.id,
        organizationId: authorization.organizationId,
        status: stripeAccountIsReady(account) ? "active" : "pending",
      });
      if (stripeAccountIsReady(account)) {
        return context.json(
          {
            code: "stripe_connect_already_ready",
            message: "This Organization's Stripe Connect account is already ready.",
            requestId,
          } satisfies ProblemDetails,
          409,
        );
      }
      const requestUrl = new URL(context.req.url);
      const returnUrl = new URL("/admin/settings?stripe=return", requestUrl.origin).toString();
      const refreshUrl = new URL("/admin/settings?stripe=refresh", requestUrl.origin).toString();
      const onboardingUrl = await createStripeAccountOnboardingLink(
        secretKey,
        account.id,
        returnUrl,
        refreshUrl,
      );
      const response = organizationStripeConnectOnboardingResponseSchema.parse({
        accountId: account.id,
        requestId,
        status: account.charges_enabled && account.payouts_enabled ? "ready" : "onboarding",
        url: onboardingUrl,
      });
      return context.json(response);
    } catch (error: unknown) {
      return context.json(
        {
          code:
            error instanceof StripeConnectError
              ? "stripe_connect_unavailable"
              : "service_unavailable",
          message:
            error instanceof StripeConnectError
              ? "Stripe could not start Organization onboarding."
              : "Stripe Connect onboarding could not be started.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof StripeConnectError && error.status >= 400 && error.status < 500
          ? 502
          : 503,
      );
    }
  });
}
