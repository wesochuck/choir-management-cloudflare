import { z } from "zod";

export const stripeV2AccountSchema = z.object({
  applied_configurations: z.array(z.string()).default([]),
  configuration: z
    .object({
      merchant: z
        .object({
          capabilities: z
            .object({
              card_payments: z
                .object({
                  status: z.string().default("inactive"),
                })
                .default({ status: "inactive" }),
              stripe_balance: z
                .object({
                  payouts: z
                    .object({
                      status: z.string().default("inactive"),
                    })
                    .default({ status: "inactive" }),
                })
                .optional(),
            })
            .default({ card_payments: { status: "inactive" } }),
        })
        .optional(),
    })
    .default({}),
  dashboard: z.enum(["full", "express", "none"]).default("full"),
  defaults: z
    .object({
      responsibilities: z
        .object({
          fees_collector: z.string().default("stripe"),
          losses_collector: z.string().default("stripe"),
          requirements_collector: z.string().default("stripe"),
        })
        .default({
          fees_collector: "stripe",
          losses_collector: "stripe",
          requirements_collector: "stripe",
        }),
    })
    .default({
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
        requirements_collector: "stripe",
      },
    }),
  id: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  livemode: z.boolean().default(false),
  metadata: z.record(z.string(), z.string()).default({}),
  object: z.literal("v2.core.account"),
  requirements: z
    .object({
      currently_due: z.array(z.string()).default([]),
      eventually_due: z.array(z.string()).default([]),
      past_due: z.array(z.string()).default([]),
    })
    .default({
      currently_due: [],
      eventually_due: [],
      past_due: [],
    }),
});

export type StripeV2Account = z.infer<typeof stripeV2AccountSchema>;

export interface StripeAccountReadiness {
  readonly cardPaymentsStatus: string;
  readonly chargesEnabled: boolean;
  readonly configurationValid: boolean;
  readonly dashboardType: string;
  readonly detailsSubmitted: boolean;
  readonly feesCollector: string;
  readonly lossesCollector: string;
  readonly payoutsEnabled: boolean;
  readonly payoutsStatus: string;
  readonly ready: boolean;
  readonly requirementsDue: string[];
  readonly status: "not_started" | "onboarding" | "restricted" | "ready";
}

function isResponsibilitiesValid(account: StripeV2Account): boolean {
  const responsibilities = account.defaults.responsibilities;
  const reqCollector = responsibilities.requirements_collector;
  return (
    account.dashboard === "full" &&
    responsibilities.fees_collector === "stripe" &&
    responsibilities.losses_collector === "stripe" &&
    (reqCollector === "stripe" || !reqCollector)
  );
}

function resolveReadinessStatus(
  validConfig: boolean,
  cardPaymentsStatus: string,
  payoutsStatus: string,
  hasPastDue: boolean,
  hasCurrentlyDue: boolean,
): "not_started" | "onboarding" | "restricted" | "ready" {
  if (
    !validConfig ||
    cardPaymentsStatus === "restricted" ||
    payoutsStatus === "restricted" ||
    hasPastDue
  ) {
    return "restricted";
  }
  if (cardPaymentsStatus === "active" && payoutsStatus === "active" && !hasCurrentlyDue) {
    return "ready";
  }
  return "onboarding";
}

export function mapStripeAccountReadiness(
  account: StripeV2Account | null | undefined,
): StripeAccountReadiness {
  if (!account?.id) {
    return {
      cardPaymentsStatus: "inactive",
      chargesEnabled: false,
      configurationValid: true,
      dashboardType: "full",
      detailsSubmitted: false,
      feesCollector: "stripe",
      lossesCollector: "stripe",
      payoutsEnabled: false,
      payoutsStatus: "inactive",
      ready: false,
      requirementsDue: [],
      status: "not_started",
    };
  }

  const responsibilities = account.defaults.responsibilities;
  const configurationValid = isResponsibilitiesValid(account);
  const cardPaymentsStatus =
    account.configuration.merchant?.capabilities.card_payments.status ?? "inactive";
  const payoutsStatus =
    account.configuration.merchant?.capabilities.stripe_balance?.payouts.status ??
    (cardPaymentsStatus === "active" ? "active" : "inactive");
  const currentlyDue = account.requirements.currently_due;
  const pastDue = account.requirements.past_due;

  const chargesEnabled = cardPaymentsStatus === "active";
  const payoutsEnabled = payoutsStatus === "active";
  const detailsSubmitted = cardPaymentsStatus !== "inactive" || currentlyDue.length > 0;

  const status = resolveReadinessStatus(
    configurationValid,
    cardPaymentsStatus,
    payoutsStatus,
    pastDue.length > 0,
    currentlyDue.length > 0,
  );

  return {
    cardPaymentsStatus,
    chargesEnabled,
    configurationValid,
    dashboardType: account.dashboard,
    detailsSubmitted,
    feesCollector: responsibilities.fees_collector,
    lossesCollector: responsibilities.losses_collector,
    payoutsEnabled,
    payoutsStatus,
    ready: status === "ready",
    requirementsDue: currentlyDue,
    status,
  };
}

export interface StripeReadinessCandidate {
  readonly charges_enabled?: boolean;
  readonly payouts_enabled?: boolean;
  readonly requirements?: { readonly currently_due?: readonly string[] };
  readonly chargesEnabled?: boolean;
  readonly payoutsEnabled?: boolean;
  readonly requirementsDue?: readonly string[];
  readonly status?: string;
  readonly ready?: boolean;
  readonly object?: string;
}

function isStripeV2Candidate(candidate: StripeReadinessCandidate): candidate is StripeV2Account {
  return candidate.object === "v2.core.account";
}

export function stripeAccountIsReady(account: StripeReadinessCandidate): boolean {
  if (typeof account.ready === "boolean") {
    return account.ready;
  }
  if (isStripeV2Candidate(account)) {
    return mapStripeAccountReadiness(account).status === "ready";
  }
  if (typeof account.status === "string") {
    return account.status === "ready";
  }
  const charges = Boolean(account.chargesEnabled ?? account.charges_enabled);
  const payouts = Boolean(account.payoutsEnabled ?? account.payouts_enabled);
  const due = account.requirementsDue ?? account.requirements?.currently_due ?? [];
  return charges && payouts && due.length === 0;
}
