import { discoverWorkerRoutes } from "./check-routes.mjs";

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
  ["GET /api/setup/health", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/audition-settings", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/auditions", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/donations", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/dues", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/patrons", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/polls", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/seasons", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/module-state", { expected: 200, kind: "read-auth" }],
  ["GET /api/setup/status", { expected: 200, kind: "read-auth" }],
  ["GET /api/singer/calendar-feed-url", { expected: 200, kind: "read-auth" }],
  ["GET /api/singer/dashboard", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/tickets/discount-codes", { expected: 200, kind: "read-auth" }],
  ["GET /api/organization/dashboard-summary", { expected: 200, kind: "read-auth" }],
  [
    "GET /api/organization/profile-reconciliations/candidates",
    { expected: 200, kind: "read-auth" },
  ],

  // Anonymous reads
  ["GET /api/health", { expected: 200, kind: "read-anon" }],
  ["GET /api/public/audition-settings", { expected: 200, kind: "read-anon" }],

  // Empty-body validation probes (schemas require fields, so 400 precedes any side effect)
  ["GET /api/singer/seating-profiles", { expected: 400, kind: "validation" }],
  ["POST /api/organization/auditions", { expected: 400, kind: "validation" }],
  ["POST /api/organization/player-tokens", { expected: 400, kind: "validation" }],
  ["POST /api/organization/poll-tokens", { expected: 400, kind: "validation" }],
  ["POST /api/organization/polls", { expected: 400, kind: "validation" }],
  ["POST /api/organization/rsvp-tokens", { expected: 400, kind: "validation" }],
  ["POST /api/organization/tickets/scan", { expected: 400, kind: "validation" }],
  ["PUT /api/organization/audition-settings", { expected: 400, kind: "validation" }],
  ["POST /api/public/audition-details", { expected: 400, kind: "validation" }],
  ["POST /api/public/audition-inquiry", { expected: 400, kind: "validation" }],
  ["POST /api/public/audition-submit", { expected: 400, kind: "validation" }],
  ["POST /api/public/donations/checkout", { expected: 400, kind: "validation" }],
  ["POST /api/public/poll-details", { expected: 400, kind: "validation" }],
  ["POST /api/public/poll-vote", { expected: 400, kind: "validation" }],
  ["POST /api/public/quick-rsvp", { expected: 400, kind: "validation" }],
  ["POST /api/public/rsvp-details", { expected: 400, kind: "validation" }],
  ["PUT /api/singer/events/:eventId/rsvp", { expected: 400, kind: "validation" }],
  ["POST /api/public/tickets/checkout", { expected: 400, kind: "validation" }],
  ["POST /api/public/tickets/quote", { expected: 400, kind: "validation" }],
  ["POST /api/organization/tickets/discount-codes", { expected: 400, kind: "validation" }],
  ["POST /api/public/unsubscribe", { expected: 400, kind: "validation" }],
  ["POST /api/singer/dues/checkout", { expected: 400, kind: "validation" }],
  ["POST /api/setup/progress", { expected: 400, kind: "validation" }],
  ["POST /api/organization/music/credits/rename", { expected: 400, kind: "validation" }],
  ["POST /api/singer/profile/email-change", { expected: 400, kind: "validation" }],
  ["POST /api/account/email-change/confirm", { expected: 400, kind: "validation" }],
  ["POST /api/organization/donations/manual", { expected: 400, kind: "validation" }],
  ["POST /api/organization/donations/thank-you", { expected: 400, kind: "validation" }],
  ["POST /api/organization/profile-reconciliations/preview", { expected: 400, kind: "validation" }],
  ["POST /api/organization/profile-reconciliations", { expected: 400, kind: "validation" }],

  // Deliberate fail-closed gates (Stripe)
  ["POST /api/webhook/stripe", { expected: 400, kind: "fail-closed" }],

  // Require Platform Administrator elevation or interactive context
  ["GET /api/platform/maintenance/run", { kind: "skip-elevation" }],
  ["GET /api/platform/queue-settings", { kind: "skip-elevation" }],
  ["POST /api/platform/queue-settings/generate", { kind: "skip-elevation" }],
  ["GET /api/platform/reconciliation-report", { kind: "skip-elevation" }],
  ["GET /api/platform/email-suppressions", { kind: "skip-elevation" }],
  ["GET /api/platform/job-dead-letters", { kind: "skip-elevation" }],
  ["POST /api/platform/job-dead-letters/:deadLetterId/retry", { kind: "skip-elevation" }],
  ["POST /api/platform/job-dead-letters/:deadLetterId/dismiss", { kind: "skip-elevation" }],
  ["POST /api/setup/recover-admin", { kind: "skip-elevation" }],
  ["POST /api/test-smtp", { kind: "skip-elevation" }],
  ["POST /api/test-sms", { kind: "skip-elevation" }],
  [
    "POST /api/platform/organizations/:organizationId/stripe-reconciliation/preview",
    { kind: "skip-elevation" },
  ],
  [
    "POST /api/platform/organizations/:organizationId/stripe-reconciliation/apply",
    { kind: "skip-elevation" },
  ],

  // Require seeded data, a signed token, a parameterized fixture, or mutate state
  ["GET /api/calendar/feed", { kind: "skip-fixture" }],
  ["POST /api/singer/calendar-feed-url/reset", { kind: "skip-fixture" }],
  ["GET /api/public/player/playlist", { kind: "skip-fixture" }],
  ["GET /api/singer/practice-links/:eventId", { kind: "skip-fixture" }],
  ["DELETE /api/organization/auditions/:auditionId", { kind: "skip-fixture" }],
  ["POST /api/organization/auditions/:auditionId/convert", { kind: "skip-fixture" }],
  ["PUT /api/organization/auditions/:auditionId", { kind: "skip-fixture" }],
  ["GET /api/organization/export/:exportId/download", { kind: "skip-fixture" }],
  ["POST /api/organization/polls/:pollId/archive", { kind: "skip-fixture" }],
  ["PUT /api/organization/polls/:pollId", { kind: "skip-fixture" }],
  ["POST /api/organization/donations/:donationId/refund", { kind: "skip-fixture" }],
  ["POST /api/organization/dues/:duesId/refund", { kind: "skip-fixture" }],
  ["POST /api/organization/tickets/:purchaseId/refund", { kind: "skip-fixture" }],
  ["POST /api/organization/tickets/:purchaseId/confirmation", { kind: "skip-fixture" }],
  ["GET /api/public/tickets/discount-availability", { kind: "skip-fixture" }],
  ["PUT /api/organization/tickets/discount-codes/:codeId", { kind: "skip-fixture" }],
  ["POST /api/organization/tickets/discount-codes/:codeId/deactivate", { kind: "skip-fixture" }],
  ["POST /api/organization/tickets/discount-codes/:codeId/reactivate", { kind: "skip-fixture" }],
  ["POST /api/setup/claim", { kind: "skip-fixture" }],
  ["POST /api/setup/complete", { kind: "skip-fixture" }],
  ["POST /api/organization/reports/music-folders/query", { kind: "skip-fixture" }],
  ["POST /api/organization/reports/music-folders/profiles/:profileId", { kind: "skip-fixture" }],
  ["PUT /api/organization/reports/music-folders/folder-numbers", { kind: "skip-fixture" }],
  [
    "PUT /api/organization/profiles/:profileId/folder-numbers/:eventId/return-status",
    { kind: "skip-fixture" },
  ],
  ["POST /api/organization/reports/music-folders/export.csv", { kind: "skip-fixture" }],
  ["POST /api/organization/export", { kind: "skip-fixture" }],
  ["GET /api/organization/export/:exportId", { kind: "skip-fixture" }],
  ["GET /api/organization/profile-reconciliations/:id", { kind: "skip-fixture" }],
]);

