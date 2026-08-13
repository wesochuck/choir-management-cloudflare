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
  // Authenticated reads (session cookie on the canonical Organization hosts)
  ["api.setup-health", { kind: "read-auth", expected: 200 }],

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
  ["api.list-ticket-discount-codes", { kind: "read-auth", expected: 200 }],

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
  ["api.singer-rsvp", { kind: "validation", expected: 400 }],
  ["api.checkout-ticket", { kind: "validation", expected: 400 }],
  ["api.ticket-quote", { kind: "validation", expected: 400 }],
  ["api.create-ticket-discount-code", { kind: "validation", expected: 400 }],
  ["api.unsubscribe", { kind: "validation", expected: 400 }],
  ["api.checkout-dues", { kind: "validation", expected: 400 }],

  // Deliberate fail-closed gates. Staging has the webhook secret configured, so
  // the safe empty request reaches signature verification and returns 400.
  // Environments without the secret return the typed 503 configuration error;
  // the anonymous boundary matcher below accepts both states.
  ["api.stripe-webhook", { kind: "fail-closed", expected: 400 }],

  // Require Platform Administrator elevation or interactive context
  ["api.maintenance", { kind: "skip-elevation" }],
  ["api.queue-settings", { kind: "skip-elevation" }],
  ["api.queue-settings-generate", { kind: "skip-elevation" }],
  ["api.platform.reconciliation-report", { kind: "skip-elevation" }],
  ["api.platform.email-suppressions", { kind: "skip-elevation" }],
  ["api.platform.job-dead-letters", { kind: "skip-elevation" }],
  ["api.platform.job-dead-letters.retry", { kind: "skip-elevation" }],
  ["api.platform.job-dead-letters.dismiss", { kind: "skip-elevation" }],
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
  ["api.ticket-discount-availability", { kind: "skip-fixture" }],
  ["api.update-ticket-discount-code", { kind: "skip-fixture" }],
  ["api.deactivate-ticket-discount-code", { kind: "skip-fixture" }],
  ["api.setup-claim", { kind: "skip-fixture" }],
  ["api.setup-complete", { kind: "skip-fixture" }],
  // Empty-body validation is safe here: the route rejects the request before
  // any setup progress can be written.
  ["api.setup-progress", { kind: "validation", expected: 400 }],
  ["api.organization.music-folder-report-query", { kind: "skip-fixture" }],
  ["api.organization.music-folder-report-profile-detail", { kind: "skip-fixture" }],
  ["api.organization.music-folder-report-folder-numbers", { kind: "skip-fixture" }],
  ["api.organization.music-folder-return-status", { kind: "skip-fixture" }],
  ["api.organization.music-folder-report-export", { kind: "skip-fixture" }],
  // Empty-body validation is safe here: the route rejects the request before
  // starting an email-change operation or contacting the provider.
  ["api.singer.profile-email-change", { kind: "validation", expected: 400 }],
  ["api.account.email-change-confirm", { kind: "validation", expected: 400 }],
]);

export function isExpectedAnonymousBoundary(row, result) {
  if (result.error !== undefined) return false;
  if (row.id === "api.stripe-webhook") {
    return (
      (result.status === 400 && result.code === "invalid_webhook_signature") ||
      (result.status === 503 && result.code === "stripe_webhook_unavailable")
    );
  }
  if (row.id === "api.player-playlist") {
    return result.status === 404 && result.code === "invalid_link";
  }
  if (row.id === "api.calendar-feed") {
    return result.status === 404 && result.code === "not_found";
  }
  if (result.status === 200) return true;
  return (
    [400, 401, 403, 405, 409, 422, 429].includes(result.status) &&
    typeof result.code === "string" &&
    result.code.length > 0
  );
}

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

export function buildAnonymousProbeRows(matrix, organizationSlugs) {
  const rows = [];
  for (const entry of matrix.apiRoutes) {
    const row = {
      id: entry.id,
      method: entry.method,
      route: materializeRoutePath(entry.path),
    };
    const scopes = usesOrganizationHost(row) ? organizationSlugs : [undefined];
    for (const organizationSlug of scopes) {
      rows.push({ ...row, organizationSlug });
    }
  }
  return rows;
}

export function usesOrganizationHost(row) {
  return (
    row.route.startsWith("/api/organization/") ||
    row.route.startsWith("/api/singer/") ||
    row.route.startsWith("/api/setup/") ||
    row.route.startsWith("/api/public/") ||
    row.route.startsWith("/api/calendar/") ||
    row.route.startsWith("/api/account/") ||
    row.id === "api.platform.reconciliation-report" ||
    row.id === "api.maintenance"
  );
}

export function materializeRoutePath(route) {
  return route.replaceAll(/:[A-Za-z][A-Za-z0-9_]*/g, "00000000-0000-4000-8000-000000000000");
}
