/**
 * Compatibility re-export barrel for Stripe Connect, Checkout, Client, Readiness, and Reconciliation.
 * Decomposed into cohesive modules:
 * - stripeClient.ts: base request wrappers, error classes, and client utilities
 * - stripeAccountReadiness.ts: account schema, readiness mapping, and readiness checks
 * - stripeCheckout.ts: checkout sessions, reconciliation sessions, and refunds
 * - stripeOnboarding.ts: account creation, retrieval, and onboarding links
 * - stripeReconciliationSnapshots.ts: payment settlements and reconciliation snapshots
 */

export * from "./stripeClient";
export * from "./stripeAccountReadiness";
export * from "./stripeCheckout";
export * from "./stripeOnboarding";
export * from "./stripeReconciliationSnapshots";