export function isExpectedAnonymousBoundary(row, result) {
  if (result.error !== undefined) return false;
  const route = row.route ?? row.path ?? "";
  if (route === "/api/webhook/stripe" || route === "/api/webhook/stripe/v2") {
    return (
      (result.status === 400 && result.code === "invalid_webhook_signature") ||
      (result.status === 503 && result.code === "stripe_webhook_unavailable")
    );
  }
  if (route === "/api/public/player/playlist") {
    return result.status === 404 && result.code === "invalid_link";
  }
  if (route === "/api/calendar/feed") {
    return result.status === 404 && result.code === "not_found";
  }
  if (result.status === 200) return true;
  return (
    [400, 401, 403, 405, 409, 422, 429].includes(result.status) &&
    typeof result.code === "string" &&
    result.code.length > 0
  );
}

export function usesOrganizationHost(row) {
  const route = row.route ?? row.path ?? "";
  return (
    route.startsWith("/api/organization/") ||
    route.startsWith("/api/singer/") ||
    route.startsWith("/api/setup/") ||
    route.startsWith("/api/public/") ||
    route.startsWith("/api/calendar/") ||
    route.startsWith("/api/account/") ||
    route.startsWith("/api/roster-invites/") ||
    route.startsWith("/api/local/") ||
    row.id === "api.platform.reconciliation-report" ||
    row.id === "api.maintenance" ||
    route === "/api/platform/reconciliation-report" ||
    route === "/api/platform/maintenance/run"
  );
}

export function materializeRoutePath(route) {
  return route.replaceAll(/:[A-Za-z][A-Za-z0-9_]*/g, "00000000-0000-4000-8000-000000000000");
}

export async function getApplicationRoutes() {
  const { routes } = await discoverWorkerRoutes();
  return routes;
}

export function buildProbePlan(routes) {
  const entries =
    routes ??
    Array.from(probePlan.keys()).map((key) => {
      const [method, path] = key.split(" ");
      return { id: key, method, path };
    });

  const rows = [];
  for (const entry of entries) {
    const key = `${entry.method} ${entry.path}`;
    const plan = probePlan.get(key);
    if (!plan) {
      rows.push({
        id: entry.id ?? key,
        kind: "skip-unmapped",
        method: entry.method,
        route: entry.path,
      });
      continue;
    }
    rows.push({
      ...plan,
      id: entry.id ?? key,
      kind: plan.kind,
      method: entry.method,
      route: entry.path,
    });
  }
  return rows;
}

export function buildAnonymousProbeRows(routes, organizationSlugs) {
  const rows = [];
  for (const entry of routes) {
    const key = `${entry.method} ${entry.path}`;
    const row = {
      id: entry.id ?? key,
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
