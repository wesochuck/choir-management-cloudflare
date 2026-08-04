import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const matrixUrl = new URL("../docs/parity/feature-matrix.yaml", import.meta.url);
const expectedBaselineCommit = "6874d43a3c3698ae53218a44d17649bc454ca9ac";
const expectedApiRoutes = [
  "GET /api/organization/dashboard-summary",
  "POST /api/organization/dues/:duesId/refund",
  "GET /api/health",
  "GET /api/organization/donations",
  "GET /api/organization/dues",
  "GET /api/organization/patrons",
  "GET /api/organization/seasons",
  "GET /api/setup/status",
  "GET /api/organization/module-state",
  "POST /api/setup/claim",
  "POST /api/setup/progress",
  "POST /api/setup/complete",
  "POST /api/setup/recover-admin",
  "GET /api/setup/health",
  "POST /api/public/rsvp-details",
  "PUT /api/singer/events/:eventId/rsvp",
  "GET /api/singer/dashboard",
  "GET /api/singer/practice-links/:eventId",
  "POST /api/public/quick-rsvp",
  "POST /api/public/unsubscribe",
  "POST /api/organization/rsvp-tokens",
  "GET /api/platform/queue-settings",
  "POST /api/platform/queue-settings/generate",
  "GET /api/platform/reconciliation-report",
  "POST /api/test-smtp",
  "POST /api/test-sms",
  "POST /api/organization/player-tokens",
  "POST /api/public/tickets/checkout",
  "POST /api/singer/dues/checkout",
  "POST /api/public/donations/checkout",
  "POST /api/webhook/stripe",
  "POST /api/organization/tickets/:purchaseId/refund",
  "POST /api/organization/donations/:donationId/refund",
  "POST /api/organization/tickets/:purchaseId/confirmation",
  "POST /api/organization/tickets/scan",
  "GET /api/public/player/playlist",
  "GET /api/calendar/feed",
  "GET /api/singer/calendar-feed-url",
  "POST /api/singer/calendar-feed-url/reset",
  "GET /api/singer/seating-profiles",
  "GET /api/platform/maintenance/run",
  "POST /api/public/poll-details",
  "POST /api/public/poll-vote",
  "POST /api/organization/poll-tokens",
  "GET /api/organization/polls",
  "POST /api/organization/polls",
  "PUT /api/organization/polls/:pollId",
  "POST /api/organization/polls/:pollId/archive",
  "POST /api/organization/export",
  "GET /api/organization/export/:exportId",
  "GET /api/organization/export/:exportId/download",
  "GET /api/public/audition-settings",
  "POST /api/public/audition-inquiry",
  "POST /api/public/audition-details",
  "POST /api/public/audition-submit",
  "GET /api/organization/audition-settings",
  "PUT /api/organization/audition-settings",
  "POST /api/organization/auditions",
  "GET /api/organization/auditions",
  "DELETE /api/organization/auditions/:auditionId",
  "POST /api/organization/auditions/:auditionId/convert",
  "POST /api/organization/audition-tokens",
  "PUT /api/organization/auditions/:auditionId",
];
const expectedBrowserRoutes = [
  "/",
  "/account",
  "/account/organizations",
  "/account/security",
  "/account/sessions",
  "/admin",
  "/admin/attendance",
  "/admin/auditions",
  "/admin/communications",
  "/admin/donations",
  "/admin/events",
  "/admin/events/:eventId/roster",
  "/admin/library",
  "/admin/library/settings",
  "/admin/patrons",
  "/admin/polls",
  "/admin/reports",
  "/admin/resources",
  "/admin/seasons",
  "/admin/roster",
  "/admin/rsvp",
  "/admin/seating",
  "/admin/setlists",
  "/admin/settings",
  "/admin/settings/invitations",
  "/admin/settings/modules",
  "/admin/settings/security",
  "/admin/settings/setup-checklist",
  "/admin/tickets",
  "/admin/tickets/scan",
  "/admin/venues",
  "/admin/website",
  "/auditions",
  "/calendar",
  "/dashboard",
  "/directory",
  "/donate",
  "/donate/success",
  "/history",
  "/login",
  "/member/resources",
  "/performances",
  "/platform",
  "/platform/access",
  "/platform/organizations",
  "/platform/security",
  "/player",
  "/poll",
  "/practice",
  "/profile",
  "/reset-password",
  "/rsvp",
  "/rsvp/:eventId",
  "/schedule",
  "/seating/:eventId",
  "/setup",
  "/tickets",
  "/tickets/:eventId",
  "/tickets/bundle/:bundleId",
  "/tickets/order/success",
  "/unsubscribe",
];
const expectedCsvContracts = [
  "attendance-report",
  "donations",
  "event-rsvp-roster",
  "music-library",
  "repertoire-history",
  "roster",
  "will-call",
];
const expectedBackgroundTasks = [
  "cleanup-stale-payments",
  "event-reminders",
  "message-queue-delivery",
  "post-event-report",
  "ticket-buyer-reminders",
];
const expectedRecordHooks = [
  "auditions.afterCreate",
  "auditions.afterUpdate",
  "messages.afterCreate",
  "messages.afterUpdate",
];
const expectedSignedFlows = [
  "audition-link",
  "calendar-feed",
  "player-link",
  "poll-link",
  "rsvp-link",
  "ticket-scan",
  "unsubscribe-link",
];
const allowedStatuses = new Set(["blocked", "implemented", "partial", "planned", "verified"]);

