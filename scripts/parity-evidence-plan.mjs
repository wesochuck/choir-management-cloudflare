/**
 * Probe kinds:
 * - read-anon: anonymous GET, expects 200
 * - read-auth: authenticated GET, expects 200
 * - validation: empty-body mutation, expects 400 (proves the contract validates without side effects)
 * - fail-closed: expects a typed non-200 that documents a deliberate gate (Stripe)
 * - skip-fixture: needs seeded data, a signed token, a parameterized fixture, or mutates state
 * - skip-elevation: needs Platform Administrator elevation or interactive context
 */
export const probePlan = new Map([
  // Anonymous reads
  ["api.setup-health", { kind: "read-anon", expected: 200 }],

  // Authenticated reads (session cookie on the canonical product or seeded org hosts)
  ["api.organization.audition-settings-read", { kind: "read-auth", expected: 200 }],
  ["api.organization.auditions-list", { kind: "read-auth", expected: 200 }],
  ["api.organization.donations", { kind: "read-auth", expected: 200 }],
  ["api.organization.dues", { kind: "read-auth", expected: 200 }],
  ["api.organization.patrons", { kind: "read-auth", expected: 200 }],
  ["api.organization.polls", { kind: "read-auth", expected: 200 }],
  ["api.organization.seasons", { kind: "read-auth", expected: 200 }],
  ["api.module-state", { kind: "read-auth", expected: 200 }],
  ["api.setup-status", { kind: "read-auth", expected: 200 }],
  ["api.calendar-feed-url", { kind: "read-auth", expected: 200 }],
  ["api.singer-dashboard", { kind: "read-auth", expected: 200 }],
  ["api.seating-profiles", { kind: "read-auth", expected: 200 }],

  // Empty-body validation probes (schemas require fields, so 400 precedes any side effect)
  ["api.organization.audition-create", { kind: "validation", expected: 400 }],
  ["api.player-token", { kind: "validation", expected: 400 }],
  ["api.organization.poll-tokens", { kind: "validation", expected: 400 }],
  ["api.organization.poll-create", { kind: "validation", expected: 400 }],
  ["api.generate-rsvp-tokens", { kind: "validation", expected: 400 }],
  ["api.ticket-validate", { kind: "validation", expected: 400 }],
  ["api.organization.audition-settings-update", { kind: "validation", expected: 400 }],
  ["api.public.audition-details", { kind: "validation", expected: 400 }],
  ["api.public.audition-inquiry", { kind: "validation", expected: 400 }],
  ["api.public.audition-submit", { kind: "validation", expected: 400 }],
  ["api.checkout-donation", { kind: "validation", expected: 400 }],
  ["api.public.poll-details", { kind: "validation", expected: 400 }],
  ["api.public.poll-vote", { kind: "validation", expected: 400 }],
  ["api.quick-rsvp", { kind: "validation", expected: 400 }],
  ["api.rsvp-details", { kind: "validation", expected: 400 }],
  ["api.checkout-ticket", { kind: "validation", expected: 400 }],
  ["api.unsubscribe", { kind: "validation", expected: 400 }],
  ["api.checkout-dues", { kind: "validation", expected: 400 }],

  // Deliberate fail-closed gates
  ["api.stripe-webhook", { kind: "fail-closed", expected: 503 }],

  // Require Platform Administrator elevation or interactive context
  ["api.maintenance", { kind: "skip-elevation" }],
  ["api.queue-settings", { kind: "skip-elevation" }],
  ["api.queue-settings-generate", { kind: "skip-elevation" }],
  ["api.platform.reconciliation-report", { kind: "skip-elevation" }],
  ["api.platform.queue-failure-action", { kind: "skip-elevation" }],
  ["api.setup-recover-admin", { kind: "skip-elevation" }],
  ["api.test-email", { kind: "skip-elevation" }],
  ["api.test-sms", { kind: "skip-elevation" }],

  // Require seeded data, a signed token, a parameterized fixture, or mutate state
  ["api.calendar-feed", { kind: "skip-fixture" }],
  ["api.calendar-feed-reset", { kind: "skip-fixture" }],
  ["api.player-playlist", { kind: "skip-fixture" }],
  ["api.singer-practice-link", { kind: "skip-fixture" }],
  ["api.organization.audition-delete", { kind: "skip-fixture" }],
  ["api.organization.audition-convert", { kind: "skip-fixture" }],
  ["api.organization.audition-update", { kind: "skip-fixture" }],
  ["api.organization.export-download", { kind: "skip-fixture" }],
  ["api.organization.poll-archive", { kind: "skip-fixture" }],
  ["api.organization.poll-update", { kind: "skip-fixture" }],
  ["api.refund-donation", { kind: "skip-fixture" }],
  ["api.refund-dues", { kind: "skip-fixture" }],
  ["api.refund-ticket", { kind: "skip-fixture" }],
  ["api.resend-ticket", { kind: "skip-fixture" }],
  ["api.singer-rsvp", { kind: "skip-fixture" }],
  ["api.setup-claim", { kind: "skip-fixture" }],
  ["api.setup-complete", { kind: "skip-fixture" }],
  ["api.setup-progress", { kind: "skip-fixture" }],
]);

export function buildProbePlan(matrix) {
  const entries = matrix.apiRoutes.filter((entry) => entry.status === "implemented");
  const rows = [];
  for (const entry of entries) {
    const plan = probePlan.get(entry.id);
    if (!plan) {
      rows.push({ id: entry.id, kind: "skip-unmapped", method: entry.method, route: entry.path });
      continue;
    }
    rows.push({ id: entry.id, kind: plan.kind, method: entry.method, route: entry.path, ...plan });
  }
  return rows;
}
