import { describe, expect, test } from "vitest";

import { discoverWorkerRoutes } from "./check-routes.mjs";
import {
  buildAnonymousProbeRows,
  buildProbePlan,
  isExpectedAnonymousBoundary,
  materializeRoutePath,
  probePlan,
  usesOrganizationHost,
} from "./route-probe-plan.mjs";

describe("route staging qualification and evidence plan", () => {
  test("keeps probe kinds and expected statuses valid", () => {
    const validKinds = new Set([
      "read-anon",
      "read-auth",
      "validation",
      "fail-closed",
      "skip-fixture",
      "skip-elevation",
    ]);
    for (const plan of probePlan.values()) {
      expect(validKinds.has(plan.kind), `invalid probe kind ${plan.kind}`).toBe(true);
      if (!plan.kind.startsWith("skip")) {
        expect(Number.isInteger(plan.expected)).toBe(true);
      }
    }
  });

  test("keeps every probe plan entry present in the actual Worker routes", async () => {
    const { routes } = await discoverWorkerRoutes();
    const registeredRoutes = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const key of probePlan.keys()) {
      expect(
        registeredRoutes.has(key),
        `probe plan references nonexistent Worker route ${key}`,
      ).toBe(true);
    }
  });

  test("treats setup health as an authenticated Organization-host probe", () => {
    expect(probePlan.get("GET /api/setup/health")).toEqual({ kind: "read-auth", expected: 200 });
  });

  test("routes canonical public and Organization-scoped probes to an Organization host", () => {
    const rowFor = (method, path) => ({
      method,
      route: materializeRoutePath(path),
    });

    for (const [method, path] of [
      ["GET", "/api/setup/health"],
      ["POST", "/api/public/rsvp-details"],
      ["GET", "/api/calendar/feed"],
      ["GET", "/api/calendar/feed/:filename"],
      ["POST", "/api/account/email-change/confirm"],
      ["GET", "/api/platform/reconciliation-report"],
      ["GET", "/api/platform/maintenance/run"],
      ["GET", "/api/platform/organization-context"],
      ["POST", "/api/platform/elevations"],
      ["DELETE", "/api/platform/elevations/:elevationId"],
    ]) {
      expect(usesOrganizationHost(rowFor(method, path)), `${method} ${path}`).toBe(true);
    }

    expect(usesOrganizationHost(rowFor("GET", "/api/platform/email-suppressions"))).toBe(false);
    expect(usesOrganizationHost(rowFor("POST", "/api/webhook/stripe"))).toBe(false);
  });

  test("accepts only typed no-session boundary responses", () => {
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/rsvp-details" },
        { status: 400, code: "validation_failed" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/player/playlist" },
        { status: 404, code: "invalid_link" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/webhook/stripe" },
        { status: 503, code: "stripe_webhook_unavailable" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/webhook/stripe" },
        { status: 400, code: "invalid_webhook_signature" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/logo" },
        { status: 404, code: "not_found" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/documents/00000000-0000-4000-8000-000000000000" },
        { status: 404, code: "not_found" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/calendar/feed/00000000-0000-4000-8000-000000000000" },
        { status: 404, code: "not_found" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/donation-receipt" },
        { status: 404, code: "donation_receipt_not_found" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/tickets/order" },
        { status: 404, code: "not_found" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/local/fullstack-bootstrap" },
        { status: 404, code: "not_found" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/platform/maintenance/status-automation-fixture" },
        { status: 401, code: "unauthorized" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/platform/maintenance/status-automation-fixture" },
        { status: 404, code: "not_found" },
      ),
    ).toBe(true);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/rsvp-details" },
        { status: 404, code: "not_found" },
      ),
    ).toBe(false);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/rsvp-details" },
        { error: "timed out", status: 0 },
      ),
    ).toBe(false);
    expect(
      isExpectedAnonymousBoundary({ route: "/api/public/rsvp-details" }, { status: 401 }),
    ).toBe(false);
    expect(
      isExpectedAnonymousBoundary(
        { route: "/api/public/rsvp-details" },
        { status: 418, code: "unexpected_response" },
      ),
    ).toBe(false);
  });

  test.each([
    ["GET", "/api/public/donations/sponsor-info", "sponsor_not_found"],
    ["POST", "/api/public/donations/sponsor-artwork", "sponsor_not_found"],
    ["GET", "/api/public/donations/artwork/:fileId", "artwork_not_found"],
  ])("recognizes only the tokenless rejection for %s %s", (method, path, code) => {
    const rows = buildAnonymousProbeRows([{ method, path }], ["lcc", "lmc"]);
    expect(rows.map((row) => row.organizationSlug)).toEqual(["lcc", "lmc"]);
    for (const row of rows) {
      expect(isExpectedAnonymousBoundary(row, { status: 404, code })).toBe(true);
      for (const unexpected of [
        { status: 404, code: "not_found" },
        { status: 404, code: "sponsor_token_invalid" },
        {
          status: 404,
          code: code === "sponsor_not_found" ? "artwork_not_found" : "sponsor_not_found",
        },
        { status: 404 },
        { status: 200 },
        { status: 400, code: "validation_failed" },
        { status: 503, code: "service_unavailable" },
        { status: 0, error: "timed out" },
      ]) {
        expect(isExpectedAnonymousBoundary(row, unexpected)).toBe(false);
      }
    }
    expect(
      isExpectedAnonymousBoundary(
        { method, route: "/api/public/unrelated" },
        { status: 404, code },
      ),
    ).toBe(false);
  });

  test.each([
    ["POST", "/api/public/donations/artwork/upload", "validation_failed"],
    ["POST", "/api/public/player-details", "validation_failed"],
    ["GET", "/api/public/player/media/:fileId", "missing_token"],
  ])("preserves the existing empty-input boundary for %s %s", (method, path, code) => {
    for (const row of buildAnonymousProbeRows([{ method, path }], ["lcc", "lmc"])) {
      expect(isExpectedAnonymousBoundary(row, { status: 400, code })).toBe(true);
      expect(isExpectedAnonymousBoundary(row, { status: 404, code: "not_found" })).toBe(false);
    }
  });

  test("materializes dynamic route parameters for safe boundary probes", () => {
    expect(materializeRoutePath("/api/events/:eventId/profiles/:profileId")).toBe(
      "/api/events/00000000-0000-4000-8000-000000000000/profiles/00000000-0000-4000-8000-000000000000",
    );
  });

  test("covers every Organization-host route on each seeded host", () => {
    const sampleRoutes = [
      { method: "GET", path: "/api/setup/health" },
      { method: "GET", path: "/api/health" },
    ];
    const rows = buildAnonymousProbeRows(sampleRoutes, ["lcc", "lmc"]);
    expect(rows).toHaveLength(3);
    expect(
      rows.filter((row) => row.route === "/api/setup/health").map((row) => row.organizationSlug),
    ).toEqual(["lcc", "lmc"]);
    expect(rows.filter((row) => row.route === "/api/health")).toHaveLength(1);
    expect(rows.every((row) => !row.route.includes(":"))).toBe(true);
  });

  test("builds probe plan from registered routes", () => {
    const sampleRoutes = [
      { method: "GET", path: "/api/health" },
      { method: "GET", path: "/api/setup/health" },
    ];
    const planRows = buildProbePlan(sampleRoutes);
    expect(planRows).toHaveLength(2);
    expect(planRows.find((r) => r.route === "/api/health")?.kind).toBe("read-anon");
    expect(planRows.find((r) => r.route === "/api/setup/health")?.kind).toBe("read-auth");
  });
});
