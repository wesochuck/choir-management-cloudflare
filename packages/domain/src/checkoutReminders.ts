/** Shared elapsed-time rules for optional incomplete checkout reminders. */
export const CHECKOUT_REMINDER_WAIT_MS = 24 * 60 * 60 * 1_000;
export const CHECKOUT_REMINDER_COOLDOWN_MS = 30 * CHECKOUT_REMINDER_WAIT_MS;
export const CHECKOUT_RECOVERY_LIFETIME_MS = 7 * CHECKOUT_REMINDER_WAIT_MS;
export const CHECKOUT_REMINDER_RETENTION_MS = 90 * CHECKOUT_REMINDER_WAIT_MS;

export interface CheckoutReminderPurchase {
  readonly kind: "ticket" | "donation";
  readonly email: string;
  readonly organizationId: string;
  readonly occurredAt: number;
  readonly performanceIds: readonly string[];
}

/** Commerce already treats email case-insensitively; preserve mailbox aliases. */
export function normalizeCheckoutReminderEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Any performance overlap cancels the entire old bundle reminder. */
export function checkoutReminderCompletedBy(
  attempt: CheckoutReminderPurchase,
  completed: CheckoutReminderPurchase,
): boolean {
  if (
    attempt.organizationId !== completed.organizationId ||
    attempt.kind !== completed.kind ||
    normalizeCheckoutReminderEmail(attempt.email) !==
      normalizeCheckoutReminderEmail(completed.email) ||
    !Number.isFinite(attempt.occurredAt) ||
    !Number.isFinite(completed.occurredAt) ||
    completed.occurredAt < attempt.occurredAt
  ) {
    return false;
  }
  if (attempt.kind === "donation") return true;
  const performances = new Set(attempt.performanceIds);
  return completed.performanceIds.some((id) => performances.has(id));
}

export function checkoutReminderTimeEligible(input: {
  readonly now: number;
  readonly startedAt: number;
  readonly lastSentAt: number | null;
  /** null for donations; earliest included performance for bundles. */
  readonly firstPerformanceAt: number | null;
}): boolean {
  const { now, startedAt, lastSentAt, firstPerformanceAt } = input;
  return (
    Number.isFinite(now) &&
    Number.isFinite(startedAt) &&
    now - startedAt >= CHECKOUT_REMINDER_WAIT_MS &&
    (lastSentAt === null ||
      (Number.isFinite(lastSentAt) && now - lastSentAt >= CHECKOUT_REMINDER_COOLDOWN_MS)) &&
    (firstPerformanceAt === null ||
      (Number.isFinite(firstPerformanceAt) &&
        firstPerformanceAt - now >= CHECKOUT_REMINDER_WAIT_MS))
  );
}

export function checkoutRecoveryFormDefaults(recovery?: {
  readonly email: string;
  readonly quantity: number | null;
  readonly discountCode: string | null;
}) {
  return {
    email: recovery?.email ?? "",
    quantity: recovery?.quantity ?? 1,
    discountCode: recovery?.discountCode ?? "",
  };
}

export function checkoutRecoveryTotalChanged(
  recovery: { readonly amountCents: number | null } | undefined,
  currentTotal: number,
): boolean {
  return (
    recovery?.amountCents !== null &&
    recovery?.amountCents !== undefined &&
    recovery.amountCents !== currentTotal
  );
}