function fail(message) {
  throw new Error(`Parity matrix invalid: ${message}`);
}

function expectRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function expectString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function validateEntries(sectionName, entries, seenIds) {
  if (!Array.isArray(entries) || entries.length === 0) {
    fail(`${sectionName} must contain entries`);
  }

  for (const [index, rawEntry] of entries.entries()) {
    const entry = expectRecord(rawEntry, `${sectionName}[${index}]`);
    const id = expectString(entry.id, `${sectionName}[${index}].id`);
    if (seenIds.has(id)) {
      fail(`duplicate entry id ${id}`);
    }
    seenIds.add(id);
    expectString(entry.owner, `${id}.owner`);
    expectString(entry.baselineEvidence, `${id}.baselineEvidence`);
    if (!Number.isInteger(entry.milestone) || entry.milestone < 0 || entry.milestone > 6) {
      fail(`${id}.milestone must be an integer from 0 through 6`);
    }
    if (!allowedStatuses.has(entry.status)) {
      fail(`${id}.status is not recognized`);
    }
    if (!Array.isArray(entry.targetEvidence)) {
      fail(`${id}.targetEvidence must be an array`);
    }
    if (
      (entry.status === "implemented" || entry.status === "verified") &&
      entry.targetEvidence.length === 0
    ) {
      fail(`${id} needs target evidence before it can be ${entry.status}`);
    }
  }
}

function compareExact(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    const missing = expectedSorted.filter((value) => !actualSorted.includes(value));
    const extra = actualSorted.filter((value) => !expectedSorted.includes(value));
    fail(`${label} differs; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
  }
}

const raw = await readFile(matrixUrl, "utf8");
let parsed;
try {
  parsed = parse(raw);
} catch (error) {
  fail(`YAML could not be parsed (${error instanceof Error ? error.message : "parse error"})`);
}

const matrix = expectRecord(parsed, "root");
const baseline = expectRecord(matrix.baseline, "baseline");
if (baseline.commit !== expectedBaselineCommit) {
  fail(`baseline commit must be ${expectedBaselineCommit}`);
}

const sections = [
  "apiRoutes",
  "backgroundTasks",
  "browserRoutes",
  "csvContracts",
  "domainWorkflows",
  "fileBehaviors",
  "recordHooks",
  "responsiveStates",
  "signedFlows",
];
const seenIds = new Set();
for (const sectionName of sections) {
  validateEntries(sectionName, matrix[sectionName], seenIds);
}

compareExact(
  matrix.apiRoutes.map((entry) => `${entry.method} ${entry.path}`),
  expectedApiRoutes,
  "API route inventory",
);
compareExact(
  matrix.browserRoutes.map((entry) => entry.path),
  expectedBrowserRoutes,
  "browser route inventory",
);
compareExact(
  matrix.csvContracts.map((entry) => entry.contract),
  expectedCsvContracts,
  "CSV contract inventory",
);
compareExact(
  matrix.backgroundTasks.map((entry) => entry.task),
  expectedBackgroundTasks,
  "background task inventory",
);
compareExact(
  matrix.recordHooks.map((entry) => entry.hook),
  expectedRecordHooks,
  "record hook inventory",
);
compareExact(
  matrix.signedFlows.map((entry) => entry.flow),
  expectedSignedFlows,
  "signed-flow inventory",
);

console.log(
  `Parity matrix valid: ${seenIds.size} entries across ${sections.length} sections at ${expectedBaselineCommit}.`,
);
